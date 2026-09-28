# Canvas connection — compact prototype

Standalone interactive design preview, requested by Stephen. No production UI or
API changes. Open index.html directly, or use the existing prototype server at
http://127.0.0.1:8768/compact/.

Smaller heading, 32px buttons, compact table rows and a small account-status menu.
Course links, students and materials use separate tabs. Course multi-select is a
570px dialog. Supports linking an existing course and simulating creation of a
draft. All authorization, sync, imports and enrollment controls are local demo
state only. The default cohort has ten students in 101 and ten in 102; each
student belongs to one section. Two same-name students retain separate IDs.

Verified: multi-select, tab switching, student search, simulated file import,
existing-course linking, and no horizontal document overflow at 390px.
