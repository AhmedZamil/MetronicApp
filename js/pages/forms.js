import { listForms } from "../api/client.js";
import { canEditSchema } from "../engine/schema.js";
import { escapeHtml } from "../html.js";
import { mountShell } from "../shell.js";

const session = mountShell({ active: "forms" });
if (session) load();

async function load() {
  const content = document.getElementById("sl-content");
  content.innerHTML = `<p class="text-secondary">Loading forms…</p>`;
  try {
    const forms = await listForms();
    content.innerHTML = `
      <div class="page-heading">
        <div>
          <h1>Forms</h1>
          <p class="mb-0">Each form is a schema. The page does not hardcode its fields.</p>
        </div>
      </div>
      <div class="row g-5">
        ${forms.map((form) => `
          <div class="col-12 col-lg-6">
            <article class="card card-flush h-100">
              <div class="card-body">
                <span class="badge-soft">${form.scope === "global" ? "Global template" : "Tenant form"}</span>
                <h2 class="h4 mt-3">${escapeHtml(form.title)}</h2>
                <p class="text-secondary">${escapeHtml(form.description || "")}</p>
                <div class="d-flex gap-2 flex-wrap">
                  <a class="btn btn-primary" href="/app/runtime.html?key=${encodeURIComponent(form.key)}">Open</a>
                  ${canEditSchema(session.role, form) ? `<a class="btn btn-light" href="/app/studio.html?key=${encodeURIComponent(form.key)}">Edit schema</a>` : ""}
                </div>
              </div>
            </article>
          </div>`).join("")}
      </div>`;
  } catch (error) {
    content.innerHTML = `<div class="alert alert-danger" role="alert">${escapeHtml(error.message)}</div>`;
  }
}
