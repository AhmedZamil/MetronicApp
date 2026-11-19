# Click-through

Start with `npm start` and open http://localhost:4173. Repeat the form pages at 390px width. The sidebar should sit off-canvas until Open menu is used, and the page should not scroll sideways.

1. Sign in as Ava Chen. The nav has Dashboard, Forms, and Submissions. Schema studio is absent.
2. Open Incident intake. Continue with an empty title. The title, severity, source, and detected fields are marked and the step does not advance.
3. File a low, internal incident. Scope hides vendor name. Notify hides executive notification and the war-room bridge. Going back keeps the values.
4. Change severity to critical and source to third party. Vendor name is required. Notify shows the executive checkbox and war-room bridge, and Submit blocks until both are set.
5. Submit. The queue shows the new row for Northwind Security.
6. Sign in as Noah Rahman. Schema studio opens Incident intake. Add field id `ticketUrl`, label `Ticket URL`, required, on the Notify step, shown when severity equals `critical`. Save.
7. Reload the runtime. Low severity hides Ticket URL. Critical severity shows it and blocks submit when it is empty.
8. Open Schema studio for Vendor assessment as Noah. The page says the global template cannot be edited.
9. Sign in as an analyst and open `/app/studio.html` directly. The app returns to the dashboard.
10. Sign in as Maya Okonkwo, switch the tenant to Harbor Health, and open Submissions. Northwind rows are not listed.
11. Open Vendor assessment. United States offers California, New York, and Texas. Switching to United Kingdom replaces that list and clears a stale region. Submit with no control rows and the repeater reports the minimum. Add two rows, remove the first, and the remaining row is index 0. A fail result requires the remediation plan.

A direct `POST /api/submissions` with an empty incident body returns HTTP 400 and `errors.title`. That path is covered by `npm test`.
