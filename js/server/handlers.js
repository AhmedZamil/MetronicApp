import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clone, syncValues } from "../engine/rules.js";
import { canEditSchema, formsForTenant, submissionsForTenant, validateSchemaShape } from "../engine/schema.js";
import { toPayload, validate } from "../engine/validate.js";

const ROLES = new Set(["analyst", "tenant-admin", "platform-admin"]);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let cached;

export function loadSeed() {
  if (!cached) cached = JSON.parse(readFileSync(path.join(root, "data", "seed.json"), "utf8"));
  return cached;
}

export function handleBootstrap() {
  const seed = loadSeed();
  return {
    status: 200,
    body: {
      product: "SkyLake Control Forms",
      company: "SKY LAKE SOLUTIONS",
      tenants: seed.tenants,
      users: seed.users.map((user) => ({
        id: user.id,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId
      }))
    }
  };
}

export function handleForms(request) {
  if (request.body?.__invalidJson) return problem(400, "Request body must be JSON.");
  const seed = loadSeed();
  if (request.method === "GET") {
    const auth = readAuth(request.headers, seed);
    if (auth.error) return auth.error;
    if (request.query?.key) {
      const form = seed.forms.find((item) => item.key === request.query.key);
      if (!form || !formsForTenant([form], auth.tenantId).length) return problem(404, "Form not found.");
      return { status: 200, body: { form: clone(form) } };
    }
    return { status: 200, body: { forms: clone(formsForTenant(seed.forms, auth.tenantId)) } };
  }
  if (request.method === "PUT") {
    const auth = readAuth(request.headers, seed);
    if (auth.error) return auth.error;
    const incoming = request.body?.schema || request.body;
    if (!incoming || typeof incoming !== "object") return problem(400, "Schema is required.");
    const existing = seed.forms.find((item) => item.key === (request.query?.key || incoming.key));
    if (!existing) return problem(404, "Form not found.");
    if (!canEditSchema(auth.role, existing)) return problem(403, "You cannot edit this form.");
    const schema = clone(incoming);
    schema.key = existing.key;
    schema.scope = existing.scope;
    if (request.query?.key && request.query.key !== schema.key) return problem(400, "Form key mismatch.");
    const shape = validateSchemaShape(schema);
    if (shape.length) return problem(400, "Schema is invalid", { schema: shape });
    return { status: 200, body: { ok: true, schema } };
  }
  return problem(405, "Method not allowed.");
}

export function handleSubmissions(request) {
  if (request.body?.__invalidJson) return problem(400, "Request body must be JSON.");
  const seed = loadSeed();
  const auth = readAuth(request.headers, seed);
  if (auth.error) return auth.error;
  if (request.method === "GET") {
    return { status: 200, body: { submissions: clone(submissionsForTenant(seed.submissions, auth.tenantId)) } };
  }
  if (request.method === "POST") {
    const formKey = request.body?.formKey;
    const existing = seed.forms.find((item) => item.key === formKey);
    if (!existing || !formsForTenant([existing], auth.tenantId).length) return problem(404, "Form not found.");
    let schema = clone(existing);
    if (request.body?.schema) {
      schema = clone(request.body.schema);
      schema.key = existing.key;
      schema.scope = existing.scope;
      const shape = validateSchemaShape(schema);
      if (shape.length) return problem(400, "Schema is invalid", { schema: shape });
    }
    const values = syncValues(schema, request.body?.values || {});
    const errors = validate(schema, values);
    if (Object.keys(errors).length) return problem(400, "Validation failed", errors);
    const id = typeof request.body?.id === "string" && /^sub_[a-zA-Z0-9_-]{1,40}$/.test(request.body.id)
      ? request.body.id
      : `sub_${Date.now().toString(36)}`;
    return {
      status: 200,
      body: {
        submission: {
          id,
          formKey: existing.key,
          formTitle: schema.title,
          tenantId: auth.tenantId,
          submittedBy: header(request.headers, "x-user-name") || "User",
          submittedAt: new Date().toISOString(),
          values: toPayload(schema, values)
        }
      }
    };
  }
  return problem(405, "Method not allowed.");
}

function readAuth(headers, seed) {
  const tenantId = header(headers, "x-tenant-id");
  const role = header(headers, "x-role");
  if (!tenantId || !role) return { error: problem(400, "Tenant and role are required.") };
  if (!ROLES.has(role)) return { error: problem(403, "Unknown role.") };
  if (!seed.tenants.some((tenant) => tenant.id === tenantId)) return { error: problem(400, "Unknown tenant.") };
  return { tenantId, role };
}

function header(headers, name) {
  if (!headers) return "";
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) {
      const raw = Array.isArray(value) ? value[0] : value;
      return String(raw ?? "").trim();
    }
  }
  return "";
}

export function problem(status, title, errors) {
  const body = { title, status };
  if (errors) body.errors = errors;
  return { status, body };
}
