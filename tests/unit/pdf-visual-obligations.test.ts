import { VISUAL_LIMITS, sha256, validateNativeReceipt, nativePageSignals, operatorSignals, pdfjsTextSignals,
  prioritizePage, assertAllPageAccounting, selectDiagnosticQueue } from '../../scripts/pdf-visual-audit/signals';
import type { NativeReceipt, PageLedgerRow } from '../../scripts/pdf-visual-audit/signals';
import { mapBounded, runBoundedChild } from '../../scripts/pdf-visual-audit/controller';

/** Synthetic mechanics fixtures; none labels or validates generated questions. */
function receipt(text: string): { pdf: Buffer; native: Buffer; receipt: NativeReceipt } {
  const pdf = Buffer.from('synthetic PDF identity, not parsed'); const native = Buffer.from(text);
  const chunks = text.split('\f'); if (chunks[chunks.length - 1] === '') chunks.pop();
  let offset = 0;
  const pages = chunks.map((chunk, index) => { const page = { physicalPage: index + 1, rawStart: offset, rawEnd: offset + chunk.length, hasNonWhitespaceText: !!chunk.trim() }; offset += chunk.length + 1; return page; });
  const map = { version: 'native-formfeed-pages-v1', offsetUnit: 'utf16-code-units', rawTextSha256: sha256(native), rawTextUtf16Length: text.length, pages };
  return { pdf, native, receipt: { pdfSha256: sha256(pdf), pdfBytes: pdf.length, rawTextSha256: sha256(native), rawTextBytes: native.length,
    rawTextUtf16Length: text.length, pageCount: { status: 'verified', count: pages.length },
    pageMap: { version: map.version, offsetUnit: map.offsetUnit, status: 'verified', sha256: sha256(JSON.stringify(map)), pages } } };
}
function row(chapter: number, physicalPage: number, text = 'Aswath Damodaran\n1', score = 1): PageLedgerRow {
  const native = nativePageSignals(text);
  return { chapter, physicalPage, pageId: `${chapter}:${physicalPage}`, native: { ...native, rawStart: 0, rawEnd: text.length, densityCharsPer1000Pt2: null },
    inspectionStatus: 'unknown', pdfjsText: null, operators: null, dimensions: null, interpretation: 'unknown', review: 'unreviewed',
    diagnosticReasons: ['interpretation-not-performed'], priorityScore: score };
}
const OPS = { constructPath: 1, stroke: 2, showText: 3, paintImageXObject: 4, fill: 5 };
describe('PDF visual-obligation signal ledger (synthetic mechanics)', () => {
  test('native map preserves blank/footer pages and UTF-16 physical offsets', () => {
    const fixture = receipt('\fAswath Damodaran\n2\f𝛽 = 1.3\f');
    expect(validateNativeReceipt(fixture.pdf, fixture.native, fixture.receipt)).toEqual(['', 'Aswath Damodaran\n2', '𝛽 = 1.3']);
    expect(fixture.receipt.pageMap.pages[0].hasNonWhitespaceText).toBe(false);
  });
  test.each(['pdf', 'native', 'map', 'count', 'hash', 'offset', 'invalid-utf8'] as const)('rejects tampered %s before inspection', kind => {
    const fixture = receipt('First\fSecond\f');
    if (kind === 'pdf') fixture.pdf[0] ^= 1;
    if (kind === 'native') fixture.native[0] ^= 1;
    if (kind === 'map') fixture.receipt.pageMap.pages[1].rawStart--;
    if (kind === 'count') fixture.receipt.pageCount.count--;
    if (kind === 'hash') fixture.receipt.pageMap.sha256 = '0'.repeat(64);
    if (kind === 'offset') fixture.receipt.rawTextUtf16Length--;
    if (kind === 'invalid-utf8') {
      fixture.native[0] = 255; fixture.receipt.rawTextSha256 = sha256(fixture.native);
    }
    expect(() => validateNativeReceipt(fixture.pdf, fixture.native, fixture.receipt)).toThrow();
  });
  test('refuses oversized native input and unverified map rather than trusting labels', () => {
    const fixture = receipt('Page\f');
    expect(() => validateNativeReceipt(fixture.pdf, Buffer.alloc(VISUAL_LIMITS.nativeBytes + 1), fixture.receipt)).toThrow('visual-input-byte-cap');
    fixture.receipt.pageMap.status = 'unavailable';
    expect(() => validateNativeReceipt(fixture.pdf, fixture.native, fixture.receipt)).toThrow('visual-page-map-unverified');
  });
  test('footer text is separate from blank text and never gains interpretation credit', () => {
    const blank = nativePageSignals(' \n'); const footer = nativePageSignals('Aswath Damodaran\n10');
    expect(blank.blankNativeText).toBe(true); expect(blank.footerOnlyCandidate).toBe(false);
    expect(footer.blankNativeText).toBe(false); expect(footer.footerOnlyCandidate).toBe(true);
    expect(prioritizePage(footer, null).reasons).toEqual(expect.arrayContaining(['native-text-matches-footer-only-heuristic', 'interpretation-not-performed']));
    expect(row(10, 10).interpretation).toBe('unknown'); expect(row(10, 10).review).toBe('unreviewed');
  });
  test('vector paths without image paints remain observable; no chart/table label is fabricated', () => {
    const signals = operatorSignals([1, 2, 3], [[new Uint8Array(60)], [], []], OPS);
    expect(signals).toMatchObject({ rasterImagePaints: 0, vectorPathConstructions: 1, vectorPathSegments: 60, vectorPaints: 1, textPaints: 1 });
    const priority = prioritizePage(nativePageSignals('2001 2002 2003 2004 0% 10% 20% 30%'), signals);
    expect(priority.reasons).toContain('many-vector-path-segments-observed');
    expect(JSON.stringify(priority)).not.toMatch(/chart|table|interpreted|covered/);
  });
  test('raster table and readable table controls yield signals only, with bounded literal numbers', () => {
    const raster = operatorSignals([4, 4], [[], []], OPS);
    expect(raster.rasterImagePaints).toBe(2); expect(raster.vectorPathSegments).toBe(0);
    const table = nativePageSignals('Company  Growth  Value\nA  2.5%  100\nB  3.0%  120\nC  4.5%  180\nD  5.0%  220');
    expect(table.numericLabelTokens).toBe(8); expect(table.numericExamples).toHaveLength(8); expect(table.footerOnlyCandidate).toBe(false);
    expect(prioritizePage(table, raster).reasons).toContain('native-numeric-label-tokens-observed');
    expect(pdfjsTextSignals([{ str: '2.5%' }, { str: '100' }, {}])).toMatchObject({ items: 3, numericLabelTokens: 2 });
  });
  test('title/decorative control is not called a graph or discarded from accounting', () => {
    const title = row(10, 1, 'Valuation\nCash flows, growth and risk.');
    expect(title.native.footerOnlyCandidate).toBe(false); expect(title.native.sparseNativeText).toBe(true);
    assertAllPageAccounting([title], [{ chapter: 10, pageCount: 1 }]);
    expect(title.interpretation).toBe('unknown');
  });
  test('operator/text caps refuse pathological payloads', () => {
    expect(() => operatorSignals({ length: VISUAL_LIMITS.operatorsPerPage + 1 }, [], OPS)).toThrow('visual-operator-cap-or-shape');
    expect(() => operatorSignals([1], [], OPS)).toThrow('visual-operator-cap-or-shape');
    expect(() => pdfjsTextSignals(Array(VISUAL_LIMITS.textItemsPerPage + 1).fill({}))).toThrow('visual-text-item-cap');
    expect(() => pdfjsTextSignals([{ str: 'a'.repeat(VISUAL_LIMITS.textCharsPerPage + 1) }])).toThrow('visual-text-character-cap');
  });
  test('all 599 declared pages remain accounted independent of the six-page/max-two-per-file queue', () => {
    const counts = [84, 21, 111, 87, 43, 90, 46, 40, 36, 41]; const chapters = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];
    const files = counts.map((pageCount, index) => ({ chapter: chapters[index], pageCount }));
    const rows = files.flatMap(file => Array.from({ length: file.pageCount }, (_, index) => row(file.chapter, index + 1, '', 1000 - file.chapter)));
    assertAllPageAccounting(rows, files); expect(rows).toHaveLength(599);
    const queue = selectDiagnosticQueue(rows); expect(queue).toHaveLength(6); expect(rows).toHaveLength(599);
    expect(queue.map(item => item.chapter)).toEqual([2, 2, 3, 3, 4, 4]);
    expect(() => assertAllPageAccounting(rows.slice(1), files)).toThrow('visual-page-accounting-count');
    expect(() => assertAllPageAccounting([rows[0], rows[0], ...rows.slice(2)], files)).toThrow('visual-duplicate-page');
  });
  test('same-size foreign-page substitution, fabricated interpretation and raised queue caps are refused', () => {
    expect(() => assertAllPageAccounting([row(9, 1)], [{ chapter: 10, pageCount: 1 }])).toThrow('visual-page-accounting-gap');
    const item = row(10, 1); Object.assign(item, { interpretation: 'understood' });
    expect(() => assertAllPageAccounting([item], [{ chapter: 10, pageCount: 1 }])).toThrow();
    expect(() => selectDiagnosticQueue([], 7)).toThrow('visual-queue-cap');
    expect(() => selectDiagnosticQueue([], 6, 3)).toThrow('visual-queue-cap');
  });
  test('bounded concurrency retains input order and never exceeds the two-worker cap', async () => {
    let active = 0; let peak = 0;
    const result = await mapBounded([1, 2, 3, 4], 2, async value => { active++; peak = Math.max(active, peak); await new Promise(resolve => setTimeout(resolve, 5)); active--; return value * 2; });
    expect(result).toEqual([2, 4, 6, 8]); expect(peak).toBe(2);
    await expect(mapBounded([], 3, async value => value)).rejects.toThrow('visual-concurrency-cap');
  });
  test('local child output overflow and timeout are terminal instead of trusted partial JSON', async () => {
    await expect(runBoundedChild(process.execPath, ['-e', 'process.stdout.write("x".repeat(10000))'], { timeoutMs: 2000, outputBytes: 100 })).rejects.toThrow('visual-worker-failed');
    await expect(runBoundedChild(process.execPath, ['-e', 'setTimeout(()=>{},2000)'], { timeoutMs: 30, outputBytes: 1000 })).rejects.toThrow('killed');
    expect(() => runBoundedChild(process.execPath, [], { timeoutMs: VISUAL_LIMITS.workerTimeoutMs + 1, outputBytes: 1000 })).toThrow('visual-worker-timeout-cap');
  });
  test('file-only worker fence refuses fetch, sockets, HTTP and DNS before a PDF runtime can import', async () => {
    const source = `const fence=require(${JSON.stringify(require.resolve('../../scripts/pdf-visual-audit/fence'))}).installFileOnlyFence();
      (async()=>{for(const action of [()=>fetch('https://example.invalid'),()=>require('node:net').connect(1,'127.0.0.1'),()=>require('node:http').get('http://127.0.0.1'),()=>require('node:dns').lookup('example.invalid')]){try{await action()}catch(error){if(error.message!=='visual-audit-network-forbidden')throw error}}process.stdout.write(JSON.stringify({attempts:fence.attempts()}))})().catch(()=>process.exit(1));`;
    const result = await runBoundedChild(process.execPath, ['--require', 'tsx/cjs', '-e', source], { timeoutMs: 4000, outputBytes: 1000 });
    expect(JSON.parse(result.stdout)).toEqual({ attempts: 4 });
  });
});
