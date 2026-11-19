# Frontend conventions

Use these rules when this engine sits inside an existing Metronic 8 application.

- A page owns the shell. The form engine owns only `#sl-form-host`.
- Do not hand-write a field that the schema can describe. A one-off label in HTML will drift from the studio.
- Field ids match `^[a-z][a-zA-Z0-9]{0,40}$`. Form and step keys may include hyphens.
- Column spans are 4, 6, 8, or 12.
- New behavior is a rule on the field or a new renderer. It is not a copy of `render.js`.
- Repeater child fields stay in the schema. The studio edits scalar fields around a repeater so row indexes cannot be corrupted from the admin screen.
- Validation text lives in `validate.js`. The .NET engine must use the same sentences. Both are checked from `tests/cases.json`.
- Hidden fields are kept in memory so toggling a rule does not wipe what the user typed, and they are removed from the payload.
- Dependent options clear a value that is no longer in the list.
- Server responses use `ProblemDetails`. Map `errors` onto the `fv-plugins-message-container` of the matching `data-error-key`.
- Role and tenant come from the API headers. Hiding a link is not the authorization check.
