import assert from "node:assert/strict";
import { handleForms, handleSubmissions } from "../js/server/handlers.js";

const analyst = { "x-tenant-id": "northwind", "x-role": "analyst", "x-user-name": "Ava Chen" };
const admin = { "x-tenant-id": "northwind", "x-role": "tenant-admin", "x-user-name": "Noah Rahman" };
const platform = { "x-tenant-id": "northwind", "x-role": "platform-admin", "x-user-name": "Maya Okonkwo" };

const incident = handleForms({ method: "GET", query: { key: "incident-intake" }, headers: analyst, body: {} }).body.form;
const vendor = handleForms({ method: "GET", query: { key: "vendor-assessment" }, headers: platform, body: {} }).body.form;

let failed = 0;
for (const [name, fn] of tests()) {
  try {
    fn();
    console.log(`ok  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}`);
    console.error(error.stack || error.message);
  }
}
if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}

function tests() {
  return [
    ["analyst cannot save a schema", () => {
      const result = handleForms({ method: "PUT", query: { key: "incident-intake" }, headers: analyst, body: { schema: incident } });
      assert.equal(result.status, 403);
    }],
    ["tenant admin cannot save the global template", () => {
      const result = handleForms({ method: "PUT", query: { key: "vendor-assessment" }, headers: admin, body: { schema: vendor } });
      assert.equal(result.status, 403);
    }],
    ["tenant admin can save the incident schema", () => {
      const result = handleForms({ method: "PUT", query: { key: "incident-intake" }, headers: admin, body: { schema: incident } });
      assert.equal(result.status, 200);
      assert.equal(result.body.schema.key, "incident-intake");
    }],
    ["platform admin can save the global template", () => {
      const result = handleForms({ method: "PUT", query: { key: "vendor-assessment" }, headers: platform, body: { schema: vendor } });
      assert.equal(result.status, 200);
    }],
    ["bad submission returns problem details", () => {
      const result = handleSubmissions({
        method: "POST",
        query: {},
        headers: analyst,
        body: { formKey: "incident-intake", values: { title: "" } }
      });
      assert.equal(result.status, 400);
      assert.equal(result.body.title, "Validation failed");
      assert.ok(result.body.errors.title);
    }],
    ["valid low incident is accepted", () => {
      const result = handleSubmissions({
        method: "POST",
        query: {},
        headers: { ...analyst, "x-tenant-id": "harbor" },
        body: {
          id: "sub_harbor_1",
          formKey: "incident-intake",
          values: {
            title: "Clinic firewall failover",
            severity: "low",
            source: "internal",
            detectedAt: "2026-11-18",
            summary: "The clinic firewall failed over during a planned test window.",
            systems: "Edge firewall",
            notes: ""
          }
        }
      });
      assert.equal(result.status, 200);
      assert.equal(result.body.submission.tenantId, "harbor");
      assert.equal(Object.hasOwn(result.body.submission.values, "vendorName"), false);
    }],
    ["harbor queue hides northwind seed rows", () => {
      const result = handleSubmissions({ method: "GET", query: {}, headers: { ...analyst, "x-tenant-id": "harbor" }, body: {} });
      assert.deepEqual(result.body.submissions, []);
    }],
    ["missing auth is rejected", () => {
      const result = handleForms({ method: "GET", query: {}, headers: {}, body: {} });
      assert.equal(result.status, 400);
    }]
  ];
}
