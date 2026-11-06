import type { QuestionSimilarity } from '../../api.js';
import { el } from '../../dom.js';

const score = (link: { score: number } | null) => (link ? link.score.toFixed(2) : '—');

/** Informational similarity to the nearest question in the same LO and topic. */
export function similarityLabel(similarity: QuestionSimilarity | undefined): string {
  return similarity ? `LO ${score(similarity.lo)} · Topic ${score(similarity.topic)}` : '';
}

/** Links that open the nearest question in each scope; `false` when there are none. */
export function similarityLinks(courseId: string, similarity: QuestionSimilarity | undefined): HTMLElement | false {
  if (!similarity || (!similarity.lo && !similarity.topic)) return false;
  const href = (id: string) => `#/instructor/course/${encodeURIComponent(courseId)}/bank/${encodeURIComponent(id)}`;
  return el('p', { class: 'muted' },
    similarity.lo ? el('a', { href: href(similarity.lo.questionId), text: 'Nearest in LO' }) : false,
    similarity.lo && similarity.topic ? ' · ' : false,
    similarity.topic ? el('a', { href: href(similarity.topic.questionId), text: 'Nearest in topic' }) : false);
}
