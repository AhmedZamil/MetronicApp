import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isVisible, resolveOptions, syncValues } from "../js/engine/rules.js";
import { fieldIdsInStep, toPayload, validate } from "../js/engine/validate.js";
import {
  addField,
  canEditSchema,
  formsForTenant,
  removeField,
  submissionsForTenant,
  validateSchemaShape
} from "../js/engine/schema.js";

const seed = JSON.parse(readFileSync(new URL("../data/seed.json", import.meta.url), "utf8"));
const cases = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url), "utf8"));

function formByKey(key) {
  const form = seed.forms.find((item) => item.key === key);
  if (!form) throw new Error(`Missing form ${key}`);
  return structuredClone(form);
}

function schemaFor(entry) {
  if (entry.schemaInline) return structuredClone(entry.schemaInline);
  const schema = formByKey(entry.schema);
  if (entry.mutateSpan) {
    for (const step of schema.steps) {
      for (const section of step.sections) {
        for (const row of section.rows) {
          for (const col of row.cols) if (col.field === entry.mutateSpan) col.span = 5;
        }
      }
    }
  }
  return schema;
}

function assertErrors(actual, expect) {
  if (expect.errors) assert.deepEqual(actual, expect.errors);
  if (expect.errorKeys) {
    assert.deepEqual(Object.keys(actual).sort(), [...expect.errorKeys].sort());
  }
}

let failed = 0;
for (const entry of cases) {
  try {
    run(entry);
    console.log(`ok  ${entry.name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${entry.name}`);
    console.error(error.stack || error.message);
  }
}

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log(`${cases.length} passed`);

function run(entry) {
  const fn = entry.fn || "rules";
  if (fn === "access") {
    assert.equal(canEditSchema(entry.role, formByKey(entry.schema)), entry.expect);
    return;
  }
  if (fn === "filter") {
    if (entry.kind === "submissions") {
      const ids = submissionsForTenant(seed.submissions, entry.tenantId).map((item) => item.id);
      assert.deepEqual(ids, entry.expectIds);
    } else {
      const keys = formsForTenant(seed.forms, entry.tenantId).map((item) => item.key);
      assert.deepEqual(keys, entry.expectKeys);
    }
    return;
  }
  if (fn === "shape") {
    const errors = validateSchemaShape(schemaFor(entry));
    assert.equal(errors.length === 0, entry.expectValid);
    if (entry.expectErrorIncludes) assert.ok(errors.some((item) => item.includes(entry.expectErrorIncludes)));
    return;
  }
  if (fn === "remove") {
    const schema = formByKey(entry.schema);
    const result = removeField(schema, entry.field);
    assert.equal(result.ok, entry.expectOk);
    if (!entry.expectOk) assert.ok(result.refs.length > 0);
    if (entry.expectOk) assert.equal(validateSchemaShape(schema).length, 0);
    return;
  }
  if (fn === "add") {
    const schema = formByKey(entry.schema);
    const result = addField(schema, entry.spec);
    assert.equal(result.ok, entry.expectOk);
    if (entry.expectOk) assert.deepEqual(validateSchemaShape(schema), []);
    return;
  }
  if (fn === "seedValid") {
    const submission = seed.submissions.find((item) => item.id === entry.id);
    const schema = formByKey(submission.formKey);
    assert.deepEqual(validate(schema, submission.values), {});
    return;
  }
  const schema = schemaFor(entry);
  if (fn === "prepared") {
    const prepared = syncValues(schema, entry.values);
    for (const [key, value] of Object.entries(entry.expect.prepared)) assert.equal(prepared[key], value);
    return;
  }
  if (fn === "options") {
    const values = syncValues(schema, entry.values);
    const options = resolveOptions(schema.fields[entry.field], values, schema.fields).map((item) => item.value);
    assert.deepEqual(options, entry.expect.optionValues);
    return;
  }
  const values = entry.values || {};
  if (entry.expect?.visible) {
    for (const [id, visible] of Object.entries(entry.expect.visible)) {
      assert.equal(isVisible(schema.fields[id], values, schema.fields), visible, id);
    }
  }
  if (entry.expect?.prepared) {
    const prepared = syncValues(schema, values);
    for (const [key, value] of Object.entries(entry.expect.prepared)) assert.equal(prepared[key], value);
  }
  if (entry.expect?.errors || entry.expect?.errorKeys) {
    const only = entry.only || (entry.step ? fieldIdsInStep(schema, entry.step) : null);
    assertErrors(validate(schema, values, only), entry.expect);
  }
  if (entry.expect?.payloadOmits) {
    const payload = toPayload(schema, values);
    for (const key of entry.expect.payloadOmits) assert.equal(Object.hasOwn(payload, key), false, key);
  }
}
