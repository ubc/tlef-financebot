import { materialSourceUrl, type GenerationQualityAssessment, type SourceLocation } from '../../api.js';
import { el } from '../../dom.js';

function physicalPages(location: SourceLocation | undefined, materialId: string | undefined): number[] {
  const hash = (value: string) => /^[a-f0-9]{64}$/.test(value);
  if (location?.status !== 'verified' || location.version !== 'pdf-source-location-v1' || location.offsetUnit !== 'utf16-code-units' ||
      !/^[a-f0-9]{24}$/.test(location.provenanceId) || !/^[a-f0-9]{24}$/.test(materialId ?? '') ||
      ![location.pdfSha256, location.rawTextSha256, location.pageMapSha256, location.chunkTextSha256].every(hash) ||
      ![location.rawStart, location.rawEnd, location.chunkStart, location.chunkEnd].every(Number.isSafeInteger) ||
      location.rawStart < 0 || location.chunkStart < 0 || location.rawEnd <= location.rawStart || location.chunkEnd <= location.chunkStart ||
      location.rawEnd - location.rawStart !== location.chunkEnd - location.chunkStart ||
      !Array.isArray(location.pageSpans) || !location.pageSpans.length || location.pageSpans.length > 100_000) return [];
  for (const [index, span] of location.pageSpans.entries()) {
    if (!span || ![span.physicalPage, span.rawStart, span.rawEnd, span.chunkStart, span.chunkEnd].every(Number.isSafeInteger) || span.physicalPage < 1 ||
        span.rawStart < location.rawStart || span.rawEnd > location.rawEnd || span.rawEnd <= span.rawStart ||
        span.chunkStart < location.chunkStart || span.chunkEnd > location.chunkEnd || span.chunkEnd <= span.chunkStart ||
        span.rawStart !== location.rawStart + span.chunkStart - location.chunkStart || span.rawEnd !== location.rawStart + span.chunkEnd - location.chunkStart ||
        (index > 0 && (span.physicalPage <= location.pageSpans[index - 1].physicalPage || span.chunkStart < location.pageSpans[index - 1].chunkEnd))) return [];
  }
  return location.pageSpans.map(span => span.physicalPage);
}

/** A page link locates retained source text; the model's support verdict stays separate. */
export function sourceCitationDetails(courseId: string, citations: GenerationQualityAssessment['citations'] | undefined): HTMLElement | false {
  if (!Array.isArray(citations) || !citations.length) return false;
  return el('details', {}, el('summary', { text: `Source quotations (${citations.length})` }),
    ...citations.map(citation => {
      const location = citation.sourceLocation;
      const pages = physicalPages(location, citation.materialId);
      return el('article', { class: 'workspace-metadata-block', style: 'overflow-wrap:anywhere' }, el('p', {}, el('strong', { text: citation.claim })),
        el('blockquote', { text: citation.quote }),
        pages.length && location?.status === 'verified'
          ? el('div', { class: 'row' }, ...pages.slice(0, 8).map(page => el('a', {
            class: 'btn btn--ghost btn--sm', href: `${materialSourceUrl(courseId, citation.materialId!, location.provenanceId)}#page=${page}`,
            target: '_blank', rel: 'noopener', text: `PDF p. ${page}`,
          })), pages.length > 8 ? el('span', { text: `${pages.length - 8} additional pages in this quotation` }) : false)
          : el('p', { class: 'workspace-muted', text: 'Physical page not recorded for this quotation.' }));
    }));
}
