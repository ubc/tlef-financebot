// Overview page (the app's home). A short welcome, live system status, and a map
// of the boilerplate's components so a new developer knows what is wired up and
// where to look.
import { el } from '../dom.js';
import { eyebrow } from '../ui.js';
import { getSession, displayName } from '../auth.js';
import type { AuthUser } from '../api.js';
import { healthCard } from './health.js';

/** The user's primary role, used to route to a role-appropriate home (ST-E01).
 * Admin wins, then instructor (faculty affiliation), else student. Phase 1
 * replaces the stub sections below with real views; this split stays. */
export function primaryRole(user: AuthUser): 'admin' | 'instructor' | 'student' {
  if (user.isAdmin) return 'admin';
  if (user.affiliations.includes('faculty')) return 'instructor';
  return 'student';
}

const ROLE_HEADINGS: Record<ReturnType<typeof primaryRole>, string> = {
  admin: 'Admin console',
  instructor: 'Instructor dashboard',
  student: 'My courses',
};

interface ComponentInfo {
  glyph: string;
  name: string;
  desc: string;
  path: string;
}

const COMPONENTS: ComponentInfo[] = [
  { glyph: '▤', name: 'MongoDB', desc: 'Application data store', path: 'components/mongodb' },
  { glyph: '❋', name: 'Qdrant', desc: 'Vector search for RAG', path: 'components/qdrant' },
  { glyph: '⬡', name: 'SAML / CWL auth', desc: 'Sessions + Shibboleth login', path: 'components/auth' },
  { glyph: '◈', name: 'GenAI toolkit', desc: 'LLM · embeddings · chunking · parsing', path: 'components/genai' },
];

function componentCard(info: ComponentInfo): HTMLElement {
  return el(
    'article',
    { class: 'tile' },
    el('span', { class: 'tile__glyph', 'aria-hidden': 'true', text: info.glyph }),
    el('h3', { class: 'tile__name', text: info.name }),
    el('p', { class: 'tile__desc', text: info.desc }),
    el('code', { class: 'tile__path mono', text: info.path }),
  );
}

export function renderHome(outlet: HTMLElement): void {
  const user = getSession().user;
  const greeting = user ? `Welcome, ${displayName(user)}` : 'Welcome';
  const role = user ? primaryRole(user) : undefined;

  outlet.append(
    el(
      'div',
      { class: 'view view--overview' },
      el(
        'div',
        { class: 'view__intro' },
        eyebrow('Overview'),
        el('h1', { class: 'view__title', text: greeting }),
        role
          ? el('p', { class: 'view__lead', text: `${ROLE_HEADINGS[role]} — Phase 1 builds this view out. (Signed in as ${role}.)` })
          : el('p', {
              class: 'view__lead',
              text:
                'You are signed in. Everything below the fold is a wired-up integration ' +
                'you can build on — or delete the example pages and keep the shell.',
            }),
      ),
      healthCard(),
      el(
        'section',
        { class: 'card' },
        el(
          'div',
          { class: 'card__head' },
          el('div', {}, eyebrow('What’s in the box'), el('h2', { class: 'card__title', text: 'Components' })),
        ),
        el('div', { class: 'tile-grid' }, ...COMPONENTS.map(componentCard)),
      ),
    ),
  );
}
