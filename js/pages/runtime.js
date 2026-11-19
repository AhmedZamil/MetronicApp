import { getForm, submitForm } from "../api/client.js";
import { mountForm } from "../engine/render.js";
import { escapeHtml } from "../html.js";
import { mountShell } from "../shell.js";

const session = mountShell({ active: "forms" });
if (session) load();

async function load() {
  const content = document.getElementById("sl-content");
  const key = new URLSearchParams(window.location.search).get("key");
  if (!key) {
    content.innerHTML = `<div class="alert alert-warning" role="alert">Choose a form from the catalog.</div>`;
    return;
  }
  content.innerHTML = `<p class="text-secondary">Loading form…</p>`;
  try {
    const schema = await getForm(key);
    document.title = `${schema.title} · SkyLake Control Forms`;
    content.innerHTML = `
      <div class="page-heading">
        <div>
          <h1>${escapeHtml(schema.title)}</h1>
          <p class="mb-0">${escapeHtml(schema.description || "Rendered from the form schema.")}</p>
        </div>
        <a class="btn btn-light" href="/app/forms.html">All forms</a>
      </div>
      <div class="card card-flush"><div class="card-body" id="sl-form-host"></div></div>`;
    mountForm(document.getElementById("sl-form-host"), {
      schema,
      async onSubmit(values) {
        const saved = await submitForm(schema, values);
        window.location.assign(`/app/submissions.html?created=${encodeURIComponent(saved.id)}`);
      }
    });
  } catch (error) {
    content.innerHTML = `<div class="alert alert-danger" role="alert">${escapeHtml(error.message)}</div>`;
  }
}
