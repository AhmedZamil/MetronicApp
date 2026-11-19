import { getBootstrap } from "./api/client.js";
import { escapeHtml, roleLabel } from "./html.js";
import { clearSession, requireSession, setSession } from "./session.js";

const LINKS = [
  { href: "/app/dashboard.html", id: "dashboard", label: "Dashboard", icon: "speedometer2" },
  { href: "/app/forms.html", id: "forms", label: "Forms", icon: "ui-checks" },
  { href: "/app/submissions.html", id: "submissions", label: "Submissions", icon: "inboxes" },
  { href: "/app/studio.html", id: "studio", label: "Schema studio", icon: "sliders", roles: ["tenant-admin", "platform-admin"] }
];

export function mountShell({ active, allow }) {
  const session = requireSession();
  if (!session) return null;
  if (allow && !allow.includes(session.role)) {
    window.location.replace("/app/dashboard.html");
    return null;
  }
  const links = LINKS.filter((link) => !link.roles || link.roles.includes(session.role))
    .map((link) => `
      <a class="menu-link${link.id === active ? " active" : ""}" href="${link.href}">
        <i class="bi bi-${link.icon}" aria-hidden="true"></i>
        <span class="menu-title">${link.label}</span>
      </a>`)
    .join("");

  document.getElementById("sl-app").innerHTML = `
    <div class="app-shell">
      <aside class="app-sidebar" id="app-sidebar">
        <div class="sidebar-brand">
          <span class="brand-mark">SL</span>
          <span>
            <strong>SkyLake</strong>
            <small>Control Forms</small>
          </span>
        </div>
        <nav class="menu" aria-label="Primary">${links}</nav>
        <div class="sidebar-foot">SKY LAKE SOLUTIONS</div>
      </aside>
      <div class="sidebar-backdrop" id="sidebar-backdrop"></div>
      <div class="app-main">
        <header class="app-header">
          <div class="header-start">
            <button class="btn btn-light btn-icon" id="nav-toggle" type="button" aria-label="Open menu">
              <i class="bi bi-list"></i>
            </button>
            <div class="header-product">SkyLake Control Forms</div>
          </div>
          <div class="header-end">
            <label class="tenant-switch" for="sl-tenant">Tenant
              <select id="sl-tenant" class="form-select form-select-solid form-select-sm"></select>
            </label>
            <div class="user-chip">
              <strong>${escapeHtml(session.name)}</strong>
              <span>${escapeHtml(roleLabel(session.role))}</span>
            </div>
            <button class="btn btn-light" id="sign-out" type="button">Sign out</button>
          </div>
        </header>
        <main class="app-content" id="sl-content"></main>
      </div>
    </div>`;

  document.getElementById("sign-out").addEventListener("click", () => {
    clearSession();
    window.location.assign("/");
  });
  document.getElementById("nav-toggle").addEventListener("click", () => setSidebar(true));
  document.getElementById("sidebar-backdrop").addEventListener("click", () => setSidebar(false));
  document.querySelectorAll(".menu-link").forEach((link) => {
    link.addEventListener("click", () => setSidebar(false));
  });
  loadTenants(session);
  return session;
}

function setSidebar(open) {
  document.getElementById("app-sidebar").classList.toggle("is-open", open);
  document.getElementById("sidebar-backdrop").classList.toggle("is-open", open);
}

async function loadTenants(session) {
  const select = document.getElementById("sl-tenant");
  if (!select) return;
  try {
    const data = await getBootstrap();
    const tenants = session.role === "platform-admin"
      ? data.tenants
      : data.tenants.filter((tenant) => tenant.id === session.tenantId);
    select.innerHTML = tenants
      .map((tenant) => `<option value="${escapeHtml(tenant.id)}"${tenant.id === session.tenantId ? " selected" : ""}>${escapeHtml(tenant.name)}</option>`)
      .join("");
    select.disabled = session.role !== "platform-admin";
    select.addEventListener("change", () => {
      if (session.role !== "platform-admin") return;
      setSession({ ...session, tenantId: select.value });
      window.location.reload();
    });
  } catch (error) {
    select.innerHTML = `<option value="${escapeHtml(session.tenantId)}">${escapeHtml(session.tenantId)}</option>`;
    select.disabled = true;
    const content = document.getElementById("sl-content");
    if (content && !content.childElementCount) {
      content.innerHTML = `<div class="alert alert-danger" role="alert">${escapeHtml(error.message)}</div>`;
    }
  }
}
