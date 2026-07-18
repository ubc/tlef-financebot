// Pure-data test for the instructor-facing OptionRole display map (I6). No DOM
// needed — ROLE_LABEL is a plain object; importing instructor-ui.ts also pulls
// in dom.ts's `el` (DOM-touching), but merely importing it doesn't execute any
// document access, so this is safe under jest's node test environment. See
// client/src/instructor-ui.ts.
import { ROLE_LABEL } from '../../client/src/instructor-ui';

describe('ROLE_LABEL', () => {
  it('maps the four OptionRoles to their wireframe display labels', () => {
    expect(ROLE_LABEL).toEqual({
      correct: 'Correct Answer',
      'common-misconception': 'Good Confounder',
      'partially-correct': 'Related but Incorrect',
      'clearly-wrong': 'Easy to Eliminate',
    });
  });
});
