import { getForm, listForms, saveForm } from "../api/client.js";
import { canEditSchema } from "../engine/schema.js";
import { mountStudio } from "../engine/studio.js";
import { escapeHtml } from "../html.js";
import { mountShell } from "../shell.js";

const session = mountShell({ active: "studio", allow: ["tenant-admin", "platform-admin"] });
if (session) load();

async function load() {
  const content = document.getElementById("sl-content");
  const key = new URLSearchParams(window.location.search).get("key");
  content.innerHTML = `<p class="text-secondary">Loading schema studio…</p>`;
  try {
    if (!key) {
      const forms = (await listForms()).filter((form) => canEditSchema(session.role, form));
      content.innerHTML = `
        <div class="page-heading">
          <div>
            <h1>Schema studio</h1>
            <p class="mb-0">Change fields and rules here. The runtime reads the saved schema.</p>
          </div>
        </div>
        <div class="row g-5">
          ${forms.map((form) => `
            <div class="col-12 col-md-6">
              <a class="card card-flush text-decoration-none text-reset" href="/app/studio.html?key=${encodeURIComponent(form.key)}">
                <div class="card-body">
                  <h2 class="h5">${escapeHtml(form.title)}</h2>
                  <p class="mb-0 text-secondary">${form.scope === "global" ? "Global template" : "Tenant form"}</p>
                </div>
              </a>
            </div>`).join("")}
        </div>`;
      return;
    }
    const schema = await getForm(key);
    if (!canEditSchema(session.role, schema)) {
      content.innerHTML = `<div class="alert alert-danger" role="alert">You cannot edit this form.</div>`;
      return;
    }
    content.innerHTML = `
      <div class="page-heading">
        <div>
          <h1>${escapeHtml(schema.title)}</h1>
          <p class="mb-0">Version ${escapeHtml(schema.version || 1)} · ${schema.scope === "global" ? "Global template" : "Tenant form"}</p>
        </div>
      </div>
      <div id="studio-host"></div>`;
    mountStudio(document.getElementById("studio-host"), {
      schema,
      onSave: (next) => saveForm(next)
    });
  } catch (error) {
    content.innerHTML = `<div class="alert alert-danger" role="alert">${escapeHtml(error.message)}</div>`;
  }
}
