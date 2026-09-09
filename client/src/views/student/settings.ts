import { createThemeToggle, getTheme } from '../../theme.js';
import { el } from '../../dom.js';
import { copyrightFooter, pageHeader } from '../../student-ui.js';
import { renderTutorialHelp } from '../tutorial-help.js';

export async function renderStudentSettings(outlet: HTMLElement): Promise<void> {
  const themeLabel = el('p', { class: 'muted', text: `Current theme: ${getTheme()}.` });
  const toggle = createThemeToggle();
  toggle.addEventListener('click', () => { themeLabel.textContent = `Current theme: ${getTheme()}.`; });
  const help = el('div');
  const root = el('div', { class: 'view view--student-settings' },
    pageHeader('Settings', 'Manage your preferences and revisit short product tutorials.'),
    el('section', { class: 'student-settings__section' },
      el('div', { class: 'student-settings__section-head' },
        el('div', {}, el('h2', { class: 'section-title', text: 'Appearance' }), themeLabel), toggle)),
    help, copyrightFooter());
  outlet.append(root);
  await renderTutorialHelp(help);
}
