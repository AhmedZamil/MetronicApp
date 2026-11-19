import { listSubmissions } from "../api/client.js";
import { escapeHtml } from "../html.js";
import { mountShell } from "../shell.js";
import { formatWhen, statusLabel } from "./format.js";

const session = mountShell({ active: "submissions" });
if (session) load();

async function load() {
  const content = document.getElementById("sl-content");
  const created = new URLSearchParams(window.location.search).get("created");
  content.innerHTML = `<p class="text-secondary">Loading submissions…</p>`;
  try {
    const items = await listSubmissions();
    content.innerHTML = `
      <div class="page-heading">
        <div>
          <h1>Submissions</h1>
          <p class="mb-0">Stored for the active tenant.</p>
        </div>
      </div>
      <div class="card card-flush"><div class="card-body">
        ${items.length ? `<div class="table-responsive"><table class="table align-middle mb-0">
          <thead><tr><th>When</th><th>Form</th><th>By</th><th>Status</th></tr></thead>
          <tbody>
            ${items.map((item) => `<tr data-id="${escapeHtml(item.id)}" class="${item.id === created ? "row-new" : ""}">
              <td>${escapeHtml(formatWhen(item.submittedAt))}</td>
              <td><a href="/app/submission.html?id=${encodeURIComponent(item.id)}">${escapeHtml(item.formTitle)}</a></td>
              <td>${escapeHtml(item.submittedBy)}</td>
              <td><span class="badge-soft">${escapeHtml(statusLabel(item))}</span></td>
            </tr>`).join("")}
          </tbody>
        </table></div>` : `<p class="mb-0 text-secondary">No submissions for this tenant yet.</p>`}
      </div></div>`;
    if (created) document.querySelector(`[data-id="${CSS.escape(created)}"]`)?.scrollIntoView({ block: "center" });
  } catch (error) {
    content.innerHTML = `<div class="alert alert-danger" role="alert">${escapeHtml(error.message)}</div>`;
  }
}
