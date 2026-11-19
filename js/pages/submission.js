import { getForm, listSubmissions } from "../api/client.js";
import { orderedFields } from "../engine/schema.js";
import { escapeHtml } from "../html.js";
import { mountShell } from "../shell.js";
import { formatWhen, statusLabel } from "./format.js";

const session = mountShell({ active: "submissions" });
if (session) load();

async function load() {
  const content = document.getElementById("sl-content");
  const id = new URLSearchParams(window.location.search).get("id");
  if (!id) {
    content.innerHTML = `<div class="alert alert-warning" role="alert">Missing submission.</div>`;
    return;
  }
  content.innerHTML = `<p class="text-secondary">Loading submission…</p>`;
  try {
    const items = await listSubmissions();
    const item = items.find((entry) => entry.id === id);
    if (!item) {
      content.innerHTML = `<div class="alert alert-warning" role="alert">This submission is not in the active tenant.</div>`;
      return;
    }
    const schema = await getForm(item.formKey);
    content.innerHTML = `
      <div class="page-heading">
        <div>
          <h1>${escapeHtml(item.formTitle)}</h1>
          <p class="mb-0">${escapeHtml(item.submittedBy)} · ${escapeHtml(formatWhen(item.submittedAt))}</p>
        </div>
        <a class="btn btn-light" href="/app/submissions.html">Back to queue</a>
      </div>
      <div class="card card-flush"><div class="card-body">
        <p><span class="badge-soft">${escapeHtml(statusLabel(item))}</span></p>
        <dl class="row mb-0">${detailRows(schema, item.values)}</dl>
      </div></div>`;
  } catch (error) {
    content.innerHTML = `<div class="alert alert-danger" role="alert">${escapeHtml(error.message)}</div>`;
  }
}

function detailRows(schema, values) {
  const known = new Set();
  const rows = [];
  for (const item of orderedFields(schema)) {
    if (!Object.hasOwn(values || {}, item.id)) continue;
    known.add(item.id);
    rows.push(row(item.field?.label || item.id, item.field, values[item.id]));
  }
  for (const [key, value] of Object.entries(values || {})) {
    if (!known.has(key)) rows.push(row(key, null, value));
  }
  return rows.join("");
}

function row(label, field, value) {
  return `<dt class="col-sm-4">${escapeHtml(label)}</dt><dd class="col-sm-8">${formatValue(field, value)}</dd>`;
}

function formatValue(field, value) {
  if (field?.type === "repeater" && Array.isArray(value)) {
    if (!value.length) return `<span class="text-secondary">None</span>`;
    return `<ul class="mb-0">${value.map((item) => `<li>${escapeHtml(Object.entries(item).map(([key, cell]) => `${field.itemFields?.[key]?.label || key}: ${cell}`).join(", "))}</li>`).join("")}</ul>`;
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === "" || value == null) return `<span class="text-secondary">Blank</span>`;
  return escapeHtml(value);
}
