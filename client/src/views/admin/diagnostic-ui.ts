import { el } from '../../dom.js';
import type { DiagnosticIdentities } from '../../api.js';

export const dateLabel = (value: string): string => new Date(value).toLocaleString();
export const diagnosticLink = (text: string, href: string): HTMLAnchorElement => el('a', { class: 'btn btn--ghost btn--sm', text, href });
export const field = (label: string, input: HTMLElement): HTMLElement => el('label', { class: 'stack stack--sm' }, el('span', { text: label }), input);
export function selectFilter(label: string, values: string[]): HTMLSelectElement {
  return el('select', { class: 'input', 'aria-label': label }, el('option', { value: '', text: 'All' }), ...values.map((value) => el('option', { value, text: value.replace(/-/g, ' ') })));
}
export function details(title: string, data: unknown): HTMLElement {
  return el('details', { class: 'diagnostic-evidence' }, el('summary', { text: title }), el('pre', { text: JSON.stringify(data, null, 2) ?? 'No data recorded.' }));
}
export function outcomeBadge(outcome: string): HTMLElement {
  const tone = ['failed', 'interrupted', 'partial', 'reject'].includes(outcome) ? 'down' : ['succeeded', 'completed', 'approved'].includes(outcome) ? 'up' : 'muted';
  return el('span', { class: `badge badge--${tone}`, text: outcome.replace(/-/g, ' '), title: outcome === 'accepted' ? 'The request was accepted. Inspect its linked task for the final outcome.' : undefined });
}
export function courseLabel(id: string | undefined, data: DiagnosticIdentities): string {
  const course = data.courses?.find((course) => course._id === id);
  return course ? `${course.courseCode} · ${course.name}${course.section ? ` (${course.section})` : ''}` : id ? `Course ${id}` : 'No course recorded';
}
export function userLabel(puid: string | undefined, data: DiagnosticIdentities): string {
  const user = data.users?.find((user) => user.puid === puid);
  return user ? `${user.displayName} (${user.uid || user.puid})` : puid || 'Unknown creator';
}
export function pager(page: number, total: number, load: (page: number) => Promise<void>): HTMLElement {
  return el('nav', { class: 'cluster', 'aria-label': 'Result pages' },
    el('button', { class: 'btn btn--secondary', text: 'Previous', disabled: page <= 1, onclick: () => load(page - 1) }),
    el('span', { text: `Page ${page} · ${total} results` }),
    el('button', { class: 'btn btn--secondary', text: 'Next', disabled: page * 25 >= total, onclick: () => load(page + 1) }));
}
