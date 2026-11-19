import { isRequired, isVisible, resolveOptions, syncValues } from "./rules.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validate(schema, values, onlyIds = null) {
  const prepared = syncValues(schema, values);
  const errors = {};
  const allow = Array.isArray(onlyIds) ? new Set(onlyIds) : null;
  for (const [id, field] of Object.entries(schema.fields || {})) {
    if (allow && !allow.has(id)) continue;
    if (!isVisible(field, prepared, schema.fields)) continue;
    validateField(id, field, prepared[id], prepared, schema.fields, errors);
  }
  return errors;
}

function validateField(path, field, value, values, fields, errors) {
  if (field.type === "repeater") {
    const rows = Array.isArray(value) ? value : [];
    const min = field.minItems || 0;
    if (rows.length < min) errors[path] = [`Add at least ${min} item(s).`];
    rows.forEach((row, index) => {
      const rowValues = row || {};
      for (const [childId, child] of Object.entries(field.itemFields || {})) {
        if (!isVisible(child, rowValues, field.itemFields)) continue;
        validateScalar(`${path}[${index}].${childId}`, child, rowValues[childId], rowValues, field.itemFields, errors);
      }
    });
    return;
  }
  validateScalar(path, field, value, values, fields, errors);
}

function validateScalar(path, field, value, values, fields, errors) {
  if (isRequired(field, values, fields) && isBlank(value, field.type)) {
    errors[path] = ["This field is required."];
    return;
  }
  if (isBlank(value, field.type)) return;
  if ((field.type === "text" || field.type === "textarea") && field.minLength && String(value).trim().length < field.minLength) {
    errors[path] = [`Enter at least ${field.minLength} characters.`];
    return;
  }
  if ((field.type === "text" || field.type === "textarea" || field.type === "email") && field.maxLength && String(value).length > field.maxLength) {
    errors[path] = [`Enter at most ${field.maxLength} characters.`];
    return;
  }
  if (field.type === "email" && !EMAIL.test(String(value))) {
    errors[path] = ["Enter a valid email address."];
    return;
  }
  if (field.pattern) {
    let expression = null;
    try {
      expression = new RegExp(field.pattern);
    } catch {
      expression = null;
    }
    if (!expression || !expression.test(String(value))) {
      errors[path] = ["Enter a value in the expected format."];
      return;
    }
  }
  if (field.type === "number") {
    const number = Number(value);
    if (Number.isNaN(number)) {
      errors[path] = ["Enter a number."];
      return;
    }
    if (field.min != null && number < field.min) {
      errors[path] = [`Enter a number of at least ${field.min}.`];
      return;
    }
    if (field.max != null && number > field.max) {
      errors[path] = [`Enter a number no greater than ${field.max}.`];
      return;
    }
  }
  if (field.type === "select" || field.type === "radio") {
    const allowed = new Set(resolveOptions(field, values, fields).map((option) => String(option.value)));
    if (!allowed.has(String(value))) errors[path] = ["Choose a valid option."];
  }
}

function isBlank(value, type) {
  if (type === "checkbox") return value !== true;
  if (Array.isArray(value)) return value.length === 0;
  return value === undefined || value === null || String(value).trim() === "";
}

export function toPayload(schema, values) {
  const prepared = syncValues(schema, values);
  const payload = {};
  for (const [id, field] of Object.entries(schema.fields || {})) {
    if (!isVisible(field, prepared, schema.fields)) continue;
    if (field.type === "repeater") {
      payload[id] = (prepared[id] || []).map((row) => {
        const item = {};
        for (const [childId, child] of Object.entries(field.itemFields || {})) {
          if (!isVisible(child, row, field.itemFields)) continue;
          item[childId] = row?.[childId] ?? "";
        }
        return item;
      });
      continue;
    }
    payload[id] = prepared[id] ?? (field.type === "checkbox" ? false : "");
  }
  return payload;
}

export function fieldIdsInStep(schema, stepId) {
  const step = (schema.steps || []).find((item) => item.id === stepId);
  if (!step) return [];
  const ids = [];
  for (const section of step.sections || []) {
    for (const row of section.rows || []) {
      for (const col of row.cols || []) ids.push(col.field);
    }
  }
  return ids;
}
