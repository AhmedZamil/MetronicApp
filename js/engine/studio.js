import { escapeHtml } from "../html.js";
import { clone } from "./rules.js";
import { commitField, moveField, orderedFields, removeField, validateSchemaShape } from "./schema.js";

const SCALAR = ["text", "textarea", "number", "select", "radio", "checkbox", "date", "email"];
const OPS = ["eq", "neq", "in", "empty", "notEmpty"];

export function mountStudio(host, options) {
  const state = {
    draft: clone(options.schema),
    selectedId: null,
    message: "",
    tone: "success",
    pending: false
  };
  const first = orderedFields(state.draft).find((item) => item.field?.type !== "repeater") || orderedFields(state.draft)[0];
  state.selectedId = first?.id || null;

  host.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-action]");
    if (!trigger || state.pending) return;
    event.preventDefault();
    const action = trigger.dataset.action;
    if (action === "add") startAdd();
    else if (action === "select") select(trigger.dataset.fieldId);
    else if (action === "delete") removeSelected();
    else if (action === "up") moveSelected(-1);
    else if (action === "down") moveSelected(1);
    else if (action === "save") save();
  });
  host.addEventListener("change", (event) => {
    if (event.target.id !== "field-type") return;
    const type = event.target.value;
    const locked = host.querySelector("#options-lock");
    const wrap = host.querySelector("#options-wrap");
    if (!wrap) return;
    const keepLinked = locked && !locked.hidden && (type === "select" || type === "radio");
    wrap.hidden = !(type === "select" || type === "radio") || keepLinked;
  });

  render();

  function startAdd() {
    if (state.selectedId && !applyFromEditor()) return;
    state.selectedId = "__new__";
    renderEditor();
    markList();
    host.querySelector("#field-id")?.focus();
  }

  function select(id) {
    if (!id || id === state.selectedId) return;
    if (!applyFromEditor()) return;
    state.selectedId = id;
    renderEditor();
    markList();
  }

  function removeSelected() {
    if (!state.selectedId || state.selectedId === "__new__") return;
    const result = removeField(state.draft, state.selectedId);
    if (!result.ok) {
      show(result.errors.join(" "), "danger");
      return;
    }
    state.selectedId = orderedFields(state.draft)[0]?.id || null;
    show("Field removed from the draft. Save the schema to keep it.", "success");
    render();
  }

  function moveSelected(direction) {
    if (!state.selectedId || state.selectedId === "__new__") return;
    if (!applyFromEditor()) return;
    moveField(state.draft, state.selectedId, direction);
    renderList();
  }

  async function save() {
    if (!applyFromEditor()) return;
    const shape = validateSchemaShape(state.draft);
    if (shape.length) {
      show(shape.join(" "), "danger");
      return;
    }
    const next = clone(state.draft);
    next.version = (state.draft.version || 1) + 1;
    state.pending = true;
    const button = host.querySelector("#studio-save");
    if (button) button.disabled = true;
    try {
      const saved = await options.onSave(next);
      state.draft = clone(saved);
      show("Schema saved. Open the runtime to see the change.", "success");
    } catch (error) {
      const schemaErrors = error.body?.errors?.schema;
      show(schemaErrors ? schemaErrors.join(" ") : error.message, "danger");
    } finally {
      state.pending = false;
      const saveButton = host.querySelector("#studio-save");
      if (saveButton) saveButton.disabled = false;
    }
  }

  function applyFromEditor() {
    if (!state.selectedId || !host.querySelector("#field-id")) return true;
    const current = state.draft.fields[state.selectedId];
    if (current?.type === "repeater") return true;
    const patch = readPatch();
    const isNew = state.selectedId === "__new__";
    const result = commitField(state.draft, isNew ? patch.id : state.selectedId, patch, isNew);
    if (!result.ok) {
      show(result.errors.join(" "), "danger");
      return false;
    }
    if (isNew) state.selectedId = patch.id;
    renderList();
    return true;
  }

  function readPatch() {
    const type = value("field-type");
    const wrap = host.querySelector("#options-wrap");
    return {
      id: value("field-id").trim(),
      label: value("field-label"),
      type,
      required: Boolean(host.querySelector("#field-required")?.checked),
      span: Number(value("field-span")),
      step: value("field-step"),
      options: parseOptions(value("field-options")),
      replaceOptions: Boolean(wrap && !wrap.hidden),
      visibleWhen: readRule("vis"),
      requiredWhen: readRule("req")
    };
  }

  function readRule(prefix) {
    if (!host.querySelector(`#${prefix}-enabled`)?.checked) return null;
    const op = value(`${prefix}-op`);
    const rule = { field: value(`${prefix}-field`), op };
    if (op === "in") rule.value = value(`${prefix}-value`).split(",").map((item) => item.trim()).filter(Boolean);
    else if (op !== "empty" && op !== "notEmpty") rule.value = value(`${prefix}-value`);
    return rule;
  }

  function value(id) {
    return host.querySelector(`#${id}`)?.value ?? "";
  }

  function render() {
    host.innerHTML = `
      <div id="studio-alert" class="alert" role="alert" hidden></div>
      <div class="row g-5">
        <div class="col-12 col-lg-4">
          <div class="card card-flush">
            <div class="card-header">
              <h2 class="card-title">Fields</h2>
              <button class="btn btn-sm btn-primary" id="studio-add" type="button" data-action="add">Add field</button>
            </div>
            <div class="card-body" id="studio-list"></div>
          </div>
        </div>
        <div class="col-12 col-lg-8">
          <div class="card card-flush">
            <div class="card-header"><h2 class="card-title">Field settings</h2></div>
            <div class="card-body" id="studio-editor"></div>
          </div>
        </div>
      </div>
      <div class="form-actions">
        <a class="btn btn-light" href="/app/runtime.html?key=${encodeURIComponent(state.draft.key)}">Open runtime</a>
        <button class="btn btn-primary" id="studio-save" type="button" data-action="save">Save schema</button>
      </div>`;
    renderList();
    renderEditor();
    show(state.message, state.tone);
  }

  function renderList() {
    const list = host.querySelector("#studio-list");
    if (!list) return;
    const items = orderedFields(state.draft);
    list.innerHTML = items.length ? items.map((item) => `
      <button class="studio-field${item.id === state.selectedId ? " is-active" : ""}" type="button" data-action="select" data-field-id="${escapeHtml(item.id)}">
        <span>${escapeHtml(item.field?.label || item.id)}</span>
        <small>${escapeHtml(item.field?.type || "field")} · ${escapeHtml(item.stepId)}</small>
      </button>`).join("") : `<p class="text-secondary mb-0">No fields yet.</p>`;
  }

  function markList() {
    host.querySelectorAll(".studio-field").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.fieldId === state.selectedId);
    });
  }

  function renderEditor() {
    const editor = host.querySelector("#studio-editor");
    if (!editor) return;
    if (!state.selectedId) {
      editor.innerHTML = `<p class="text-secondary mb-0">Select a field or add one.</p>`;
      return;
    }
    if (state.selectedId !== "__new__" && state.draft.fields[state.selectedId]?.type === "repeater") {
      const field = state.draft.fields[state.selectedId];
      editor.innerHTML = `
        <p class="mb-2"><strong>${escapeHtml(field.label)}</strong> is a repeater.</p>
        <p class="text-secondary mb-0">Its rows and child fields stay in the schema. Add, remove, and validate them in the runtime. The studio edits scalar fields around it.</p>`;
      return;
    }
    const isNew = state.selectedId === "__new__";
    const field = isNew ? { type: "text", label: "", required: false, options: [] } : state.draft.fields[state.selectedId];
    const placement = isNew ? null : orderedFields(state.draft).find((item) => item.id === state.selectedId);
    const stepId = placement?.stepId || state.draft.steps[state.draft.steps.length - 1]?.id;
    const span = placement?.span || 6;
    const linked = Boolean(field.optionsFrom);
    const showOptions = (field.type === "select" || field.type === "radio") && !linked;
    editor.innerHTML = `
      ${isNew ? "" : `<div class="editor-toolbar">
        <button class="btn btn-sm btn-light" id="studio-up" type="button" data-action="up">Move up</button>
        <button class="btn btn-sm btn-light" id="studio-down" type="button" data-action="down">Move down</button>
        <button class="btn btn-sm btn-light" id="studio-delete" type="button" data-action="delete">Delete</button>
      </div>`}
      <div class="row g-5">
        <div class="col-12 col-md-6">
          <label class="form-label" for="field-id">Field id</label>
          <input class="form-control form-control-solid" id="field-id" value="${escapeHtml(isNew ? "" : state.selectedId)}"${isNew ? "" : " readonly"}>
        </div>
        <div class="col-12 col-md-6">
          <label class="form-label" for="field-label">Label</label>
          <input class="form-control form-control-solid" id="field-label" value="${escapeHtml(field.label || "")}">
        </div>
        <div class="col-12 col-md-4">
          <label class="form-label" for="field-type">Type</label>
          <select class="form-select form-select-solid" id="field-type">
            ${SCALAR.map((type) => `<option value="${type}"${field.type === type ? " selected" : ""}>${type}</option>`).join("")}
          </select>
        </div>
        <div class="col-6 col-md-4">
          <label class="form-label" for="field-span">Width</label>
          <select class="form-select form-select-solid" id="field-span">
            ${[4, 6, 8, 12].map((item) => `<option value="${item}"${span === item ? " selected" : ""}>${item}</option>`).join("")}
          </select>
        </div>
        <div class="col-6 col-md-4">
          <label class="form-label" for="field-step">Step</label>
          <select class="form-select form-select-solid" id="field-step">
            ${state.draft.steps.map((step) => `<option value="${escapeHtml(step.id)}"${step.id === stepId ? " selected" : ""}>${escapeHtml(step.title)}</option>`).join("")}
          </select>
        </div>
        <div class="col-12">
          <label class="form-check">
            <input class="form-check-input" type="checkbox" id="field-required"${field.required ? " checked" : ""}>
            <span class="form-check-label">Required when visible</span>
          </label>
        </div>
      </div>
      <p class="text-secondary mt-4 mb-2" id="options-lock"${linked ? "" : " hidden"}>Options come from <strong>${escapeHtml(field.optionsFrom?.field || "")}</strong>.</p>
      <div id="options-wrap"${showOptions ? "" : " hidden"}>
        <label class="form-label" for="field-options">Options</label>
        <textarea class="form-control form-control-solid" id="field-options" rows="4" placeholder="value|Label">${escapeHtml(formatOptions(field.options))}</textarea>
      </div>
      ${ruleBox("vis", "Show this field only when", field.visibleWhen)}
      ${ruleBox("req", "Require this field only when", field.requiredWhen)}`;
  }

  function ruleBox(prefix, legend, rule) {
    const current = rule?.field;
    const ids = Object.entries(state.draft.fields)
      .filter(([id, field]) => id !== state.selectedId && field.type !== "repeater")
      .map(([id]) => id);
    if (current && !ids.includes(current)) ids.unshift(current);
    return `
      <fieldset class="rule-box">
        <label class="form-check">
          <input class="form-check-input" type="checkbox" id="${prefix}-enabled"${rule ? " checked" : ""}>
          <span class="form-check-label">${legend}</span>
        </label>
        <div class="row g-5">
          <div class="col-12 col-md-4">
            <label class="form-label" for="${prefix}-field">Field</label>
            <select class="form-select form-select-solid" id="${prefix}-field">
              ${ids.map((id) => `<option value="${escapeHtml(id)}"${id === current ? " selected" : ""}>${escapeHtml(id)}</option>`).join("")}
            </select>
          </div>
          <div class="col-12 col-md-4">
            <label class="form-label" for="${prefix}-op">Operator</label>
            <select class="form-select form-select-solid" id="${prefix}-op">
              ${OPS.map((op) => `<option value="${op}"${rule?.op === op ? " selected" : ""}>${op}</option>`).join("")}
            </select>
          </div>
          <div class="col-12 col-md-4">
            <label class="form-label" for="${prefix}-value">Value</label>
            <input class="form-control form-control-solid" id="${prefix}-value" value="${escapeHtml(formatRuleValue(rule))}">
          </div>
        </div>
      </fieldset>`;
  }

  function show(message, tone) {
    state.message = message || "";
    state.tone = tone || "success";
    const alert = host.querySelector("#studio-alert");
    if (!alert) return;
    alert.hidden = !state.message;
    alert.textContent = state.message;
    alert.className = `alert alert-${state.tone === "danger" ? "danger" : "success"}`;
  }
}

function parseOptions(text) {
  return String(text || "").split(/\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [raw, ...rest] = line.split("|");
    const value = raw.trim();
    const label = rest.join("|").trim();
    return { value, label: label || value };
  }).filter((option) => option.value);
}

function formatOptions(options) {
  return (options || []).map((option) => `${option.value}|${option.label}`).join("\n");
}

function formatRuleValue(rule) {
  if (!rule || rule.op === "empty" || rule.op === "notEmpty") return "";
  return Array.isArray(rule.value) ? rule.value.join(", ") : String(rule.value ?? "");
}
