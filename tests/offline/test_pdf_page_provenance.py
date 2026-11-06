"""Standard-library checks; all source/receipt data here is synthetic."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
HELPER = ROOT / 'scripts/audit-pdf-page-provenance.py'
SPEC = importlib.util.spec_from_file_location('pdf_page_provenance', HELPER)
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


def chunks(*texts):
    return [{'index': i, 'text': text, 'characterCount': AUDIT.utf16_length(text)} for i, text in enumerate(texts)]


class PageLocationTests(unittest.TestCase):
    def test_terminal_form_feed_is_not_an_extra_page(self):
        pages, reasons = AUDIT.page_intervals('Alpha\fBeta\f', 2)
        self.assertEqual(pages, [(0, 5), (6, 10)])
        self.assertEqual(reasons, [])

    def test_leading_and_consecutive_markers_preserve_blank_physical_pages(self):
        report = AUDIT.locate_chunks('\f\fText\f', chunks('Text'), 3)
        self.assertEqual([p['hasNonWhitespaceText'] for p in report['pages']], [False, False, True])
        self.assertEqual(report['chunks'][0]['physicalPages'], [3])

    def test_nonterminal_last_page_is_retained(self):
        pages, reasons = AUDIT.page_intervals('A\fB', 2)
        self.assertEqual(pages, [(0, 1), (2, 3)])
        self.assertEqual(reasons, [])

    def test_single_page_without_marker_requires_matching_external_count(self):
        self.assertEqual(AUDIT.page_intervals('A', 1), ([(0, 1)], []))
        report = AUDIT.locate_chunks('A', chunks('A'), 2)
        self.assertEqual(report['chunks'][0]['status'], 'unavailable')
        self.assertIn('page-marker-count-mismatch', report['chunks'][0]['reasons'])
        self.assertNotIn('physicalPages', report['chunks'][0])

    def test_empty_native_text_and_invalid_page_count_are_unavailable(self):
        for raw, count, expected in [('\n\f\t', 1, 'native-text-empty'), ('A\f', True, 'invalid-manifest-page-count')]:
            self.assertIn(expected, AUDIT.page_intervals(raw, count)[1])

    def test_ambiguous_repeated_text_never_selects_the_first_match(self):
        report = AUDIT.locate_chunks('Same\fSame\f', chunks('Same'), 2)
        row = report['chunks'][0]
        self.assertEqual(row['exactMatchCount'], 'at-least-two')
        self.assertIn('ambiguous-repeated-native-substring', row['reasons'])
        self.assertNotIn('rawStart', row)

    def test_longer_exact_context_can_resolve_a_repeated_phrase(self):
        report = AUDIT.locate_chunks('One Same\fTwo Same\f', chunks('Two Same'), 2)
        self.assertEqual(report['chunks'][0]['physicalPages'], [2])

    def test_missing_and_empty_chunks_stay_explicitly_unavailable(self):
        report = AUDIT.locate_chunks('Original\f', chunks('Changed', '', '\n\t'), 1)
        self.assertEqual(report['counts']['unavailableChunks'], 3)
        self.assertIn('chunk-not-an-exact-native-substring', report['chunks'][0]['reasons'])
        self.assertEqual(report['counts']['physicalPagesWithMappedText'], 0)

    def test_overlap_does_not_double_count_page_boundaries(self):
        report = AUDIT.locate_chunks('A\fB\fC\f', chunks('A\fB\fC', 'B\fC'), 3)
        self.assertEqual([r['physicalPages'] for r in report['chunks']], [[1, 2, 3], [2, 3]])
        self.assertEqual(report['counts']['chunkFormFeedOccurrences'], 3)
        self.assertEqual(report['counts']['distinctMappedFormFeedOffsets'], 2)
        self.assertEqual(report['counts']['duplicatedMappedFormFeedOccurrences'], 1)
        self.assertTrue(report['counts']['onlyUnmappedMarkerIsTerminal'])
        self.assertEqual(report['counts']['cumulativeMarkerStartCounterexamples'], 1)

    def test_unicode_offsets_use_utf16_and_preserve_crlf(self):
        raw = '😀A\r\n\fβB\f'
        report = AUDIT.locate_chunks(raw, chunks('βB', '😀A\r\n\fβB'), 2)
        first, cross = report['chunks']
        self.assertEqual((first['rawStart'], first['rawEnd']), (6, 8))
        self.assertEqual(cross['rawEnd'], 8)
        self.assertEqual(cross['pageSpans'][0]['chunkEnd'], 5)
        self.assertEqual(cross['physicalPages'], [1, 2])

    def test_blank_intervening_page_is_kept_in_range_without_claiming_text(self):
        report = AUDIT.locate_chunks('A\f\fB\f', chunks('A\f\fB'), 3)
        self.assertEqual(report['chunks'][0]['physicalPages'], [1, 3])
        self.assertEqual(report['chunks'][0]['physicalPageRange'], [1, 3])
        self.assertFalse(report['pages'][1]['hasNonWhitespaceText'])

    def test_source_binding_failure_prevents_every_location(self):
        report = AUDIT.locate_chunks('A\fB\f', chunks('A', 'B'), 2, ['pdf-hash-mismatch'])
        self.assertEqual(report['counts']['mappedChunks'], 0)
        self.assertEqual(report['pages'], [])

    def test_chunk_index_and_javascript_character_count_are_checked(self):
        value = chunks('😀')
        self.assertEqual(AUDIT.checked_chunks(value), value)
        for altered in [[{'index': 1, 'text': 'A', 'characterCount': 1}], [{'index': 0, 'text': '😀', 'characterCount': 1}]]:
            with self.assertRaises(ValueError):
                AUDIT.checked_chunks(altered)


class ReceiptBindingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.pdf = self.base / 'source.pdf'
        self.pdf.write_bytes(b'%PDF-synthetic-hash-fixture-not-a-real-document')
        self.raw = self.base / 'chapter-01.native.txt'
        self.raw.write_bytes('😀A\r\n\fB\f'.encode())
        self.chunk_file = self.base / 'chapter-01.chunks.json'
        self.rows = chunks('😀A\r\n\fB', 'B')
        self.chunk_file.write_text(json.dumps(self.rows))
        self.source = {'chapter': 1, 'materialId': 'synthetic', 'name': 'Synthetic source', 'publicPdf': str(self.pdf),
                       'pdfSha256': AUDIT.sha(self.pdf.read_bytes()), 'pages': 2, 'chunks': self.rows,
                       'manifest': {'sourceTextHash': AUDIT.source_chunks_hash(self.rows), 'chunkCount': 2,
                                    'indexedCount': 2, 'characterCount': sum(r['characterCount'] for r in self.rows)}}
        self.parser_row = {'chapter': 1, 'pdfSha256': self.source['pdfSha256'], 'rawTextSha256': AUDIT.sha(self.raw.read_bytes()),
                           'nativeCalls': 1, 'toolkitCalls': 0, 'rawBytesEqualToRetainedNative': True}

    def audit(self):
        return AUDIT.audit_source(self.source, self.raw, self.chunk_file, self.parser_row)

    def test_exact_file_identities_and_raw_bytes_are_retained(self):
        report = self.audit()
        self.assertEqual(report['counts']['mappedChunks'], 2)
        self.assertEqual(report['identities']['nativeText']['sha256'], AUDIT.sha(self.raw.read_bytes()))
        self.assertEqual(report['chunks'][1]['rawStart'], 6)
        self.assertIn('not independently parsed', report['physicalPageCountBasis'])

    def test_changed_original_pdf_makes_physical_provenance_unavailable(self):
        self.pdf.write_bytes(b'changed')
        report = self.audit()
        self.assertEqual(report['counts']['mappedChunks'], 0)
        self.assertIn('pdf-hash-mismatch', report['sourceIssues'])
        self.assertEqual(report['actualParserEvidence'], 'unavailable')

    def test_toolkit_fallback_or_wrong_raw_hash_is_not_native_page_proof(self):
        for change in [{'nativeCalls': 0, 'toolkitCalls': 1}, {'rawTextSha256': '0' * 64}]:
            self.parser_row.update(change)
            report = self.audit()
            self.assertIn('native-parser-receipt-binding-unavailable', report['sourceIssues'])
            self.assertEqual(report['counts']['mappedChunks'], 0)

    def test_changed_chunks_cannot_reuse_a_good_manifest(self):
        self.chunk_file.write_text(json.dumps(chunks('B', 'B')))
        report = self.audit()
        self.assertIn('chunk-receipt-manifest-mismatch', report['sourceIssues'])
        self.assertIn('chunk-manifest-hash-or-count-mismatch', report['sourceIssues'])
        self.assertEqual(report['counts']['mappedChunks'], 0)

    def test_cli_writes_a_new_report_and_refuses_overwrite(self):
        manifest = self.base / 'manifest.json'
        manifest.write_text(json.dumps({'sources': [self.source]}))
        parser = self.base / 'parser.json'
        parser.write_text(json.dumps({'status': 'completed-matching', 'fixtureSha256': AUDIT.sha(manifest.read_bytes()), 'sources': [self.parser_row]}))
        output = self.base / 'output'
        command = [sys.executable, '-B', str(HELPER), '--manifest', str(manifest), '--parser-receipt', str(parser),
                   '--raw-dir', str(self.base), '--chunk-dir', str(self.base), '--raw-pattern', 'chapter-{chapter:02d}.native.txt',
                   '--chunk-pattern', 'chapter-{chapter:02d}.chunks.json', '--output', str(output)]
        first = subprocess.run(command, text=True, capture_output=True, timeout=10)
        self.assertEqual(first.returncode, 0, first.stderr)
        receipt = (output / 'results.json').read_bytes()
        self.assertEqual(json.loads(receipt)['isolation']['networkCalls'], 0)
        second = subprocess.run(command, text=True, capture_output=True, timeout=10)
        self.assertNotEqual(second.returncode, 0)
        self.assertEqual((output / 'results.json').read_bytes(), receipt)

    def test_unbound_manifest_and_path_pattern_are_rejected(self):
        manifest = self.base / 'manifest.json'
        manifest.write_text(json.dumps({'sources': [self.source]}))
        parser = self.base / 'parser.json'
        parser.write_text(json.dumps({'status': 'completed-matching', 'fixtureSha256': '0' * 64, 'sources': [self.parser_row]}))
        for pattern, expected in [('chapter-{chapter:02d}.native.txt', 'parser-receipt-manifest-binding-mismatch'),
                                  ('../../{chapter}.txt', 'filename-pattern')]:
            with self.assertRaisesRegex(ValueError, expected):
                AUDIT.audit_corpus(manifest, parser, self.base, self.base, pattern, 'chapter-{chapter}.chunks.json')


if __name__ == '__main__':
    unittest.main()
