import { clone } from "./rules.js";

const FIELD_ID = /^[a-z][a-zA-Z0-9]{0,40}$/;
const KEY_ID = /^[a-z][a-z0-9-]{0,60}$/;
const TYPES = new Set(["text", "textarea", "number", "select", "radio", "checkbox", "date", "email", "repeater"]);
const SCALAR = new Set(["text", "textarea", "number", "select", "radio", "checkbox", "date", "email"]);
const SPANS = new Set([4, 6, 8, 12]);
const OPS = new Set(["eq", "neq", "in", "empty", "notEmpty"]);
const PRESERVE = ["minLength", "maxLength", "pattern", "min", "max"];

export function canEditSchema(role, schema) {
  if (role === "platform-admin") return true;
  if (role === "tenant-admin" && schema?.scope !== "global") return true;
  return false;
}

export function formsForTenant(forms, tenantId) {
  return (forms || []).filter((form) => {
    if (form.scope === "global") return true;
    if (!Array.isArray(form.tenants) || form.tenants.length === 0) return true;
    return form.tenants.includes(tenantId);
  });
}

export function submissionsForTenant(items, tenantId) {
  return (items || []).filter((item) => item.tenantId === tenantId);
}

export function orderedFields(schema) {
  const list = [];
  for (const step of schema.steps || []) {
    for (const section of step.sections || []) {
      for (const row of section.rows || []) {
        for (const col of row.cols || []) {
          list.push({ id: col.field, span: col.span, stepId: step.id, field: schema.fields[col.field] });
        }
      }
    }
  }
  return list;
}

export function pathExists(schema, path) {
  if (typeof path !== "string" || path === "") return false;
  const parts = path.split(".");
  if (parts.length === 2) {
    const field = schema.fields?.[parts[0]];
    return field?.type === "repeater" && Boolean(field.itemFields?.[parts[1]]);
  }
  if (parts.length > 2) return false;
  return Boolean(schema.fields?.[path]);
}

export function validateSchemaShape(schema) {
  const errors = [];
  if (!schema || typeof schema !== "object") return ["Schema must be an object."];
  if (!KEY_ID.test(schema.key || "")) errors.push("Form key is invalid.");
  if (typeof schema.title !== "string" || schema.title.trim() === "") errors.push("Form title is required.");
  if (schema.scope !== "tenant" && schema.scope !== "global") errors.push("Scope must be tenant or global.");
  if (schema.version != null && (!Number.isInteger(schema.version) || schema.version < 1)) errors.push("Version is invalid.");
  if (!schema.fields || typeof schema.fields !== "object" || Array.isArray(schema.fields)) errors.push("Fields are required.");
  if (!Array.isArray(schema.steps) || schema.steps.length === 0) errors.push("At least one step is required.");

  const fields = schema.fields || {};
  for (const [id, field] of Object.entries(fields)) {
    if (!FIELD_ID.test(id)) errors.push(`Field id ${id} is invalid.`);
    if (!field || typeof field !== "object") {
      errors.push(`Field ${id} is invalid.`);
      continue;
    }
    if (!TYPES.has(field.type)) errors.push(`Field ${id} has an unsupported type.`);
    if (typeof field.label !== "string" || field.label.trim() === "") errors.push(`Field ${id} needs a label.`);
    if (field.type === "repeater") {
      if (!field.itemFields || typeof field.itemFields !== "object") errors.push(`Field ${id} needs item fields.`);
      for (const [childId, child] of Object.entries(field.itemFields || {})) {
        if (!FIELD_ID.test(childId)) errors.push(`Field ${id}.${childId} is invalid.`);
        if (!SCALAR.has(child?.type)) errors.push(`Field ${id}.${childId} must be a scalar.`);
        checkChoice(child, `${id}.${childId}`, errors);
        checkRules(schema, child, `${id}.${childId}`, errors);
      }
    } else {
      checkChoice(field, id, errors);
      checkRules(schema, field, id, errors);
    }
  }

  const seen = new Set();
  for (const step of schema.steps || []) {
    if (!KEY_ID.test(step?.id || "")) errors.push("Step id is invalid.");
    if (typeof step?.title !== "string" || step.title.trim() === "") errors.push("Step title is required.");
    for (const section of step.sections || []) {
      for (const row of section.rows || []) {
        for (const col of row.cols || []) {
          if (!SPANS.has(col.span)) errors.push(`Column span for ${col.field} must be 4, 6, 8, or 12.`);
          if (!fields[col.field]) errors.push(`Layout references unknown field ${col.field}.`);
          if (seen.has(col.field)) errors.push(`Field ${col.field} is placed more than once.`);
          seen.add(col.field);
        }
      }
    }
  }
  for (const id of Object.keys(fields)) {
    if (!seen.has(id)) errors.push(`Field ${id} is missing from the layout.`);
  }
  return errors;
}

function checkChoice(field, id, errors) {
  if (!field || (field.type !== "select" && field.type !== "radio")) return;
  if (field.optionsFrom) {
    if (!field.optionsFrom.field || typeof field.optionsFrom.map !== "object") errors.push(`Field ${id} optionsFrom is incomplete.`);
  } else if (!Array.isArray(field.options) || field.options.length === 0) {
    errors.push(`Field ${id} needs options.`);
  }
  for (const option of field.options || []) {
    if (option?.value === undefined || typeof option?.label !== "string") errors.push(`Field ${id} has a bad option.`);
  }
}

function checkRules(schema, field, id, errors) {
  if (!field) return;
  for (const key of ["visibleWhen", "requiredWhen"]) {
    if (field[key] && !ruleOk(schema, field[key])) errors.push(`Field ${id} has an invalid ${key} rule.`);
  }
  if (field.optionsFrom?.field && !pathExists(schema, field.optionsFrom.field)) {
    errors.push(`Field ${id} depends on an unknown field.`);
  }
}

function ruleOk(schema, rule) {
  if (!rule || typeof rule !== "object") return false;
  if (Array.isArray(rule.all)) return rule.all.length > 0 && rule.all.every((item) => ruleOk(schema, item));
  if (!OPS.has(rule.op) || !rule.field || !pathExists(schema, rule.field)) return false;
  if (rule.op === "in" && !Array.isArray(rule.value)) return false;
  return true;
}

export function findReferences(schema, id) {
  const refs = [];
  for (const [fieldId, field] of Object.entries(schema.fields || {})) {
    if (fieldId === id) continue;
    const paths = rulePaths(field);
    if (field.type === "repeater") {
      for (const child of Object.values(field.itemFields || {})) paths.push(...rulePaths(child));
    }
    if (paths.some((path) => path === id || path.startsWith(`${id}.`))) refs.push(fieldId);
  }
  return refs;
}

function rulePaths(field) {
  const paths = [];
  collect(field?.visibleWhen, paths);
  collect(field?.requiredWhen, paths);
  if (field?.optionsFrom?.field) paths.push(field.optionsFrom.field);
  return paths;
}

function collect(rule, paths) {
  if (!rule) return;
  if (Array.isArray(rule.all)) rule.all.forEach((item) => collect(item, paths));
  if (rule.field) paths.push(rule.field);
}

export function removeField(schema, id) {
  const refs = findReferences(schema, id);
  if (!schema.fields?.[id]) return { ok: false, refs, errors: ["Field not found."] };
  if (refs.length) return { ok: false, refs, errors: [`${id} is used by ${refs.join(", ")}.`] };
  delete schema.fields[id];
  for (const step of schema.steps || []) {
    for (const section of step.sections || []) {
      section.rows = (section.rows || []).flatMap((row) => {
        const cols = (row.cols || []).filter((col) => col.field !== id);
        return cols.length ? [{ ...row, cols }] : [];
      });
    }
  }
  return { ok: true, refs: [], errors: [] };
}

export function addField(schema, spec) {
  const errors = [];
  if (!FIELD_ID.test(spec?.id || "")) errors.push("Field id is invalid.");
  if (schema.fields?.[spec?.id]) errors.push("Field id already exists.");
  if (!SCALAR.has(spec?.type)) errors.push("New fields must be scalar.");
  const span = spec?.span ?? 6;
  if (!SPANS.has(span)) errors.push("Span must be 4, 6, 8, or 12.");
  const step = (schema.steps || []).find((item) => item.id === spec?.step) || schema.steps?.[0];
  if (!step) errors.push("Choose a step.");
  if (typeof spec?.label !== "string" || spec.label.trim() === "") errors.push("Label is required.");
  if (errors.length) return { ok: false, errors };
  const field = { type: spec.type, label: spec.label.trim(), required: Boolean(spec.required) };
  if (spec.visibleWhen) field.visibleWhen = spec.visibleWhen;
  if (spec.requiredWhen) field.requiredWhen = spec.requiredWhen;
  if (spec.type === "select" || spec.type === "radio") {
    field.options = Array.isArray(spec.options) && spec.options.length ? spec.options : [{ value: "yes", label: "Yes" }];
  }
  schema.fields[spec.id] = field;
  if (!step.sections?.length) step.sections = [{ id: "main", title: "Fields", rows: [] }];
  step.sections[0].rows.push({ cols: [{ span, field: spec.id }] });
  return { ok: true, errors: [] };
}

export function updateField(schema, id, patch) {
  const current = schema.fields?.[id];
  if (!current) return { ok: false, errors: ["Field not found."] };
  if (current.type === "repeater") return { ok: false, errors: ["Repeater fields stay in the schema."] };
  if (!SCALAR.has(patch?.type)) return { ok: false, errors: ["Choose a scalar field type."] };
  if (typeof patch?.label !== "string" || patch.label.trim() === "") return { ok: false, errors: ["Label is required."] };
  if (!SPANS.has(patch.span)) return { ok: false, errors: ["Span must be 4, 6, 8, or 12."] };
  const step = (schema.steps || []).find((item) => item.id === patch.step);
  if (!step) return { ok: false, errors: ["Choose a step."] };
  if ((patch.type === "select" || patch.type === "radio") && !current.optionsFrom) {
    if (!Array.isArray(patch.options) || patch.options.length === 0) return { ok: false, errors: ["Add at least one option."] };
  }

  const next = { type: patch.type, label: patch.label.trim(), required: Boolean(patch.required) };
  for (const key of PRESERVE) if (current[key] != null) next[key] = current[key];
  if ((patch.type === "select" || patch.type === "radio") && current.optionsFrom && !patch.replaceOptions) {
    next.optionsFrom = current.optionsFrom;
  } else if (patch.type === "select" || patch.type === "radio") {
    next.options = patch.options;
  }
  if (patch.visibleWhen) next.visibleWhen = patch.visibleWhen;
  if (patch.requiredWhen) next.requiredWhen = patch.requiredWhen;
  schema.fields[id] = next;

  const spot = locate(schema, id);
  if (spot && spot.step.id !== patch.step) moveFieldToStep(schema, id, patch.step, patch.span);
  else setSpan(schema, id, patch.span);
  return { ok: true, errors: [] };
}

export function commitField(schema, id, patch, isNew) {
  const backup = clone(schema);
  const result = isNew ? addField(schema, { ...patch, id }) : updateField(schema, id, patch);
  if (!result.ok) {
    restore(schema, backup);
    return result;
  }
  const shape = validateSchemaShape(schema);
  if (shape.length) {
    restore(schema, backup);
    return { ok: false, errors: shape };
  }
  return { ok: true, errors: [] };
}

export function setSpan(schema, id, span) {
  if (!SPANS.has(span)) return false;
  const spot = locate(schema, id);
  if (!spot) return false;
  spot.col.span = span;
  return true;
}

export function moveFieldToStep(schema, id, stepId, span) {
  const step = (schema.steps || []).find((item) => item.id === stepId);
  const spot = locate(schema, id);
  if (!step || !spot) return false;
  const colSpan = SPANS.has(span) ? span : spot.col.span;
  spot.row.cols = spot.row.cols.filter((col) => col.field !== id);
  spot.section.rows = spot.section.rows.filter((row) => row.cols.length);
  if (!step.sections.length) step.sections.push({ id: "main", title: "Fields", rows: [] });
  step.sections[0].rows.push({ cols: [{ span: colSpan, field: id }] });
  return true;
}

export function moveField(schema, id, direction) {
  const spot = locate(schema, id);
  if (!spot) return false;
  const rows = [];
  for (const section of spot.step.sections || []) {
    for (const row of section.rows || []) rows.push({ section, row });
  }
  const index = rows.findIndex((item) => item.row.cols.some((col) => col.field === id));
  const target = index + direction;
  if (index < 0 || target < 0 || target >= rows.length) return false;
  const current = rows[index];
  const other = rows[target];
  const currentIndex = current.section.rows.indexOf(current.row);
  const otherIndex = other.section.rows.indexOf(other.row);
  if (current.section === other.section) {
    const swap = current.section.rows[currentIndex];
    current.section.rows[currentIndex] = current.section.rows[otherIndex];
    current.section.rows[otherIndex] = swap;
  } else {
    current.section.rows[currentIndex] = other.row;
    other.section.rows[otherIndex] = current.row;
  }
  return true;
}

export function locate(schema, id) {
  for (const step of schema.steps || []) {
    for (const section of step.sections || []) {
      for (const row of section.rows || []) {
        for (const col of row.cols || []) {
          if (col.field === id) return { step, section, row, col };
        }
      }
    }
  }
  return null;
}

function restore(schema, backup) {
  for (const key of Object.keys(schema)) delete schema[key];
  Object.assign(schema, backup);
}
