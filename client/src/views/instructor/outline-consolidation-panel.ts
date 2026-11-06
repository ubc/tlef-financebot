import { getStructureConsolidation, proposeStructureConsolidation, reviewStructureConsolidation,
  type StructureConsolidationView, type StructureConsolidationProposal, type ContentRunSummary } from '../../api.js';
import { el } from '../../dom.js';
import { confirmDialog } from '../../modal.js';

const VERSION = 'durable-outline-consolidation-v1';
/** Separate unreviewed proposal and reviewed draft. This panel never starts a
 * review, switches the visible draft, or applies a hierarchy automatically. */
export function createOutlineConsolidationPanel(courseId: string, callbacks: {
  onView(view: StructureConsolidationView): Promise<void>;
  onSelectDraft(runId: string): Promise<void>;
  onBusyChange(): void;
}) {
  const element = el('section', { class: 'structure-ai-coverage', 'aria-label': 'Consolidate overlapping objectives' });
  const details = el('details', {}, el('summary', { text: 'Consolidate overlapping objectives · experimental' }));
  const body = el('div', { class: 'structure-ai-coverage-body' }); details.append(body); element.append(details); element.hidden = true;
  let view: StructureConsolidationView | undefined, proposal: StructureConsolidationProposal | undefined;
  let requestRunId = '', loading = false, sending = false, unknown = false, disposed = false, ticket = 0, page = 1, query = '', notice = '';
  const selected = new Set<string>();
  const busy = () => sending || unknown || view?.state === 'proposing' || view?.state === 'reviewing';
  const notify = () => { draw(); callbacks.onBusyChange(); };
  async function load(runId: string) {
    const request = ++ticket; loading = true; requestRunId = runId; element.hidden = false; draw();
    try {
      const next = await getStructureConsolidation(courseId, runId);
      if (next?.version !== VERSION || !Array.isArray(next.candidates) || !Array.isArray(next.selectedIds) ||
        typeof next.parentRunId !== 'string' || typeof next.canApply !== 'boolean' || typeof next.canReview !== 'boolean' ||
        next.scope !== 'full-child-fresh-source-and-capability-review') throw new Error('Unverified consolidation status');
      if (disposed || request !== ticket) return;
      if (view?.proposalHash !== next.proposalHash || view?.parentRunId !== next.parentRunId) proposal = next.proposal ? JSON.parse(JSON.stringify(next.proposal)) as StructureConsolidationProposal : undefined;
      if (view?.parentRunId !== next.parentRunId) { selected.clear(); page = 1; }
      view = next; loading = false; unknown = false; notice = ''; notify(); await callbacks.onView(next);
    } catch {
      if (!disposed && request === ticket) { loading = false; notice = 'Could not verify consolidation status. Your original draft and edits are retained. Refresh status before continuing.'; notify(); }
      throw new Error('Consolidation status unavailable');
    }
  }
  async function start() {
    if (!view?.available || busy() || loading || selected.size === 1 || selected.size > 4) return;
    if (!await confirmDialog({ title: 'Propose a consolidation?', message: 'This uses the remaining allowance of this outline. The proposal is unreviewed; a separate full source and capability review must fit before it can be applied. Your original draft stays available.', confirmLabel: 'Create proposal' })) return;
    sending = true; notice = ''; notify();
    try { const response = await proposeStructureConsolidation(courseId, view.parentRunId, [...selected]); await load(response.runId); }
    catch { unknown = true; notice = 'The request outcome is unknown. Refresh status to recover any saved proposal; no automatic retry was started.'; }
    finally { sending = false; notify(); }
  }
  async function review() {
    if (!view?.canReview || !proposal || busy() || loading) return;
    if (!await confirmDialog({ title: 'Review the complete consolidated outline?', message: 'Every child objective and its nominated peers will receive fresh review against complete original sources. All previous recorded credits must be preserved. The server refuses before queuing if the complete review cannot fit the inherited allowance.', confirmLabel: 'Start full fresh review' })) return;
    sending = true; notify();
    try { const response = await reviewStructureConsolidation(courseId, view.parentRunId, view, proposal); await load(response.runId); }
    catch { unknown = true; notice = 'The review request could not be confirmed. Refresh status to recover the saved child. Your original draft is retained.'; }
    finally { sending = false; notify(); }
  }
  function draw() {
    if (disposed) return;
    const restoreSearch = document.activeElement instanceof HTMLInputElement && document.activeElement.getAttribute('aria-label') === 'Find objectives to consolidate'
      ? document.activeElement.selectionStart : null;
    body.replaceChildren(el('p', { class: 'structure-ai-note', text: 'Create a narrower proposal, inspect its lineage, then review the whole child outline. Shared sources and nominated pairs are retrieval hints, not proof of duplicate capabilities. Nothing is applied automatically.' }));
    body.append(el('p', { role: 'status', text: notice || (loading ? 'Checking saved status…' : view?.state ? `Status: ${view.state}${view.state === 'proposed' ? ' · proposal is unreviewed' : ''}` : view?.reason || '') }));
    if (requestRunId) body.append(el('button', { type: 'button', class: 'btn btn--ghost btn--sm', disabled: loading || sending,
      onclick: () => { void load(requestRunId).catch(() => {}); } }, 'Refresh status'));
    if (!view) return;
    if (view.budget) body.append(el('p', { class: 'structure-ai-note', text: `${view.budget.remainingUnits.toLocaleString()} conservative units · ${view.budget.remainingSends} SDK sends remaining in the original shared allowance. These are reservations, not actual tokens or cost.` }));
    if (view.available) {
      const search = el('input', { class: 'input', type: 'search', value: query, 'aria-label': 'Find objectives to consolidate', placeholder: 'Find topic or objective', oninput: () => { query = search.value; page = 1; draw(); } }) as HTMLInputElement;
      body.append(el('p', { class: 'structure-ai-note', text: 'Choose 2–4 source-supported objectives, or leave the selection empty to use a server-nominated group.' }), search);
      const candidates = view.candidates.filter(row => `${row.id} ${row.topic} ${row.name}`.toLowerCase().includes(query.toLowerCase()));
      const pages = Math.max(1, Math.ceil(candidates.length / 10)); page = Math.min(page, pages);
      for (const row of candidates.slice((page - 1) * 10, page * 10)) {
        const check = el('input', { type: 'checkbox', checked: selected.has(row.id), disabled: busy() || loading || selected.size >= 4 && !selected.has(row.id),
          onchange: () => { if (check.checked) selected.add(row.id); else selected.delete(row.id); draw(); } }) as HTMLInputElement;
        body.append(el('label', {}, check, el('span', { text: `${row.id} · ${row.name}` }), el('small', { text: ` ${row.topic} · ${row.coveredPoints} old recorded points` })));
      }
      body.append(el('p', { class: 'structure-ai-note', text: `${selected.size} selected · Page ${page} of ${pages}` }),
        el('button', { type: 'button', class: 'btn btn--ghost btn--sm', disabled: page <= 1, onclick: () => { page--; draw(); } }, 'Previous'),
        el('button', { type: 'button', class: 'btn btn--ghost btn--sm', disabled: page >= pages, onclick: () => { page++; draw(); } }, 'Next'),
        el('button', { type: 'button', class: 'btn btn--instr-primary btn--sm', disabled: busy() || loading || selected.size === 1 || selected.size > 4,
          onclick: () => { void start(); } }, selected.size ? 'Propose for selected objectives' : 'Propose a nominated group'));
    }
    if (proposal) {
      body.append(el('h3', { text: 'Unreviewed proposal' }));
      for (const change of view.changes ?? []) {
        const replacement = proposal.replacements.find(row => row.id === change.id);
        const card = el('div', { class: 'structure-ai-evidence' }, el('strong', { text: change.id }), el('p', { text: `Before: ${change.before}` }));
        if (replacement) {
          const name = el('textarea', { class: 'input', rows: 2, maxlength: 12000, 'aria-label': `Proposed ${change.id} wording`, text: replacement.name,
            disabled: !view.canReview || busy(), oninput: () => { replacement.name = name.value; } }) as HTMLTextAreaElement;
          card.append(el('label', {}, 'Proposed wording', name), el('small', { text: `Assigned points: ${replacement.evidenceIds.join(', ')} · assignments grant no coverage` }));
        } else card.append(el('p', { text: 'Retired in this proposal; its duties remain on the explicit successors.' }));
        card.append(el('p', { text: `Successors: ${proposal.lineage.find(row => row.previousId === change.id)?.successorIds.join(', ') ?? 'Unavailable'}` }));
        body.append(card);
      }
      const originals = el('details', {}, el('summary', { text: 'Exact source points, original sections and old-credit obligations' }));
      for (const point of view.obligations?.points ?? []) originals.append(el('p', { text: `${point.id} · ${point.objective} (${point.sourceIds.join(', ')})` }));
      for (const credit of view.obligations?.oldCredits ?? []) originals.append(el('p', { text: `Preserve ${credit.evidenceId} for ${credit.previousOwnerIds.join(', ')}` }));
      for (const source of view.obligations?.originals ?? []) originals.append(el('p', { text: `${source.alias} · original ${source.id} · ${source.materialName}` }), el('blockquote', { text: source.text }));
      body.append(originals);
      if (view.state === 'proposed') body.append(el('button', { type: 'button', class: 'btn btn--instr-primary btn--sm', disabled: !view.canReview || busy() || loading,
        onclick: () => { void review(); } }, 'Review complete child outline'),
      el('p', { class: 'structure-ai-note', text: view.canReview ? 'The final server check may refuse changed sources or insufficient allowance. This is not approval.' : 'A full review is currently unavailable. The proposal remains unreviewed and cannot be applied.' }));
    }
    if (view.canApply && view.reviewRunId) body.append(el('button', { type: 'button', class: 'btn btn--instr-primary btn--sm', disabled: loading || busy(),
      onclick: () => { void callbacks.onSelectDraft(view!.reviewRunId!); } }, 'Inspect reviewed consolidated draft'));
    if (view.checkpointId) body.append(el('button', { type: 'button', class: 'btn btn--ghost btn--sm', disabled: loading || sending,
      onclick: () => { void callbacks.onSelectDraft(view!.parentRunId); } }, 'View original draft'));
    if (restoreSearch !== null) { const input = body.querySelector<HTMLInputElement>('input[type=search]'); input?.focus(); input?.setSelectionRange(restoreSearch, restoreSearch); }
  }
  return { element, load, refresh: () => requestRunId ? load(requestRunId) : Promise.resolve(),
    observe(value: ContentRunSummary) { if (value.kind === 'structure-generation' && value.structureConsolidation) void load(value._id).catch(() => {}); },
    get busy() { return !!busy(); }, get view() { return view; },
    clear() { ticket++; view = undefined; proposal = undefined; selected.clear(); requestRunId = ''; unknown = false; element.hidden = true; },
    dispose() { disposed = true; ticket++; },
  };
}
