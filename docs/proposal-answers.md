# Proposal answers

These answers describe SkyLake Control Forms, the working reference product built for SKY LAKE SOLUTIONS. They do not describe a prior multi-year production engagement.

## Which versions of Metronic, and did you use native JavaScript and Bootstrap?

This implementation targets the **Metronic 8 HTML** contract: Bootstrap 5.3 and vanilla JavaScript. It does not use the Metronic React, Angular, or Vue packages.

Pages keep a Demo-style shell: sidebar, header, content, `card-flush`, `form-control-solid`, `form-select-solid`, `fv-row`, and a stepper. Controls are native inputs, selects, checkboxes, radios, and textareas. The form engine does not import `plugins.bundle.js`, jQuery, Select2, or flatpickr. Those plugins are where dynamic rows usually break. The renderer emits stable `name`/`data-path` hooks and an `fv-row` around every control, which is the same host a Metronic 8 page already uses.

The public repository does not include KeenThemes files. [css/skylake.css](../css/skylake.css) paints the class hooks so the product runs on its own. In a licensed Metronic 8 layout, that stylesheet is removed and the theme CSS takes over. The HTML does not change.

## Describe the metadata-driven application and its architecture

SkyLake Control Forms is the application. Analysts file an incident and a vendor assessment. Tenant admins change the incident schema. A platform admin can switch tenants and edit the global vendor template. The live behavior is:

- Incident severity `critical` shows and requires executive notification and a war-room bridge.
- Source `third-party` shows and requires the vendor name.
- Vendor country replaces the region list and clears a region that no longer belongs.
- The control repeater requires one row. Removing a row reindexes the paths. A `fail` result shows and requires a remediation plan.
- Schema studio can add a scalar field, such as Ticket URL, visible and required only when severity is critical. The runtime picks it up after save. No HTML file is edited.

Architecture:

1. A form is a JSON schema: steps, sections, rows, column spans, fields, options, and rules.
2. `js/engine/rules.js` decides visibility, required state, dependent options, and stale values. Rules are `eq`, `neq`, `in`, `empty`, `notEmpty`, plus `all` for AND. A repeater path such as `controls.status` reads every row.
3. `js/engine/validate.js` is the only validator. The browser and the Node API both import it. Hidden fields are not required and are omitted from the submit payload. Repeater errors use paths like `controls[0].controlName`.
4. `js/engine/render.js` is the only DOM writer. It mounts on one host element inside an existing card.
5. `js/engine/schema.js` guards ids, spans, references, and role. A field that another rule depends on cannot be deleted.
6. `ApiClient` sends `X-Tenant-Id` and `X-Role`. Failed validation returns `ProblemDetails`: `{ title, status, errors }`.

The .NET 10 project in `backend/SkyLake.Api` implements the same routes. Its tests load `tests/cases.json`, the same vectors as Node.

## How would you add this to an existing Metronic and ASP.NET Core app without a rewrite?

Leave the current layout, menu, theme script, and bundles in place.

1. Copy `js/engine/rules.js`, `validate.js`, `schema.js`, and `render.js` into the existing static assets.
2. Inside a current card, add `<div id="sl-form-host"></div>`.
3. Call `mountForm` with the schema returned by the existing controller. The rest of the page stays as authored HTML.
4. Add the routes already sketched in `backend/SkyLake.Api`: list, read, save schema, list submissions, create submission. The .NET host loads the schema from its own store on submit. The browser copy is a hint, not the authority.
5. Keep role checks on the server. The UI hides Schema studio from analysts, and the API returns 403 if they call it anyway.

A new field, label, width, step, option list, or visibility rule is a schema change. A new control type is one entry in the field registry. Existing pages are not rewritten.
