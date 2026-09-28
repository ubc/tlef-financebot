/* Standalone design demonstration. No requests, persistence, or publication. */
const app = document.getElementById('app');
const breadcrumb = document.getElementById('breadcrumb');
const toast = document.getElementById('toast');
const exams = {
  midterm: { title: 'Fall midterm', kind: 'Midterm', status: 'Draft', state: 'draft', count: 12, points: 60, minutes: 75 },
  final: { title: 'Final exam', kind: 'Final', status: 'Published', state: 'published', count: 24, points: 100, minutes: 120 },
};
let screen = 'catalog';
let selectedExam = 'midterm';
let tab = 'paper';
let catalogFilter = 'all';
let expandedCheck = false;
let messageTimer;

function button(label, action, extra) {
  return '<button type="button" class="button ' + (extra || '') + '" data-action="' + action + '">' + label + '</button>';
}

function heading(kicker, title, description, actions) {
  return '<div class="page-heading"><div><div class="eyebrow">' + kicker + '</div><h1>' + title + '</h1><p class="lead">' + description + '</p></div><div class="heading-actions">' + (actions || '') + '</div></div>';
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(messageTimer);
  messageTimer = setTimeout(function () { toast.classList.remove('show'); }, 3600);
}

function catalog() {
  return [
    heading('ASSESSMENT WORKSPACE', 'Assessments', 'Build exams and LO quizzes, decide who can access them, then follow their results.', button('+ New assessment', 'new', 'primary')),
    '<div class="note"><strong>One place for assessed work.</strong> Midterms and finals use formal papers. A Topic / LO quiz is a proposed shorter assessment focused on selected course objectives. Exam Prep practice keeps separate feedback and mastery rules.</div>',
    '<div class="attention"><div><strong>Fall midterm needs 3 actions before publication</strong><p>Review one question, repair one variant, and confirm the student access window.</p></div>' + button('Continue midterm →', 'open-midterm') + '</div>',
    '<div class="catalog-toolbar"><div class="segmented" role="group" aria-label="Filter assessments">',
    '<button type="button" data-filter="all" class="' + (catalogFilter === 'all' ? 'active' : '') + '">All 4</button>',
    '<button type="button" data-filter="exams" class="' + (catalogFilter === 'exams' ? 'active' : '') + '">Exams 2</button>',
    '<button type="button" data-filter="quizzes" class="' + (catalogFilter === 'quizzes' ? 'active' : '') + '">Quizzes 1</button>',
    '<button type="button" data-filter="practice" class="' + (catalogFilter === 'practice' ? 'active' : '') + '">Practice 1</button></div>',
    '<input class="search" type="search" aria-label="Search assessments" placeholder="Search assessments…"></div>',
    '<section class="panel table-wrap" aria-label="Assessment list"><table class="catalog-table"><thead><tr><th>Assessment</th><th>Type</th><th>Status</th><th>Student access</th><th>Questions</th><th></th></tr></thead><tbody>',
    '<tr data-kind="exams" data-search="fall midterm"><td><strong>Fall midterm</strong><small>Last edited today · 3 actions needed</small></td><td>Formal exam</td><td><span class="pill amber">Draft</span></td><td>Not available</td><td>12</td><td>' + button('Open →', 'open-midterm') + '</td></tr>',
    '<tr data-kind="exams" data-search="final exam"><td><strong>Final exam</strong><small>Published revision 1</small></td><td>Formal exam</td><td><span class="pill green">Published</span></td><td>Sep 10 – Oct 18</td><td>24</td><td>' + button('Open →', 'open-final') + '</td></tr>',
    '<tr data-kind="quizzes" data-search="newton laws topic lo quiz"><td><strong>Newton’s laws LO quiz</strong><small>Proposed example · focused on 2 course LOs</small></td><td>Topic / LO quiz</td><td><span class="pill blue">Design concept</span></td><td>Not available</td><td>6</td><td>' + button('Explore →', 'open-quiz') + '</td></tr>',
    '<tr data-kind="practice" data-search="exam prep practice"><td><strong>Exam Prep practice</strong><small>Existing practice templates</small></td><td>Practice</td><td><span class="pill blue">Active</span></td><td>Available now</td><td>Question pool</td><td>' + button('Explore →', 'open-practice') + '</td></tr>',
    '</tbody></table></section>',
    '<p class="footer-note">Current product: Exam Builder supports Midterm / Final, and Exam Prep is separate. Topic / LO quiz is a proposed new type, not an implemented course feature.</p>',
  ].join('');
}

function newAssessment() {
  return [
    '<button type="button" class="back" data-action="back">← All assessments</button>',
    heading('ASSESSMENT WORKSPACE', 'What are you creating?', 'Choose the purpose first. Each type then uses the same paper, quality, access and preview workflow.'),
    '<div class="type-grid">',
    '<section class="panel type-card"><span class="pill green">CURRENT TYPE</span><h2>Midterm</h2><p>A fixed paper for a course checkpoint. Select from the course bank or generate questions against course LOs.</p><ul><li>One scheduled sitting</li><li>Instructor controlled answer release</li></ul>' + button('See midterm workflow →', 'open-midterm') + '</section>',
    '<section class="panel type-card"><span class="pill green">CURRENT TYPE</span><h2>Final</h2><p>A fixed paper covering a broader set of course LOs, with the same version and publication safeguards.</p><ul><li>Longer paper and duration</li><li>Published versions stay pinned</li></ul>' + button('See final workflow →', 'open-final') + '</section>',
    '<section class="panel type-card"><span class="pill blue">PROPOSED TYPE</span><h2>Topic / LO quiz</h2><p>A short assessment scoped to a topic or selected learning objectives in this course.</p><ul><li>Bank questions or new LO questions</li><li>Short duration and configurable attempts</li></ul>' + button('Design an LO quiz →', 'open-quiz', 'primary') + '</section>',
    '</div><div class="note" style="margin-top:18px">Exam Prep practice remains available in the catalog as a separate student practice experience. The quiz type shown here is a design proposal; creating one does not yet save data.</div>',
  ].join('');
}

function quizSetup() {
  return [
    '<button type="button" class="back" data-action="new">← Choose assessment type</button>',
    heading('ASSESSMENT · PROPOSED LO QUIZ', 'New Topic / LO quiz', 'Focus a short quiz on this course’s learning objectives, then assemble and review its paper.'),
    '<div class="workbench"><div class="workbench-main">',
    '<section class="panel"><div class="panel-header"><div><h2>1 · Scope and purpose</h2><p>Only learning objectives from PHYS 100 can be selected.</p></div><span class="pill blue">Design concept</span></div><div class="pad field-grid">',
    '<label class="field">Quiz title<input type="text" value="Newton’s laws LO quiz"></label>',
    '<label class="field">Topic<select><option>Forces and motion</option><option>Energy</option></select></label>',
    '<div class="field span-two"><strong>Learning objectives</strong><div class="lo-options"><label><input type="checkbox" checked> Apply Newton’s first law to motion</label><label><input type="checkbox" checked> Use Newton’s third law as action–reaction</label><label><input type="checkbox"> Construct correct free-body diagrams</label></div><small>Topic filters the list; the selected LOs determine the question scope.</small></div>',
    '</div></section>',
    '<section class="panel"><div class="panel-header"><div><h2>2 · Paper and delivery</h2><p>Start with a small fixed paper so review and student preview stay predictable.</p></div></div><div class="pad field-grid">',
    '<label class="field">Questions<input type="number" min="1" value="6"></label><label class="field">Duration<input type="text" value="20 minutes"></label>',
    '<label class="field">Attempts<select><option>One attempt</option><option>Two attempts</option><option>Three attempts</option></select></label><label class="field">Results and answers<select><option>Release after closing time</option><option>Release after each submission</option><option>Instructor release</option></select></label>',
    '<div class="span-two action-row">' + button('Add from course bank', 'bank') + button('Generate from selected LOs', 'generate') + '</div>',
    '</div></section>',
    '<div class="note">Quiz questions still need instructor review and verified answer versions before publication. Attempt and feedback policy must be enforced by the server, not only by this form.</div>',
    '</div><aside class="panel pad summary-side"><div class="eyebrow">DESIGN DECISION</div><h2 style="margin:8px 0 12px">One assessment workflow</h2><p class="lead">Midterm, Final and LO Quiz share the course question bank, quality checks, access window, student preview and results context.</p><hr><p class="lead">The quiz changes defaults: fewer questions, shorter time and a chosen LO scope. It does not reuse Exam Prep mastery records.</p><div style="margin-top:18px">' + button('Preview quiz workflow', 'quiz-preview', 'primary') + '</div><p class="footer-note">Prototype only · no quiz is created.</p></aside></div>',
  ].join('');
}

function examTabs(exam) {
  const labels = [
    ['paper', 'Paper'], ['quality', 'Quality', exam.state === 'draft' ? '3' : ''],
    ['access', 'Access'], ['preview', 'Student preview'], ['results', 'Results & issues'],
  ];
  return '<nav class="tabs" aria-label="Assessment sections">' + labels.map(function (item) {
    const disabled = item[0] === 'results' && exam.state === 'draft';
    return '<button type="button" data-tab="' + item[0] + '" class="' + (tab === item[0] ? 'active' : '') + '" ' + (disabled ? 'disabled title="Available after publication"' : '') + '>' + item[1] + (item[2] ? '<span class="tab-count">' + item[2] + '</span>' : '') + '</button>';
  }).join('') + '</nav>';
}

function paper(exam) {
  if (exam.state === 'published') return [
    '<section class="panel"><div class="panel-header"><div><h2>Published paper · revision 1</h2><p>Every sitting keeps these exact approved question versions.</p></div><span class="pill green">24 questions</span></div>',
    '<div class="item-row"><span class="item-number">1</span><div><strong>Analyze a free-body diagram <span class="pill green">Ready</span></strong><p>LO 2.2 · MCQ · Approved version 4</p></div><div class="mini-stats"><strong>4 pts</strong></div></div>',
    '<div class="item-row"><span class="item-number">2</span><div><strong>Apply conservation of energy <span class="pill green">Ready</span></strong><p>LO 5.1 · MCQ · Approved version 2</p></div><div class="mini-stats"><strong>4 pts</strong></div></div>',
    '<div class="item-row"><span class="item-number">3</span><div><strong>Interpret a momentum collision <span class="pill green">Ready</span></strong><p>LO 6.4 · True / False · Verified variant</p></div><div class="mini-stats"><strong>5 pts</strong></div></div>',
    '<div class="item-row"><span class="item-number">4–24</span><div><strong>Twenty-one more approved questions</strong><p>View the complete frozen paper and answer key.</p></div><div class="mini-stats"><strong>87 pts</strong></div></div>',
    '<div class="section-links">' + button('Open published paper', 'complete-paper') + '</div></section>',
    '<div class="note">Changes to this exam create a new draft. Active sittings stay pinned to publication revision 1.</div>',
  ].join('');
  return [
    '<section class="panel"><div class="panel-header"><div><h2>Questions on this paper</h2><p>Each question uses a reviewed, pinned version. These samples represent the proposed layout.</p></div><span class="pill neutral">12 questions</span></div>',
    '<div class="item-row"><span class="item-number">1</span><div><strong>Apply Newton’s first law to motion <span class="pill green">Ready</span></strong><p>LO 1.3 · MCQ · Bank question · Approved version 3</p></div><div class="mini-stats"><strong>5 pts</strong><br>~6 min</div></div>',
    '<div class="item-row"><span class="item-number">2</span><div><strong>Use Newton’s third law as action–reaction <span class="pill amber">Review</span></strong><p>LO 2.1 · True / False · Generated for this exam</p></div><div class="mini-stats"><strong>5 pts</strong><br>~5 min</div></div>',
    '<div class="item-row"><span class="item-number">3</span><div><strong>Model tension in strings and pulleys <span class="pill amber">Review</span></strong><p>LO 3.2 · MCQ · Numerical variant · One seed failed verification</p></div><div class="mini-stats"><strong>5 pts</strong><br>~7 min</div></div>',
    '<div class="item-row"><span class="item-number">4–12</span><div><strong>Nine more reviewed questions</strong><p>View the full ordered paper and answer key before publication.</p></div><div class="mini-stats"><strong>45 pts</strong></div></div>',
    '<div class="section-links">' + button('+ Add from question bank', 'bank') + button('Generate new questions', 'generate') + button('Open complete paper', 'complete-paper') + '</div></section>',
    '<div class="note">The course Question Bank remains the reusable source. New exam-only candidates stay private until a teacher explicitly releases them.</div>',
  ].join('');
}

function quality(exam) {
  if (exam.state === 'published') return '<section class="panel pad"><h2>Published revision 1 passed its checks</h2><p class="lead">The exact approved question versions and access settings were frozen when this exam was published.</p></section>';
  return [
    '<section class="panel"><div class="panel-header"><div><h2>What must be resolved?</h2><p>Checks identify the next action; teacher approval remains the final decision.</p></div><span class="pill amber">3 blockers</span></div>',
    '<div class="quality-row"><span class="q-icon">!</span><div><strong>Question 2 needs instructor review</strong><p>Generated candidate passed automatic checks. Review its answer, rationale, and course evidence.</p></div>' + button('Review question →', 'review-question') + '</div>',
    '<div class="quality-row"><span class="q-icon">!</span><div><strong>Question 3 has one failed numerical seed</strong><p>One option duplicated another at display precision. Retry only the failed variant or replace it.</p></div>' + button('Inspect check →', 'inspect-check') + '</div>',
    expandedCheck ? '<div class="check-detail"><strong>Verification detail · seed 1000019</strong><p>Two answer options both display as 19.60. The question cannot be published with this variant.</p><div class="action-row">' + button('Retry failed variant', 'retry-variant') + button('Replace variant', 'replace-variant') + '</div></div>' : '',
    '<div class="quality-row"><span class="q-icon">!</span><div><strong>Student access window is not confirmed</strong><p>Set the opening and closing times, then compare restricted and unrestricted student views.</p></div>' + button('Set access →', 'go-access') + '</div>',
    '<div class="quality-row good"><span class="q-icon">✓</span><div><strong>Source and LO coverage is complete</strong><p>Every selected item belongs to this course and maps to an active learning objective.</p></div><span class="pill green">Passed</span></div>',
    '<div class="quality-row good"><span class="q-icon">✓</span><div><strong>No duplicate question families</strong><p>Related questions do not repeat the same source family on this paper.</p></div><span class="pill green">Passed</span></div></section>',
    '<div class="note">Proposed improvement: a failed check should keep successful questions, show a readable cause, and offer a focused retry. The existing server-side publish gate remains authoritative.</div>',
  ].join('');
}

function access(exam) {
  return [
    '<section class="panel"><div class="panel-header"><div><h2>Student access</h2><p>Keep publication, availability, and answer release together.</p></div><span class="pill ' + (exam.state === 'published' ? 'green' : 'amber') + '">' + (exam.state === 'published' ? 'Published revision 1' : 'Draft · no student access') + '</span></div>',
    '<div class="pad"><div class="field-grid"><label class="field">Opens<input type="text" readonly value="' + (exam.state === 'published' ? 'Sep 10, 2026 · 09:00 PDT' : 'Not scheduled') + '"><small>Students cannot start before this time.</small></label>',
    '<label class="field">Closes<input type="text" readonly value="' + (exam.state === 'published' ? 'Oct 18, 2026 · 18:00 PDT' : 'Not scheduled') + '"><small>Active sittings still follow their server deadline.</small></label>',
    '<label class="field">Duration<input type="text" readonly value="' + exam.minutes + ' minutes"></label>',
    '<label class="field">Results and answers<select disabled><option>' + (exam.state === 'published' ? 'Release after exam closes' : 'Instructor release') + '</option></select><small>Formal exam answers remain hidden before release.</small></label></div>',
    '<div class="action-row" style="margin-top:20px">' + button('Check student visibility →', 'go-preview') + button('Review publication readiness →', 'go-quality') + '</div></div></section>',
    '<div class="note">Future production access simulation must evaluate course publication, enrollment, assessment access window, and the selected student context. The current Preview does not yet model all four.</div>',
  ].join('');
}

function preview(exam) {
  const available = exam.state === 'published';
  return [
    '<section class="panel pad"><h2>See what a student can access</h2><p class="lead">Compare a real access scenario with a private draft preview. The reason for hidden content is part of the result.</p>',
    '<div class="field-grid" style="margin-top:17px"><label class="field">Student context<select disabled><option>Ordinary enrolled student</option></select></label><label class="field">Check at<input type="text" readonly value="Sep 28, 2026 · 09:00 PDT"></label></div></section>',
    '<div class="simulation"><section class="panel"><span class="pill blue">WITH ACCESS RESTRICTIONS</span><div class="screen"><h3>' + (available ? 'Visible after opening date' : 'Exam not visible') + '</h3><p>' + (available ? 'This published exam appears when its access window opens for this student.' : 'This exam is still a draft. A normal student cannot find or open it, even from a direct link.') + '</p><span class="pill ' + (available ? 'green' : 'amber') + '">' + (available ? 'Schedule applies' : 'Publication blocks access') + '</span></div></section>',
    '<section class="panel"><span class="pill green">WITHOUT ACCESS RESTRICTIONS</span><div class="screen"><h3>' + exam.title + '</h3><p>Staff can inspect this paper before release in an isolated student-style session. Answers remain governed by preview rules.</p>' + button('Walk through paper →', 'walkthrough') + '</div></section></div>',
  ].join('');
}

function results() {
  return [
    '<section class="panel"><div class="panel-header"><div><h2>Results and issues</h2><p>One assessment, one place to monitor how it went and what needs attention.</p></div><span class="pill blue">Published revision 1</span></div>',
    '<div class="item-row"><span class="item-number">↗</span><div><strong>Participation and score</strong><p>42 students started · 38 submitted · mean score 72% · 4 active sittings</p></div>' + button('View results →', 'results-demo') + '</div>',
    '<div class="item-row"><span class="item-number">!</span><div><strong>Two reported question issues</strong><p>Open the exact pinned item and variant used in a sitting.</p></div>' + button('Review issues →', 'issues-demo') + '</div>',
    '<div class="item-row"><span class="item-number">✓</span><div><strong>Published paper is immutable</strong><p>Editing creates a new draft; existing sittings keep their original revision.</p></div><span class="pill green">Protected</span></div></section>',
    '<div class="note">These numbers are illustrative. The current Exam Builder does not yet provide an exam-specific grading dashboard or issue linkage.</div>',
  ].join('');
}

function sideSummary(exam) {
  return [
    '<aside class="panel pad summary-side" aria-label="Assessment summary"><div class="eyebrow">THIS ASSESSMENT</div><h2 style="margin:8px 0 15px">' + exam.title + '</h2>',
    '<div class="metric-row"><div><strong>' + exam.count + '</strong><small>questions</small></div><div><strong>' + exam.points + '</strong><small>points</small></div><div><strong>' + exam.minutes + '</strong><small>minutes</small></div></div><hr>',
    '<h3>' + (exam.state === 'published' ? 'Publication' : 'Ready to publish?') + '</h3><div class="checklist">',
    '<div class="check-item"><span class="symbol">✓</span><div>Paper has course questions</div></div>',
    '<div class="check-item ' + (exam.state === 'draft' ? 'problem' : '') + '"><span class="symbol">' + (exam.state === 'draft' ? '!' : '✓') + '</span><div>Every question reviewed' + (exam.state === 'draft' ? '<small>2 questions need attention</small>' : '') + '</div></div>',
    '<div class="check-item ' + (exam.state === 'draft' ? 'problem' : '') + '"><span class="symbol">' + (exam.state === 'draft' ? '!' : '✓') + '</span><div>Access window confirmed</div></div>',
    '</div>' + (exam.state === 'draft' ? button('Review blockers →', 'go-quality', 'primary') : button('View results →', 'go-results', 'primary')),
    '<p class="footer-note">' + (exam.state === 'draft' ? 'Publishing is blocked until the quality and access checks pass.' : 'Students retain the version that was published.') + '</p></aside>',
  ].join('');
}

function detail() {
  const exam = exams[selectedExam];
  const content = tab === 'paper' ? paper(exam) : tab === 'quality' ? quality(exam) : tab === 'access' ? access(exam) : tab === 'preview' ? preview(exam) : results();
  return [
    '<button type="button" class="back" data-action="back">← All assessments</button>',
    heading('ASSESSMENT · ' + exam.kind.toUpperCase(), exam.title, exam.state === 'draft' ? 'Assemble, verify and release one exact paper.' : 'Follow the published paper and the students using it.', button('Student preview', 'go-preview') + (exam.state === 'draft' ? button('Publish exam', 'publish', 'primary') : '')),
    '<div class="exam-meta"><span class="pill ' + (exam.state === 'draft' ? 'amber' : 'green') + '">' + exam.status + '</span><span>' + exam.kind + '</span><span>·</span><span>Formal exam</span><span>·</span><span>' + exam.count + ' questions</span><span>·</span><span>' + exam.minutes + ' minutes</span></div>',
    examTabs(exam), '<div class="workbench"><div class="workbench-main">' + content + '</div>' + sideSummary(exam) + '</div>',
  ].join('');
}

function otherScreen() {
  const data = {
    home: ['Course Home', 'See launch readiness and the next useful action.'],
    content: ['Content', 'Sources, learning objectives, generation, review and the reusable Question Bank stay available here.'],
    insights: ['Insights', 'Coverage, student analytics and reported issues appear together with direct links to affected content.'],
    team: ['Teaching team', 'Manage TA and co-instructor access in one place.'],
    settings: ['Course settings', 'Keep course identity, term dates and publication here.'],
    help: ['Help & Tutorials', 'Role-specific guidance remains available from the workspace.'],
    practice: ['Exam Prep practice', 'Practice keeps its existing question pool and mastery behavior. It is distinct from formal exams.'],
  }[screen];
  return heading('COURSE WORKSPACE', data[0], data[1], button('Back to assessments', 'back')) + '<section class="panel empty-state"><h2>Navigation concept</h2><p>This design review focuses on the assessment journey. Existing features would move into these destinations with their routes and data preserved.</p>' + button('Open assessment catalog →', 'back', 'primary') + '</section>';
}

function render() {
  const title = screen === 'catalog' ? 'Assessments' : screen === 'detail' ? exams[selectedExam].title : screen === 'new' ? 'New assessment' : screen === 'quiz' ? 'LO quiz' : screen === 'practice' ? 'Practice' : screen.charAt(0).toUpperCase() + screen.slice(1);
  breadcrumb.innerHTML = '<b>PHYS 100</b> <span>›</span> ' + (screen === 'detail' ? 'Assessments <span>›</span> ' : '') + title;
  document.querySelectorAll('[data-nav]').forEach(function (item) {
    const active = item.dataset.nav === (['detail', 'practice', 'new', 'quiz'].includes(screen) ? 'catalog' : screen);
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  app.innerHTML = screen === 'catalog' ? catalog() : screen === 'detail' ? detail() : screen === 'new' ? newAssessment() : screen === 'quiz' ? quizSetup() : otherScreen();
  if (screen === 'catalog') filterRows();
}

function filterRows() {
  const query = (document.querySelector('.search')?.value || '').trim().toLowerCase();
  document.querySelectorAll('.catalog-table tbody tr').forEach(function (row) {
    row.hidden = (catalogFilter !== 'all' && row.dataset.kind !== catalogFilter) || !(row.dataset.search || '').includes(query);
  });
}

document.addEventListener('click', function (event) {
  const nav = event.target.closest('[data-nav]');
  if (nav) { screen = nav.dataset.nav; render(); return; }
  const filter = event.target.closest('[data-filter]');
  if (filter) { catalogFilter = filter.dataset.filter; render(); return; }
  const tabButton = event.target.closest('[data-tab]');
  if (tabButton) { tab = tabButton.dataset.tab; render(); return; }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  if (action === 'new') { screen = 'new'; render(); return; }
  if (action === 'open-quiz') { screen = 'quiz'; render(); return; }
  if (action === 'quiz-preview') { showToast('Design sample: a reviewed LO quiz would use the same student preview before publication.'); return; }
  if (action === 'open-midterm' || action === 'open-final') { selectedExam = action === 'open-midterm' ? 'midterm' : 'final'; tab = 'paper'; screen = 'detail'; render(); return; }
  if (action === 'back') { screen = 'catalog'; render(); return; }
  if (action === 'open-practice') { screen = 'practice'; render(); return; }
  if (action === 'go-quality' || action === 'publish') {
    tab = 'quality'; render();
    if (action === 'publish') showToast('Publication is blocked until the three quality and access actions are resolved.');
    return;
  }
  if (action === 'review-question') { tab = 'paper'; render(); showToast('Design sample: opens the exact pinned question for review.'); return; }
  if (action === 'inspect-check') { expandedCheck = !expandedCheck; render(); return; }
  if (action === 'go-preview') { tab = 'preview'; render(); return; }
  if (action === 'go-access') { tab = 'access'; render(); return; }
  if (action === 'go-results') { tab = 'results'; render(); return; }
  showToast('Design sample: this action does not change course data.');
});

document.addEventListener('input', function (event) { if (event.target.matches('.search')) filterRows(); });
document.getElementById('theme-toggle').addEventListener('click', function () {
  const dark = document.body.dataset.theme !== 'dark';
  document.body.dataset.theme = dark ? 'dark' : 'light';
  this.textContent = dark ? 'Light mode' : 'Dark mode';
  this.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
});
render();
