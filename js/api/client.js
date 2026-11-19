import { validateSchemaShape } from "../engine/schema.js";
import { getSession } from "../session.js";

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function getBootstrap() {
  return request("/api/bootstrap");
}

export async function listForms() {
  const session = getSession();
  const body = await request("/api/forms");
  return body.forms.map((form) => readSchema(session, form) || form);
}

export async function getForm(key) {
  const session = getSession();
  const body = await request(`/api/forms?key=${encodeURIComponent(key)}`);
  return readSchema(session, body.form) || body.form;
}

export async function saveForm(schema) {
  const session = getSession();
  const body = await request(`/api/forms?key=${encodeURIComponent(schema.key)}`, {
    method: "PUT",
    body: JSON.stringify({ schema })
  });
  writeJson(schemaKey(session, body.schema), body.schema);
  return body.schema;
}

export async function listSubmissions() {
  const session = getSession();
  const body = await request("/api/submissions");
  const local = readJson(submissionKey(session.tenantId)) || [];
  return mergeSubmissions(body.submissions, local);
}

export async function submitForm(schema, values) {
  const session = getSession();
  const id = `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const body = await request("/api/submissions", {
    method: "POST",
    body: JSON.stringify({ id, formKey: schema.key, values, schema })
  });
  const key = submissionKey(session.tenantId);
  const local = readJson(key) || [];
  local.push(body.submission);
  writeJson(key, local);
  return body.submission;
}

export function mergeSubmissions(remote, local) {
  const map = new Map();
  for (const item of remote || []) map.set(item.id, item);
  for (const item of local || []) map.set(item.id, item);
  return [...map.values()].sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
}

async function request(path, options = {}) {
  const session = getSession();
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (session) {
    headers["X-Tenant-Id"] = session.tenantId;
    headers["X-Role"] = session.role;
    headers["X-User-Id"] = session.id;
    headers["X-User-Name"] = session.name;
  }
  let response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch {
    throw new ApiError("Cannot reach the SkyLake API. Start the app server and reload this page.", 0, null);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(body.title || "Request failed", response.status, body);
  }
  return body;
}

function schemaKey(session, form) {
  if (form.scope === "global") return `sl.schemas.global.${form.key}`;
  return `sl.schemas.${session.tenantId}.${form.key}`;
}

function submissionKey(tenantId) {
  return `sl.submissions.${tenantId}`;
}

function readSchema(session, form) {
  if (!session || !form) return null;
  const overlay = readJson(schemaKey(session, form));
  if (!overlay) return null;
  if (overlay.key !== form.key) return null;
  if (validateSchemaShape(overlay).length) return null;
  return overlay;
}

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new ApiError("This browser blocked local storage, so the change could not be kept.", 0, null);
  }
}
