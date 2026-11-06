#!/usr/bin/env python3
"""Locate retained chunk bytes in pinned native PDF text, without runtime imports.

Physical page numbers come from form-feed boundaries checked against the supplied
manifest's page count. This does not independently parse PDF structure, recover
geometry, establish source entailment, or change any production record.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re


MAX_TEXT_BYTES = 50 * 1024 * 1024


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def utf16_length(text: str) -> int:
    return len(text.encode('utf-16-le')) // 2


def file_identity(path: Path, data: bytes | None = None) -> dict:
    if data is None:
        data = path.read_bytes()
    return {'file': str(path.resolve()), 'bytes': len(data), 'sha256': sha(data)}


def source_chunks_hash(chunks: list[dict]) -> str:
    digest = hashlib.sha256()
    for row in chunks:
        encoded = row['text'].encode('utf-8')
        digest.update(f"{row['index']}:{len(encoded)}:".encode())
        digest.update(encoded)
    return digest.hexdigest()


def page_intervals(text: str, expected_pages: int) -> tuple[list[tuple[int, int]], list[str]]:
    """Keep leading/consecutive blank pages; omit only a terminal sentinel."""
    if type(expected_pages) is not int or expected_pages < 1:
        return [], ['invalid-manifest-page-count']
    if not text.strip():
        return [], ['native-text-empty']
    boundaries = [i for i, value in enumerate(text) if value == '\f']
    starts = [0] + [i + 1 for i in boundaries]
    ends = boundaries + [len(text)]
    if text.endswith('\f'):
        starts.pop()
        ends.pop()
    if len(starts) != expected_pages:
        return [], ['page-marker-count-mismatch']
    return list(zip(starts, ends)), []


def locate_chunks(text: str, chunks: list[dict], expected_pages: int,
                  source_issues: list[str] | None = None) -> dict:
    pages, page_issues = page_intervals(text, expected_pages)
    issues = list(source_issues or []) + page_issues
    page_rows = [{'physicalPage': i + 1, 'rawStart': utf16_length(text[:a]),
                  'rawEnd': utf16_length(text[:b]), 'hasNonWhitespaceText': bool(text[a:b].strip())}
                 for i, (a, b) in enumerate(pages)] if not issues else []
    rows = []
    retained_markers: Counter[int] = Counter()
    all_markers = {i for i, char in enumerate(text) if char == '\f'}
    cumulative = 1
    for chunk in chunks:
        value = chunk['text']
        row = {'chunkIndex': chunk['index'], 'chunkTextSha256': sha(value.encode()),
               'chunkUtf16Length': utf16_length(value), 'formFeedOccurrences': value.count('\f'),
               'status': 'unavailable', 'reasons': list(issues)}
        if not value.strip():
            row['reasons'].append('empty-or-whitespace-chunk')
        else:
            first = text.find(value)
            second = text.find(value, first + 1) if first >= 0 else -1
            row['exactMatchCount'] = 0 if first < 0 else 1 if second < 0 else 'at-least-two'
            if first < 0:
                row['reasons'].append('chunk-not-an-exact-native-substring')
            elif second >= 0:
                row['reasons'].append('ambiguous-repeated-native-substring')
            if not row['reasons']:
                end = first + len(value)
                spans = [(i + 1, max(a, first), min(b, end)) for i, (a, b) in enumerate(pages)
                         if a < end and b > first and text[max(a, first):min(b, end)].strip()]
                if not spans:
                    row['reasons'].append('no-nonwhitespace-page-span')
                else:
                    physical = [p for p, _, _ in spans]
                    row.update(status='mapped', rawStart=utf16_length(text[:first]), rawEnd=utf16_length(text[:end]),
                               physicalPages=physical, physicalPageRange=[physical[0], physical[-1]],
                               pageSpans=[{'physicalPage': p, 'rawStart': utf16_length(text[:a]),
                                           'rawEnd': utf16_length(text[:b]), 'chunkStart': utf16_length(text[first:a]),
                                           'chunkEnd': utf16_length(text[first:b])} for p, a, b in spans],
                               chunkOrdinalAsSinglePageCounterexample=physical != [chunk['index'] + 1],
                               cumulativeFormFeedStartCounterexample=cumulative != physical[0])
                    retained_markers.update(i for i in all_markers if first <= i < end)
        rows.append(row)
        cumulative += value.count('\f')
    mapped = [row for row in rows if row['status'] == 'mapped']
    missing_markers = all_markers - retained_markers.keys()
    return {'offsetUnit': 'utf16-code-units', 'sourceIssues': issues, 'pages': page_rows, 'chunks': rows,
            'counts': {'manifestPages': expected_pages, 'rawFormFeeds': len(all_markers), 'chunks': len(rows),
                       'mappedChunks': len(mapped), 'unavailableChunks': len(rows) - len(mapped),
                       'multiplePhysicalPageChunks': sum(len(row['physicalPages']) > 1 for row in mapped),
                       'chunkOrdinalCounterexamples': sum(row['chunkOrdinalAsSinglePageCounterexample'] for row in mapped),
                       'cumulativeMarkerStartCounterexamples': sum(row['cumulativeFormFeedStartCounterexample'] for row in mapped),
                       'chunkFormFeedOccurrences': sum(row['formFeedOccurrences'] for row in rows),
                       'distinctMappedFormFeedOffsets': len(retained_markers),
                       'duplicatedMappedFormFeedOccurrences': sum(retained_markers.values()) - len(retained_markers),
                       'unmappedRawFormFeedOffsets': len(missing_markers),
                       'onlyUnmappedMarkerIsTerminal': missing_markers == {len(text) - 1} and text.endswith('\f'),
                       'physicalPagesWithMappedText': len({p for row in mapped for p in row['physicalPages']})}}


def checked_chunks(chunks: object) -> list[dict]:
    if not isinstance(chunks, list) or not chunks:
        raise ValueError('chunk-receipt-must-be-nonempty-array')
    for index, row in enumerate(chunks):
        if (not isinstance(row, dict) or type(row.get('index')) is not int or row['index'] != index
                or not isinstance(row.get('text'), str)
                or type(row.get('characterCount')) is not int or row['characterCount'] != utf16_length(row['text'])):
            raise ValueError('invalid-chunk-index-text-or-utf16-length')
    return chunks


def audit_source(source: dict, raw_path: Path, chunks_path: Path, parser_row: dict) -> dict:
    pdf_path = Path(source['publicPdf'])
    raw_bytes = raw_path.read_bytes()
    chunk_bytes = chunks_path.read_bytes()
    identities = {'pdf': file_identity(pdf_path), 'nativeText': file_identity(raw_path, raw_bytes),
                  'chunkReceipt': file_identity(chunks_path, chunk_bytes)}
    if len(raw_bytes) > MAX_TEXT_BYTES:
        raise ValueError('native-text-byte-limit')
    text = raw_bytes.decode('utf-8')  # Do not normalize CRLF or strip form feeds.
    chunks = checked_chunks(json.loads(chunk_bytes))
    issues = []
    if identities['pdf']['sha256'] != source['pdfSha256']:
        issues.append('pdf-hash-mismatch')
    native_bound = not (parser_row.get('pdfSha256') != source['pdfSha256']
            or parser_row.get('rawTextSha256') != identities['nativeText']['sha256']
            or type(parser_row.get('nativeCalls')) is not int or parser_row['nativeCalls'] != 1
            or type(parser_row.get('toolkitCalls')) is not int or parser_row['toolkitCalls'] != 0
            or parser_row.get('rawBytesEqualToRetainedNative') is not True
            or identities['pdf']['sha256'] != source['pdfSha256'])
    if not native_bound:
        issues.append('native-parser-receipt-binding-unavailable')
    recorded = checked_chunks(source['chunks'])
    if chunks != recorded:
        issues.append('chunk-receipt-manifest-mismatch')
    manifest = source['manifest']
    if (source_chunks_hash(chunks) != manifest['sourceTextHash']
            or manifest['chunkCount'] != len(chunks) or manifest['indexedCount'] != len(chunks)
            or manifest['characterCount'] != sum(utf16_length(c['text']) for c in chunks)):
        issues.append('chunk-manifest-hash-or-count-mismatch')
    locations = locate_chunks(text, chunks, source['pages'], issues)
    return {'chapter': source['chapter'], 'materialId': source['materialId'], 'name': source['name'],
            'identities': identities, 'recordedPdfSha256': source['pdfSha256'],
            'rawTextSha256': identities['nativeText']['sha256'], 'chunkSourceTextHash': source_chunks_hash(chunks),
            'parserPolicyVersion': parser_row.get('newParserPolicyVersion'),
            'actualParserEvidence': 'retained-native-call-and-exact-byte-receipt' if native_bound else 'unavailable',
            'physicalPageCountBasis': 'pinned-input-manifest; not independently parsed by this helper',
            **locations}


def audit_corpus(manifest_path: Path, parser_path: Path, raw_dir: Path, chunk_dir: Path,
                 raw_pattern: str, chunk_pattern: str) -> dict:
    for pattern in [raw_pattern, chunk_pattern]:
        if not re.fullmatch(r'[\w.-]*(?:\{chapter\}|\{chapter:02d\})[\w.-]*', pattern):
            raise ValueError('filename-pattern-requires-one-bounded-chapter-placeholder')
    manifest_bytes, parser_bytes = manifest_path.read_bytes(), parser_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    parser = json.loads(parser_bytes)
    if parser.get('status') != 'completed-matching' or parser.get('fixtureSha256') != sha(manifest_bytes):
        raise ValueError('parser-receipt-manifest-binding-mismatch')
    sources = manifest['sources']
    if (not sources or any(type(s.get('chapter')) is not int for s in sources)
            or len({s['chapter'] for s in sources}) != len(sources)
            or len({s.get('materialId') for s in sources}) != len(sources)):
        raise ValueError('missing-or-duplicate-source-chapter')
    if any(type(s.get('pages')) is not int or s['pages'] < 1
           or not isinstance(s.get('pdfSha256'), str) or not re.fullmatch(r'[a-f0-9]{64}', s['pdfSha256'])
           or not isinstance(s.get('materialId'), str) or not s['materialId'] for s in sources):
        raise ValueError('invalid-source-identity-or-page-count')
    rows = []
    for source in sources:
        matches = [r for r in parser['sources'] if r['chapter'] == source['chapter']]
        if len(matches) != 1:
            raise ValueError('missing-or-duplicate-native-parser-source')
        rows.append(audit_source(source, raw_dir / raw_pattern.format(chapter=source['chapter']),
                                 chunk_dir / chunk_pattern.format(chapter=source['chapter']), matches[0]))
    keys = [k for k, v in rows[0]['counts'].items() if type(v) is int]
    totals = {key: sum(row['counts'][key] for row in rows) for key in keys}
    return {'version': 1, 'status': 'completed' if totals['unavailableChunks'] == 0 else 'completed-with-unavailable-locations',
            'createdAt': datetime.now(timezone.utc).isoformat(), 'offsetUnit': 'utf16-code-units',
            'inputs': {'manifest': file_identity(manifest_path, manifest_bytes), 'parserReceipt': file_identity(parser_path, parser_bytes),
                       'rawDirectory': str(raw_dir.resolve()), 'chunkDirectory': str(chunk_dir.resolve()),
                       'rawPattern': raw_pattern, 'chunkPattern': chunk_pattern},
            'totals': {'files': len(rows), **totals}, 'sources': rows,
            'isolation': {'runtimeImports': 0, 'providerCalls': 0, 'databaseCalls': 0, 'networkCalls': 0,
                          'productionMutations': 0},
            'limitations': ['Physical PDF order is inferred from exact native form feeds and the supplied page count; this helper does not parse PDF structure.',
                            'Only unique exact native substrings receive locations. Repeated, empty, stale or unmatched chunks remain unavailable.',
                            'Page spans refer to non-whitespace text intersections; physicalPageRange can include intervening blank pages.',
                            'Chunk ordinal and cumulative-form-feed counterexamples are locator diagnostics, not counts of existing incorrect product citations.',
                            'A physical location proves neither visual readability, geometry, semantic support nor question quality. No generation/adoption occurs.']}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['manifest', 'parser-receipt', 'raw-dir', 'chunk-dir', 'output']:
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--raw-pattern', required=True)
    parser.add_argument('--chunk-pattern', required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('output directory already exists; old observations are never overwritten')
    report = audit_corpus(args.manifest, args.parser_receipt, args.raw_dir, args.chunk_dir,
                          args.raw_pattern, args.chunk_pattern)
    identities = [report['inputs']['manifest'], report['inputs']['parserReceipt']]
    identities += [p for source in report['sources'] for p in source['identities'].values()]
    for original in identities:
        if file_identity(Path(original['file'])) != original:
            raise ValueError('input-file-changed-during-audit')
    report['helper'] = file_identity(Path(__file__))
    args.output.mkdir()
    with (args.output / 'results.json').open('x') as output:
        json.dump(report, output, ensure_ascii=True, indent=2)
        output.write('\n')
    print(json.dumps({'output': str((args.output / 'results.json').resolve()), 'status': report['status'], 'totals': report['totals']}))


if __name__ == '__main__':
    main()
