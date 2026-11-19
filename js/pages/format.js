export function formatWhen(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value ?? "");
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function statusLabel(submission) {
  if (submission.formKey === "incident-intake") return submission.values?.severity || "filed";
  if ((submission.values?.controls || []).some((row) => row.status === "fail")) return "needs remediation";
  return "passing";
}
