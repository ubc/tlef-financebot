// -----------------------------------------------------------------------------
// App configuration — the ONE place to re-skin this boilerplate's shell.
// Change the name/tagline here and the CSS custom properties in
// public/styles/main.css (the `:root` token block) to rebrand the whole app.
// -----------------------------------------------------------------------------

export const APP = {
  /** Product name shown in the sidebar brand and document title. */
  name: 'TLEF Starter',
  /** Short mark shown in the collapsed/mobile brand. */
  shortName: 'TLEF',
  /** One line describing what this is, shown on the landing screen. */
  tagline: 'A TypeScript starter for UBC teaching-and-learning apps.',
  /** Longer landing-screen blurb. */
  intro:
    'MongoDB, Qdrant vector search, SAML/CWL auth, and the UBC GenAI toolkit — ' +
    'each wired up as an isolated, documented component you can build on.',
  /** Version label shown in the sidebar footer. */
  version: '0.0.1',
} as const;

/** Which sidebar group a nav item belongs to. */
export type NavGroup = 'main' | 'examples' | 'account';

export interface NavItem {
  /** Hash-router path, e.g. '/' or '/notes'. */
  path: string;
  /** Sidebar label. */
  label: string;
  /** A short glyph rendered in the sidebar (kept text-only: no icon deps). */
  glyph: string;
  group: NavGroup;
  /** Marks a deletable EXAMPLE feature (shows a "DEMO" badge). */
  demo?: boolean;
}

/** Human labels for the sidebar group headings. */
export const NAV_GROUPS: Record<NavGroup, string> = {
  main: '',
  examples: 'Examples · safe to delete',
  account: 'Account',
};

/**
 * The navigation model. Order here is the order in the sidebar. Adding a page is
 * one entry here plus one view render function registered in main.ts.
 */
export const NAV: NavItem[] = [
  { path: '/', label: 'Overview', glyph: '◈', group: 'main' },
  { path: '/notes', label: 'Notes', glyph: '▤', group: 'examples', demo: true },
  { path: '/rag', label: 'RAG search', glyph: '❋', group: 'examples', demo: true },
  { path: '/members', label: 'Members area', glyph: '⬡', group: 'account' },
];
