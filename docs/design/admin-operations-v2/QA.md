# Operations & issues v2 — prototype verification

Verified September 20, 2026 using an isolated headless Chromium browser. **19 checks passed, 0 failed; no runtime errors or external requests.**

This validates the local interactive design prototype and its synthetic fixtures. It does not validate production APIs, real accounts, logging completeness, or a live AI generation service.

## Results

| Viewport | First data row | Row height | Document overflow | Inspector |
| --- | ---: | ---: | --- | --- |
| 1440 × 900 | 370.19 px | 48 px | None | Full-height dock |
| 1280 × 900 | 370.19 px | 48 px | None | Full-height dock |
| 580 × 900 | 301 px | 48 px | None | Side drawer |
| 390 × 900 | 301 px | 48 px | None | Full-width drawer |

All outcome badges fit their cells. Source tabs remain available at narrow widths.

At **1280 × 720**, the inspector begins immediately below the 49px top bar and provides 671px of height. Error evidence, operation context, and the first timeline steps are visible together; its context ends at 528.72px, above the fixed action footer. No document overflow occurs.

Verified interactions:

- Natural search typing, cursor insertion, and no-results recovery.
- Source tabs, user/course/outcome/time filtering, sorting, and pagination.
- Inspector navigation without losing the table's filters; accepted request → failed task evidence.
- Explicit unverified browser reports and interrupted-operation warnings.
- Recorded numerical reproduction versus a repeatable new seeded sample; honest missing-snapshot state.
- Filtered CSV, selected-row CSV, and JSON evidence exports.
- Saved views restored after reload; `/` search, arrow-key tabs, and Escape dismissal.
- Axe WCAG A/AA scans: default desktop, narrow drawer, desktop timeline, reproduction result, and 1280 × 720 inspector — zero violations in all five states.

## Defects fixed during verification

- Search previously reversed typed characters because rendering reset the cursor.
- Phone layout collapsed when the hidden sidebar left a zero-width grid column.
- The activity tab list included an unrelated tracking button.
- The narrow Filters icon lacked an accessible name.
- Muted labels failed text contrast checks.
- Longer outcome badges were clipped; the density control described the wrong action.
- The desktop inspector originally began below the table toolbar; it now uses the full height beneath the top bar, making investigation practical on shorter screens.

The final run passed all regression checks. No unresolved defects were observed within this tested scope.

## Evidence

- [Machine-readable report](screenshots/verification.json)
- [1440px table](screenshots/qa-1440-table.png) · [1440px inspector](screenshots/qa-1440-inspector.png)
- [1280px table](screenshots/qa-1280-table.png) · [1280px inspector](screenshots/qa-1280-inspector.png)
- [1280 × 720 full-height inspector](screenshots/qa-1280x720-inspector.png)
- [580px table](screenshots/qa-580-table.png) · [580px drawer](screenshots/qa-580-inspector.png)
- [390px table](screenshots/qa-390-table.png) · [390px drawer](screenshots/qa-390-inspector.png)
- [Timeline](screenshots/qa-desktop-timeline.png) · [Reproduction controls](screenshots/qa-desktop-reproduction.png) · [Reproduced calculation](screenshots/qa-desktop-reproduced-result.png)

Run `node docs/design/admin-operations-v2/verify.cjs` while the local design server is available at `http://127.0.0.1:6133/` to repeat these checks. The test uses its own browser context and leaves the user's browser untouched.
