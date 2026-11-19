export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function roleLabel(role) {
  if (role === "tenant-admin") return "Tenant Admin";
  if (role === "platform-admin") return "Platform Admin";
  if (role === "analyst") return "Analyst";
  return role || "User";
}
