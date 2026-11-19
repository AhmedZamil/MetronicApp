import { listForms, listSubmissions } from "../api/client.js";
import { escapeHtml } from "../html.js";
import { mountShell } from "../shell.js";
import { formatWhen, statusLabel } from "./format.js";

const session = mountShell({ active: "dashboard" });
if (session) load();

async function load() {
  const content = document.getElementById("sl-content");
  content.innerHTML = `<p class="text-secondary">Loading dashboard…</p>`;
  try {
    const [forms, submissions] = await Promise.all([listForms(), listSubmissions()]);
    const critical = submissions.filter((item) => item.formKey === "incident-intake" && item.values?.severity === "critical").length;
    const failing = submissions.filter((item) => (item.values?.controls || []).some((row) => row.status === "fail")).length;
    const recent = submissions.slice(0, 5);
    content.innerHTML = `
      <div class="page-heading">
        <div>
          <h1>Operations</h1>
          <p class="mb-0">Forms and submissions for the active tenant.</p>
        </div>
      </div>
      <div class="metric-grid">
        ${metric("Forms", forms.length)}
        ${metric("Submissions", submissions.length)}
        ${metric("Critical incidents", critical)}
        ${metric("Vendor failures", failing)}
      </div>
      <div class="card card-flush">
        <div class="card-header"><h2 class="card-title">Recent submissions</h2></div>
        <div class="card-body">
          ${recent.length ? table(recent) : `<p class="mb-0 text-secondary">No submissions for this tenant yet.</p>`}
        </div>
      </div>`;
  } catch (error) {
    content.innerHTML = `<div class="alert alert-danger" role="alert">${escapeHtml(error.message)}</div>`;
  }
}

function metric(label, value) {
  return `<article class="card card-flush"><div class="card-body"><div class="metric-label">${label}</div><p class="metric-value">${value}</p></div></article>`;
}

function table(items) {
  return `<div class="table-responsive"><table class="table align-middle mb-0">
    <thead><tr><th>When</th><th>Form</th><th>By</th><th>Status</th></tr></thead>
    <tbody>
      ${items.map((item) => `<tr>
        <td>${escapeHtml(formatWhen(item.submittedAt))}</td>
        <td><a href="/app/submission.html?id=${encodeURIComponent(item.id)}">${escapeHtml(item.formTitle)}</a></td>
        <td>${escapeHtml(item.submittedBy)}</td>
        <td><span class="badge-soft">${escapeHtml(statusLabel(item))}</span></td>
      </tr>`).join("")}
    </tbody>
  </table></div>`;
}
