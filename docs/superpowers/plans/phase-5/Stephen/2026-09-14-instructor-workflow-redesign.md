# Instructor workflow redesign — Stephen

> Status: audit and planning only; implementation has not started.
> Owner: Stephen. Date: 2026-09-14.
> Delivery rule: implement one page, demonstrate it, then STOP until Stephen says continue.

**Goal:** Make the Instructor authoring journey understandable, show existing work and real generation progress, and make reviewing questions efficient.

**Architecture:** Reuse course records, content runs, course-scoped SSE and existing question/version authorization. Guided and standalone entry points should share presentation and planning behavior. Streaming extensions require explicit backend contracts; animations cannot substitute for real events.

**Tech stack:** Native TypeScript ES modules, existing CSS design tokens, Express, MongoDB, Agenda, existing LLM adapter, Jest and Playwright.

**Global constraints:** English product UI; Chinese review document. Preserve all current uncommitted work. No application changes, generation, approval, installation or application push during this audit. Preserve human approval, numerical verification, version conflicts, course permissions and isolated Student Preview. Show public check summaries and evidence, never fabricated reasoning. No global redesign in a page-sized delivery.

## Planned page gates

- [ ] 1. Existing Learning Objectives and return navigation.
- [ ] 2. Guided Questions: simple generation composer and reliable batch state.
- [ ] 3. Guided Live Review: arriving questions and visible checks.
- [ ] 4. Full Review workspace: queue and focused question review.
- [ ] 5. Standalone Generate Questions: reuse the simple composer.
- [ ] 6. Question Bank: search, preview and lifecycle clarity.
- [ ] 7. Cross-page consistency and journey acceptance.

Detailed scope, evidence and acceptance criteria will be finalized with the audit in this documentation-only task.
