# Admin workspace prototype module contract

Only write your assigned module files here. Root owns shared shell, CSS, entry HTML and helpers. Standalone design work, not phase-plan or production work.

Register `window.AdminPages.KEY = {title, subtitle, render(), action(name,id,event), change(el), input(el), submit(form)}` in a classic-script IIFE. Only render is required. Module state is closure-owned. HTML is English. The shell calls these handlers via delegated events and handles data-action names starting `ui-`. Namespaced actions preferred. Native form validation works before submit.

Global `window.AdminUI` (available before modules load):
- `h(value)` HTML escape; `icon(name)` returns inline SVG (`search,book,users,key,shield,settings,help,download,plus,close,chevron,check,clock,alert,filter,refresh,history,external,copy,activity,arrow,edit,globe,star,collapse`).
- `button(label, action, {id='',icon='',className='',disabled=false}={})` complete button, always accessible aria-label.
- `badge(text,tone='neutral')`: tones success,warn,failed,running,neutral.
- `avatar(name)` small initials avatar.
- `read(key,fallback)` / `save(key,value)` localStorage under shared prototype prefix; no network.
- `render({preserveFocus=false}={})` rerenders shell+module, preserving focused control/caret when requested.
- `toast(text)`.
- `modal(title,bodyHTML,footerHTML='')`, `closeModal()`; use native dialog. Do not use window.confirm.
- `panel({title,eyebrow='',body,footer=''})` returns full-height inspector markup. Include panel at END of module render HTML if selected. Closing uses YOUR namespaced action. Use class `ws-panel` and pass close control in footer or body; helper provides global ui-close-panel which invokes module.action('close-panel').
- `download(filename,text,mime='text/plain')` local Blob export; `csv(rows)` serializes rows array.
- `heading(title,subtitle,actionsHTML='')` returns page-heading.
- `metrics([{label,value,note?,tone?}])` returns compact horizontal summary strip.
- `empty(title,description,actionHTML='')`.
- `link(page,params={})` relative `workspace.html?page=...`; page=operations points `index.html` with query as hash (actor/course/inspect).

Render content inside `<main class="content ws-content" id="main">`. Render your HTML consisting heading, optionalmetrics, then panel containing toolbar+table. Classes available:
`.activity-panel` flex column bounded; `.table-toolbar` horizontal; `.search-wrap` label(icon+input); `.spacer`; `.main-tabs` with child `.source-tabs[role=tablist]`; `.list-area`, `.table-scroll` flex scroll; table `.ws-table` (auto columns; cell48px); `.table-footer`; `.empty-state`.
Responsive optionalcolumns: `.hide-md` hides<900; `.hide-sm` hides<680; `.hide-xs` hides<440. `.cell-primary` linkbutton for maincell; `.cell-sub` metadata. `.actions`, `.primary`, `.quiet`, `.icon-button`, `.control-field`, `.two-fields`, `.property-list`, `.section-label`, `.issue-callout info/warn`, `.code-block`, `.option`, `.detail-note`, `.tag`, `.pill`, `.mono`, `.avatar` inherited.
For settings form: `.ws-scroll` scrollable card, `.settings-section` borderedgroup; `.settings-row` label/description left and control right; `.settings-grid` columns; `.save-bar` footer; `.segmented` tabs; `.ws-panel .panel-tabs`; `.panel-section`; `.switch-label` checkbox row; `.inline-notice`; `.review-summary`; `.audit-list` compact list; `.learn-grid` cards.
Do not create huge vertically stacked cards or custom shells. Use dense tables + panel for details, actionable local saves with review/confirm for access changes. Do not add real mutations or network. All sample data must be synthetic. Align names Jordan Lee / Robin Patel / Taylor Chen / Alex Morgan / Casey Park, courses COMM 298 / COMM 370 / ECON 101. Role facts: global Instructor distinct from admin and course instructor; TA approve/flagresolve hardlocked; avoid course-orphaning account actions. Links to questions or activity must preserve meaningful actor/course identity.
Root will implement CSS. If you need a small page-specific stylesheet, create KEY.css and tell root to include it. Prefer shared classes.
