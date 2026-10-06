import { el } from '../../dom.js';
import { errorState, loadingState } from '../../ui.js';
import { learningApi, DISCUSSION_CATEGORIES, type DiscussionData, type DiscussionPost, type PostInput, type DiscussionQuestion, type PostChange } from '../../student-learning-api.js';
import { rich, button, select, dialog } from './learning-workspace.js';
import { currentQuery, type RouteParams } from '../../router.js';

export async function renderDiscussion(outlet: HTMLElement, params: RouteParams, preview = false) {
  const courseId = params.id, api = learningApi(courseId, preview);
  const root = el('div', { class: 'discussion-workspace' }, loadingState('Loading discussion…')); outlet.append(root);
  let data: DiscussionData; let active = ''; let search = '', topic = '', status = 'all';
  const errorSlot = el('div', { role: 'status', 'aria-live': 'polite' });
  const load = async () => { data = await api.discussion(); if (!data.posts.some(p => p.id === active)) active = data.posts[0]?.id ?? ''; draw(); };
  const change = async (post: DiscussionPost, input: Omit<PostChange, 'revision'>) => {
    try { const changed = await api.postChange(post.id, { ...input, revision: post.revision }); if (changed.deleted) active = ''; await load(); return changed; }
    catch (error) { errorSlot.replaceChildren(errorState((error as Error).message)); if ((error as { status?: number }).status === 409) await load(); return undefined; }
  };
  const compose = async (questionId = '') => {
    const questions = await api.questions(); let selectedQuestion: DiscussionQuestion | undefined; let previewToken = 0;
    const questionPreview = el('div', { class: 'discussion-question-preview' });
    const field = (label: string, control: HTMLElement) => el('label', { class: 'discussion-field' }, el('span', { text: label }), control);
    const question = select('Related question', [['', 'None — general course post'], ...questions.map(q => [q.id, `${q.title.slice(0, 95)}`] as [string, string])], questionId, value => { void linkQuestion(value); });
    const topicSelect = select('Topic (optional)', [['', 'Optional'], ...data.themes.map(t => [t.id, t.name] as [string, string])], '', value => { loSelect.value = ''; rebuildLo(value); });
    const loSelect = select('Learning objective (optional)', [['', 'Optional'], ...data.los.map(l => [l.id, l.name] as [string, string])], '', () => {});
    const rebuildLo = (theme: string) => loSelect.replaceChildren(el('option', { value: '', text: 'Optional' }), ...data.los.filter(l => !theme || l.themeId === theme).map(l => el('option', { value: l.id, text: l.name })));
    const linkQuestion = async (id: string) => {
      const token = ++previewToken; selectedQuestion = questions.find(q => q.id === id);
      topicSelect.disabled = loSelect.disabled = !!selectedQuestion;
      topicSelect.value = selectedQuestion?.themeId ?? ''; rebuildLo(topicSelect.value); loSelect.value = selectedQuestion?.loId ?? '';
      questionPreview.replaceChildren(); if (!selectedQuestion) return;
      const result = await api.questionPreview(selectedQuestion.id); if (token !== previewToken || !modal.isConnected) return;
      questionPreview.replaceChildren(el('details', { open: true }, el('summary', { text: 'Preview question' }), rich(result.stem), ...result.options.map(o => el('div', { class: 'discussion-preview-option' }, el('strong', { text: o.key }), rich(o.text)))));
    };
    const title = el('input', { class: 'input', required: true, maxlength: 180, placeholder: 'What would you like to understand?', 'aria-label': 'Post title' });
    const text = el('textarea', { class: 'input', required: true, rows: 5, maxlength: 15000, placeholder: 'Explain what you tried and where you’re stuck.', 'aria-label': 'Post details' });
    const category = select('Post type', Object.entries(DISCUSSION_CATEGORIES), 'general', () => {});
    const audience = select('Audience', [['course', 'Course members'], ['staff', 'Teaching team only']], 'course', () => {});
    const anonymous = el('input', { type: 'checkbox' }); const errors = el('div', { role: 'status' });
    const form = el('form', { class: 'discussion-compose', onsubmit: async (event: Event) => {
      event.preventDefault(); if (!form.reportValidity()) return;
      const input: PostInput = { title: title.value, text: text.value, category: category.value as PostInput['category'], audience: audience.value as PostInput['audience'], anonymous: anonymous.checked, ...(question.value ? { questionId: question.value } : {}), ...(topicSelect.value ? { themeId: topicSelect.value } : {}), ...(loSelect.value ? { loId: loSelect.value } : {}) };
      try { const post = await api.post(input); active = post.id; modal.close(); await load(); } catch (error) { errors.replaceChildren(errorState((error as Error).message)); }
    } }, field('Related question', question), questionPreview, el('div', { class: 'discussion-form-grid' }, field('Topic · optional', topicSelect), field('Learning objective · optional', loSelect)), field('Title', title), field('Details', text), el('div', { class: 'discussion-form-grid' }, field('Post type', category), field('Audience', audience)), el('label', { class: 'discussion-anonymous' }, anonymous, ' Anonymous to classmates (teaching team can see your identity)'), errors, el('footer', { class: 'discussion-compose-footer' }, button('Cancel', () => modal.close()), el('button', { class: 'btn btn--instr-primary', type: 'submit', text: 'Publish post' })));
    const modal = dialog('New course post', form); modal.classList.add('discussion-compose-dialog');
    await linkQuestion(questionId);
  };
  const replyForm = (post: DiscussionPost, kind: 'student' | 'instructor' | 'followup') => {
    const text = el('textarea', { class: 'input', rows: 2, required: true, maxlength: 10000, 'aria-label': kind === 'followup' ? 'Follow-up' : 'Your answer', placeholder: kind === 'followup' ? 'Write a follow-up…' : 'Write an answer…' });
    const anon = el('input', { type: 'checkbox' });
    return el('form', { class: 'discussion-reply-form', onsubmit: async (event: Event) => { event.preventDefault(); if (!text.value.trim()) return; await change(post, { action: 'reply', kind, text: text.value, anonymous: kind === 'instructor' ? false : anon.checked }); } }, text, el('div', {}, kind !== 'instructor' ? el('label', {}, anon, ' Anonymous to classmates') : el('small', { text: 'Posted as a member of the teaching team' }), el('button', { class: 'btn btn--instr-primary btn--sm', type: 'submit', text: kind === 'followup' ? 'Post follow-up' : 'Post answer' })));
  };
  const author = (p: DiscussionPost['author']) => p.anonymous && p.puid ? `${p.name} · anonymous to classmates` : p.name;
  const section = (post: DiscussionPost, kind: 'student' | 'instructor' | 'followup', title: string) => {
    const replies = post.replies.filter(r => r.kind === kind);
    return el('section', { class: `discussion-answer-section discussion-answer-section--${kind}` }, el('h3', { text: `${title}${replies.length ? ` · ${replies.length}` : ''}` }), ...replies.map(r => el('article', { class: 'discussion-reply' }, el('div', { class: 'discussion-meta' }, el('strong', { text: author(r.author) }), el('time', { text: new Date(r.createdAt).toLocaleString() }), r.endorsed ? el('span', { class: 'discussion-badge', text: 'Instructor endorsed' }) : false), rich(r.text), kind === 'student' && data.staff ? button(r.endorsed ? 'Remove endorsement' : 'Endorse', () => change(post, { action: 'endorse', replyId: r.id, value: !r.endorsed })) : false)), !post.closed && (kind !== 'instructor' || data.staff) ? replyForm(post, kind) : false, !replies.length && post.closed ? el('p', { class: 'muted', text: 'No answers.' }) : false);
  };
  const draw = () => {
    const feedList = el('div', { class: 'discussion-feed-list' });
    const filtered = data.posts.filter(p => (!search || `${p.title} ${p.text}`.toLowerCase().includes(search.toLowerCase())) && (!topic || p.themeId === topic) && (status === 'all' || status === 'unanswered' && p.category !== 'note' && !p.replies.some(r => r.kind === 'student' || r.kind === 'instructor') || status === 'resolved' && p.resolved || status === 'following' && p.following));
    const searchInput = el('input', { class: 'input', placeholder: 'Search posts…', 'aria-label': 'Search discussion', value: search, oninput: () => { search = searchInput.value; feed(); } });
    const feed = () => {
      const posts = data.posts.filter(p => (!search || `${p.title} ${p.text}`.toLowerCase().includes(search.toLowerCase())) && (!topic || p.themeId === topic) && (status === 'all' || status === 'unanswered' && p.category !== 'note' && !p.replies.some(r => r.kind === 'student' || r.kind === 'instructor') || status === 'resolved' && p.resolved || status === 'following' && p.following));
      feedList.replaceChildren(...posts.map(p => el('button', { class: `discussion-feed-item${p.id === active ? ' is-active' : ''}`, type: 'button', onclick: () => { active = p.id; draw(); } }, el('div', { class: 'discussion-meta' }, p.pinned ? el('span', { text: 'Pinned · ' }) : false, el('span', { text: DISCUSSION_CATEGORIES[p.category] }), el('span', { text: new Date(p.updatedAt).toLocaleDateString() })), el('strong', { text: p.title }), el('p', { text: p.text.slice(0, 95) }), el('div', { class: 'discussion-meta' }, el('span', { text: author(p.author) }), p.replies.some(r => r.kind === 'student') ? el('span', { class: 'discussion-badge', text: 's' }) : false, p.replies.some(r => r.kind === 'instructor') ? el('span', { class: 'discussion-badge', text: 'i' }) : false, p.resolved ? el('span', { text: 'Resolved' }) : false, p.closed ? el('span', { text: 'Closed' }) : false, el('span', { text: `${p.replies.length} replies` })))));
    };
    const rail = el('aside', { class: 'discussion-feed' }, el('div', { class: 'discussion-feed-controls' }, el('div', { class: 'row' }, el('h1', { text: 'Discussion' }), button('New post', () => compose(), 'btn btn--instr-primary btn--sm')), searchInput, select('Post status', [['all', 'All posts'], ['unanswered', 'Unanswered'], ['resolved', 'Resolved'], ['following', 'Following']], status, value => { status = value; feed(); }), select('Topic', [['', 'All topics'], ...data.themes.map(t => [t.id, t.name] as [string, string])], topic, value => { topic = value; feed(); })), feedList);
    const pane = el('main', { class: 'discussion-thread' }); const post = data.posts.find(p => p.id === active) ?? filtered[0];
    if (!post) pane.append(el('div', { class: 'discussion-empty' }, el('h2', { text: 'Start a course discussion' }), el('p', { text: 'Ask a question or share a note with your course.' }), button('New post', () => compose(), 'btn btn--instr-primary')));
    else {
      const controls = el('div', { class: 'discussion-thread-tools' }, button(`${post.voted ? '✓ ' : ''}Same question · ${post.votes}`, () => change(post, { action: 'vote' })), button(post.following ? 'Following' : 'Follow', () => change(post, { action: 'follow' })), data.staff ? button(post.resolved ? 'Mark unresolved' : 'Mark resolved', () => change(post, { action: 'resolve' })) : false,
        data.moderator ? button(post.pinned ? 'Unpin' : 'Pin', () => change(post, { action: 'pin' })) : false,
        data.moderator ? button(post.closed ? 'Reopen post' : 'Close post', () => change(post, { action: post.closed ? 'reopen' : 'close' })) : false,
        data.moderator ? button('Delete', () => {
          const popup = dialog('Delete this post?', el('div', { class: 'stack' }, el('p', { text: 'The post will be hidden from the course. You can undo this deletion.' }), button('Delete post', async () => { const deleted = await change(post, { action: 'delete' }); popup.close(); if (deleted) errorSlot.replaceChildren(el('span', { text: 'Post deleted. ' }), button('Undo', async () => { await change(deleted, { action: 'restore' }); active = deleted.id; await load(); })); }, 'btn btn--danger')));
        }) : false);
      const tags = el('div', { class: 'discussion-meta' }, el('span', { text: DISCUSSION_CATEGORIES[post.category] }), post.audience === 'staff' ? el('span', { text: 'Teaching team only' }) : false, post.themeId ? el('span', { text: data.themes.find(t => t.id === post.themeId)?.name ?? '' }) : false, post.loId ? el('span', { text: data.los.find(l => l.id === post.loId)?.name ?? '' }) : false);
      const questionPanel = el('div');
      if (post.questionId) {
        const details = el('details', {}, el('summary', { text: 'Preview related question' }), questionPanel);
        details.addEventListener('toggle', async () => { if (details.open && !questionPanel.childElementCount) { try { const q = await api.questionPreview(post.questionId!); if (details.isConnected) questionPanel.replaceChildren(rich(q.stem), ...q.options.map(o => el('div', { class: 'discussion-preview-option' }, el('strong', { text: o.key }), rich(o.text)))); } catch (error) { questionPanel.replaceChildren(errorState((error as Error).message)); } } });
        questionPanel.dataset.questionPreview = 'true'; pane.append(el('header', { class: 'discussion-thread-header' }, tags, el('h2', { text: post.title }), el('div', { class: 'discussion-meta', text: `${author(post.author)} · ${new Date(post.createdAt).toLocaleString()}` }), controls), el('article', { class: 'discussion-post-body' }, rich(post.text), details));
      } else pane.append(el('header', { class: 'discussion-thread-header' }, tags, el('h2', { text: post.title }), el('div', { class: 'discussion-meta', text: `${author(post.author)} · ${new Date(post.createdAt).toLocaleString()}` }), controls), el('article', { class: 'discussion-post-body' }, rich(post.text)));
      if (post.closed) pane.append(el('div', { class: 'discussion-closed', text: 'This post is closed. Existing answers remain available.' }));
      if (post.category !== 'note') pane.append(section(post, 'student', 'Students’ answers'), section(post, 'instructor', 'Instructors’ answer'));
      pane.append(section(post, 'followup', 'Follow-up discussion'));
    }
    if (data.hasMore) rail.append(button('Load more posts', async () => {
      try { const next = await api.discussion(data.posts.length); data.hasMore = next.hasMore; const known = new Set(data.posts.map(p => p.id)); data.posts.push(...next.posts.filter(p => !known.has(p.id))); draw(); }
      catch (error) { errorSlot.replaceChildren(errorState((error as Error).message)); }
    }));
    root.replaceChildren(rail, el('div', { class: 'discussion-detail' }, errorSlot, pane)); feed();
  };
  try { await load(); const questionId = currentQuery().get('questionId'); if (questionId) await compose(questionId); }
  catch (error) { root.replaceChildren(errorState((error as Error).message)); }
}
