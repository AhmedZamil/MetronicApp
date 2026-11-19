import { escapeHtml } from "../html.js";
import { emptyValues, isRequired, isVisible, resolveOptions, syncValues, writePath } from "./rules.js";
import { fieldIdsInStep, validate } from "./validate.js";

export function mountForm(host, options) {
  const schema = options.schema;
  const controller = new AbortController();
  const state = {
    values: syncValues(schema, options.values || emptyValues(schema)),
    step: 0,
    errors: {},
    pending: false,
    message: "",
    sig: ""
  };
  state.sig = signature(schema, state.values);

  function onEdit(event) {
    const path = event.target?.dataset?.path;
    if (!path || state.pending) return;
    writePath(state.values, path, event.target.type === "checkbox" ? event.target.checked : event.target.value);
    state.values = syncValues(schema, state.values);
    pruneErrors(schema, state);
    delete state.errors[path];
    state.message = "";
    const next = signature(schema, state.values);
    if (next !== state.sig) {
      state.sig = next;
      render(path);
      return;
    }
    paint(host, state);
  }

  async function onClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button || state.pending) return;
    event.preventDefault();
    const action = button.dataset.action;
    if (action === "add-row") return addRow(schema, state, button.dataset.field, render);
    if (action === "remove-row") return removeRow(schema, state, button.dataset.field, Number(button.dataset.index), render);
    if (action === "back") {
      state.step = Math.max(0, state.step - 1);
      state.errors = {};
      state.message = "";
      state.sig = signature(schema, state.values);
      render();
      return;
    }
    if (action === "next") {
      if (!validateStep(schema, state)) {
        state.message = "Fix the highlighted fields.";
        render(firstErrorPath(state));
        return;
      }
      state.step += 1;
      state.errors = {};
      state.message = "";
      state.sig = signature(schema, state.values);
      render();
      return;
    }
    if (action === "submit") {
      state.values = syncValues(schema, state.values);
      state.errors = validate(schema, state.values);
      if (Object.keys(state.errors).length) {
        state.step = stepForError(schema, state.errors) ?? state.step;
        state.message = "Fix the highlighted fields.";
        render(firstErrorPath(state));
        return;
      }
      state.pending = true;
      state.message = "";
      render();
      try {
        await options.onSubmit(state.values);
      } catch (error) {
        state.pending = false;
        state.errors = error.body?.errors || {};
        state.message = error.body?.title || error.message;
        state.step = stepForError(schema, state.errors) ?? state.step;
        render(firstErrorPath(state));
      }
    }
  }

  function render(focusPath) {
    host.innerHTML = formHtml(schema, state);
    paint(host, state);
    const target = focusPath || firstErrorPath(state);
    if (target) focusControl(host, target);
  }

  host.addEventListener("input", onEdit, { signal: controller.signal });
  host.addEventListener("change", onEdit, { signal: controller.signal });
  host.addEventListener("click", onClick, { signal: controller.signal });
  render();

  return {
    destroy() {
      controller.abort();
      host.replaceChildren();
    }
  };
}

function validateStep(schema, state) {
  const step = schema.steps[state.step];
  state.values = syncValues(schema, state.values);
  state.errors = validate(schema, state.values, fieldIdsInStep(schema, step.id));
  return Object.keys(state.errors).length === 0;
}

function addRow(schema, state, fieldId, render) {
  const field = schema.fields[fieldId];
  if (!field || field.type !== "repeater") return;
  const row = {};
  for (const [childId, child] of Object.entries(field.itemFields)) {
    row[childId] = child.type === "checkbox" ? false : "";
  }
  state.values[fieldId] = [...(state.values[fieldId] || []), row];
  state.sig = signature(schema, state.values);
  render(`${fieldId}[${state.values[fieldId].length - 1}].${Object.keys(field.itemFields)[0]}`);
}

function removeRow(schema, state, fieldId, index, render) {
  const rows = state.values[fieldId] || [];
  state.values[fieldId] = rows.filter((_, rowIndex) => rowIndex !== index);
  for (const key of Object.keys(state.errors)) {
    if (key === fieldId || key.startsWith(`${fieldId}[`)) delete state.errors[key];
  }
  state.sig = signature(schema, state.values);
  render();
}

function pruneErrors(schema, state) {
  for (const key of Object.keys(state.errors)) {
    const top = key.split("[")[0];
    const field = schema.fields[top];
    if (field && !isVisible(field, state.values, schema.fields)) delete state.errors[key];
  }
}

function signature(schema, values) {
  const visible = {};
  const required = {};
  const options = {};
  const counts = {};
  for (const [id, field] of Object.entries(schema.fields)) {
    visible[id] = isVisible(field, values, schema.fields);
    required[id] = isRequired(field, values, schema.fields);
    if (field.optionsFrom) options[id] = resolveOptions(field, values, schema.fields).map((item) => item.value).join("|");
    if (field.type === "repeater") counts[id] = Array.isArray(values[id]) ? values[id].length : 0;
  }
  return JSON.stringify({ visible, required, options, counts });
}

function formHtml(schema, state) {
  const multi = schema.steps.length > 1;
  const step = schema.steps[state.step];
  const nav = multi
    ? `<ol class="stepper-nav">${schema.steps.map((item, index) => {
        const mode = index === state.step ? "current" : index < state.step ? "complete" : "";
        return `<li class="stepper-item ${mode}"><span class="stepper-icon">${index + 1}</span><span class="stepper-label">${escapeHtml(item.title)}</span></li>`;
      }).join("")}</ol>`
    : "";
  const sections = (step.sections || []).map((section) => `
    <section class="form-section">
      <h2>${escapeHtml(section.title)}</h2>
      ${(section.rows || []).map((row) => `<div class="row g-5">${(row.cols || []).map((col) => `
        <div class="col-12 col-md-${col.span}">${fieldHtml(schema, col.field, state)}</div>`).join("")}</div>`).join("")}
    </section>`).join("");
  const last = state.step >= schema.steps.length - 1;
  return `
    <form class="sl-form" novalidate>
      <div id="form-alert" class="alert alert-danger" role="alert" ${state.message ? "" : "hidden"}>${escapeHtml(state.message)}</div>
      ${nav}
      <div class="stepper-pane">${sections}</div>
      <div class="form-actions">
        ${state.step > 0 ? '<button class="btn btn-light" id="form-back" type="button" data-action="back">Back</button>' : "<span></span>"}
        <div class="form-actions-end">
          ${last ? "" : '<button class="btn btn-primary" id="form-next" type="button" data-action="next">Continue</button>'}
          ${last ? `<button class="btn btn-primary" id="form-submit" type="button" data-action="submit"${state.pending ? " disabled" : ""}>${state.pending ? "Submitting…" : "Submit"}</button>` : ""}
        </div>
      </div>
    </form>`;
}

function fieldHtml(schema, id, state) {
  const field = schema.fields[id];
  if (!field) return "";
  if (field.type === "repeater") return repeaterHtml(schema, id, field, state);
  return scalarHtml(field, id, state.values[id], state.values, schema.fields, state.errors);
}

function repeaterHtml(schema, id, field, state) {
  const hidden = isVisible(field, state.values, schema.fields) ? "" : " d-none";
  const required = isRequired(field, state.values, schema.fields);
  const rows = state.values[id] || [];
  const body = rows.length
    ? rows.map((row, index) => `
      <div class="repeater-row">
        <div class="repeater-toolbar">
          <strong>${escapeHtml(field.label)} ${index + 1}</strong>
          <button class="btn btn-sm btn-light" type="button" data-action="remove-row" data-field="${escapeHtml(id)}" data-index="${index}">Remove</button>
        </div>
        <div class="row g-5">
          ${Object.keys(field.itemFields).map((childId) => `
            <div class="col-12 col-md-6">${scalarHtml(field.itemFields[childId], childId, row?.[childId], row, field.itemFields, state.errors, `${id}[${index}].${childId}`)}</div>`).join("")}
        </div>
      </div>`).join("")
    : `<p class="repeater-empty">No ${escapeHtml(field.label.toLowerCase())} yet.</p>`;
  return `
    <div class="fv-row${hidden}" data-field="${escapeHtml(id)}" data-error-key="${escapeHtml(id)}">
      <div class="repeater-head">
        <label class="form-label${required ? " required" : ""}">${escapeHtml(field.label)}</label>
        <button class="btn btn-sm btn-light" type="button" data-action="add-row" data-field="${escapeHtml(id)}">Add</button>
      </div>
      ${messageHtml(state.errors[id])}
      ${body}
    </div>`;
}

function scalarHtml(field, id, value, values, fields, errors, path = id) {
  const hidden = isVisible(field, values, fields) ? "" : " d-none";
  const required = isRequired(field, values, fields);
  const invalid = errors[path] ? " is-invalid" : "";
  const controlId = `fld-${path.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  let control = "";
  if (field.type === "textarea") {
    control = `<textarea class="form-control form-control-solid${invalid}" id="${controlId}" data-path="${escapeHtml(path)}" rows="4"${required ? " required" : ""}>${escapeHtml(value ?? "")}</textarea>`;
  } else if (field.type === "select") {
    const options = resolveOptions(field, values, fields);
    control = `<select class="form-select form-select-solid${invalid}" id="${controlId}" data-path="${escapeHtml(path)}"${required ? " required" : ""}>
      <option value="">Select</option>
      ${options.map((option) => `<option value="${escapeHtml(option.value)}"${String(value) === String(option.value) ? " selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
    </select>`;
  } else if (field.type === "radio") {
    const options = resolveOptions(field, values, fields);
    control = options.map((option) => `
      <label class="form-check form-check-inline">
        <input class="form-check-input${invalid}" type="radio" name="${escapeHtml(path)}" data-path="${escapeHtml(path)}" value="${escapeHtml(option.value)}"${String(value) === String(option.value) ? " checked" : ""}>
        <span class="form-check-label">${escapeHtml(option.label)}</span>
      </label>`).join("");
  } else if (field.type === "checkbox") {
    control = `
      <label class="form-check">
        <input class="form-check-input${invalid}" type="checkbox" id="${controlId}" data-path="${escapeHtml(path)}"${value === true ? " checked" : ""}>
        <span class="form-check-label${required ? " required" : ""}">${escapeHtml(field.label)}</span>
      </label>`;
  } else {
    const type = field.type === "date" || field.type === "number" || field.type === "email" ? field.type : "text";
    control = `<input class="form-control form-control-solid${invalid}" type="${type}" id="${controlId}" data-path="${escapeHtml(path)}" value="${escapeHtml(value ?? "")}"${required ? " required" : ""}>`;
  }
  const label = field.type === "checkbox"
    ? ""
    : `<label class="form-label${required ? " required" : ""}" for="${controlId}">${escapeHtml(field.label)}</label>`;
  return `
    <div class="fv-row${hidden}" data-field="${escapeHtml(id)}" data-error-key="${escapeHtml(path)}">
      ${label}
      ${control}
      ${messageHtml(errors[path])}
    </div>`;
}

function messageHtml(messages) {
  return `<div class="fv-plugins-message-container"><div class="fv-help-block">${escapeHtml((messages || []).join(" "))}</div></div>`;
}

function paint(host, state) {
  const alert = host.querySelector("#form-alert");
  if (alert) {
    alert.hidden = !state.message;
    alert.textContent = state.message;
    alert.classList.toggle("alert-danger", Boolean(state.message));
  }
  host.querySelectorAll("[data-error-key]").forEach((row) => {
    const messages = state.errors[row.dataset.errorKey] || [];
    const block = row.querySelector(":scope > .fv-plugins-message-container .fv-help-block");
    if (block) block.textContent = messages.join(" ");
    row.classList.toggle("has-error", messages.length > 0);
  });
  host.querySelectorAll("[data-path]").forEach((control) => {
    const invalid = Boolean(state.errors[control.dataset.path]);
    control.classList.toggle("is-invalid", invalid);
    control.setAttribute("aria-invalid", invalid ? "true" : "false");
  });
}

function focusControl(host, path) {
  const control = host.querySelector(`[data-path="${CSS.escape(path)}"]`);
  if (control) {
    control.focus();
    if (typeof control.setSelectionRange === "function" && control.type !== "date" && control.type !== "number") {
      const length = control.value?.length ?? 0;
      try { control.setSelectionRange(length, length); } catch { /* ignore types that reject selection */ }
    }
    return;
  }
  host.querySelector(`[data-error-key="${CSS.escape(path)}"] button`)?.focus();
}

function firstErrorPath(state) {
  return Object.keys(state.errors)[0] || "";
}

function stepForError(schema, errors) {
  const keys = Object.keys(errors);
  if (!keys.length) return null;
  for (let index = 0; index < schema.steps.length; index += 1) {
    const ids = new Set(fieldIdsInStep(schema, schema.steps[index].id));
    if (keys.some((key) => ids.has(key.split("[")[0]))) return index;
  }
  return null;
}
