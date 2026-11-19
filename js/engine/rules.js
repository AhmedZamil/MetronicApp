export function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function readValue(path, values, fields) {
  if (!path) return undefined;
  const parts = String(path).split(".");
  if (parts.length === 2) {
    const [parent, child] = parts;
    const field = fields?.[parent];
    if (field?.type === "repeater") {
      const rows = Array.isArray(values?.[parent]) ? values[parent] : [];
      return rows
        .map((row) => row?.[child])
        .filter((item) => item !== undefined && item !== null && item !== "");
    }
  }
  return values?.[path];
}

export function evalRule(rule, values, fields) {
  if (!rule) return true;
  if (Array.isArray(rule.all)) return rule.all.every((item) => evalRule(item, values, fields));
  if (Array.isArray(rule.any)) return rule.any.some((item) => evalRule(item, values, fields));
  return compare(rule.op, readValue(rule.field, values, fields), rule.value);
}

function compare(op, actual, expected) {
  if (Array.isArray(actual)) {
    if (op === "eq") return actual.includes(expected);
    if (op === "neq") return actual.every((item) => item !== expected);
    if (op === "in") return Array.isArray(expected) && actual.some((item) => expected.includes(item));
    if (op === "empty") return actual.length === 0;
    if (op === "notEmpty") return actual.length > 0;
    return false;
  }
  if (op === "eq") return actual === expected;
  if (op === "neq") return actual !== expected;
  if (op === "in") return Array.isArray(expected) && expected.includes(actual);
  if (op === "empty") return actual === undefined || actual === null || actual === "";
  if (op === "notEmpty") return !(actual === undefined || actual === null || actual === "");
  return false;
}

export function isVisible(field, values, fields) {
  if (!field) return false;
  if (!field.visibleWhen) return true;
  return evalRule(field.visibleWhen, values, fields);
}

export function isRequired(field, values, fields) {
  if (!isVisible(field, values, fields)) return false;
  if (field.required) return true;
  if (field.requiredWhen) return evalRule(field.requiredWhen, values, fields);
  return false;
}

export function resolveOptions(field, values, fields) {
  if (field?.optionsFrom) {
    const parent = readValue(field.optionsFrom.field, values, fields);
    const key = Array.isArray(parent) ? "" : String(parent ?? "");
    return field.optionsFrom.map?.[key] || [];
  }
  return field?.options || [];
}

export function syncValues(schema, values) {
  const next = clone(values || {});
  const fields = schema.fields || {};
  for (let pass = 0; pass < 2; pass += 1) {
    for (const [id, field] of Object.entries(fields)) {
      if (field.type === "repeater") {
        next[id] = Array.isArray(next[id]) ? next[id].map((row) => ({ ...row })) : [];
        continue;
      }
      if (field.type === "checkbox") next[id] = next[id] === true;
      else if (next[id] === undefined || next[id] === null) next[id] = "";
      if (field.optionsFrom && isVisible(field, next, fields)) {
        const allowed = new Set(resolveOptions(field, next, fields).map((option) => String(option.value)));
        if (next[id] !== "" && !allowed.has(String(next[id]))) next[id] = "";
      }
    }
  }
  return next;
}

export function emptyValues(schema) {
  const values = {};
  for (const [id, field] of Object.entries(schema.fields || {})) {
    if (field.type === "repeater") values[id] = [];
    else if (field.type === "checkbox") values[id] = false;
    else values[id] = "";
  }
  return syncValues(schema, values);
}

export function writePath(values, path, value) {
  const match = /^([A-Za-z][A-Za-z0-9]*)\[(\d+)\]\.([A-Za-z][A-Za-z0-9]*)$/.exec(path);
  if (!match) {
    values[path] = value;
    return true;
  }
  const rows = values[match[1]];
  const index = Number(match[2]);
  if (!Array.isArray(rows) || !rows[index]) return false;
  rows[index][match[3]] = value;
  return true;
}
