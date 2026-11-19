import { getBootstrap } from "../api/client.js";
import { escapeHtml, roleLabel } from "../html.js";
import { setSession } from "../session.js";

const root = document.getElementById("login-root");
load();

async function load() {
  root.innerHTML = `<p class="p-4 text-secondary">Loading sign-in…</p>`;
  try {
    const data = await getBootstrap();
    const tenants = new Map(data.tenants.map((tenant) => [tenant.id, tenant.name]));
    root.innerHTML = `
      <div class="login-wrap">
        <section class="login-hero">
          <div>
            <div class="brand-mark mb-4">SL</div>
            <h1>Configurable forms for security operations.</h1>
            <p class="mb-0">Metadata decides the fields, the rules, and who can change them.</p>
          </div>
          <p class="mb-0">SKY LAKE SOLUTIONS</p>
        </section>
        <section class="login-panel">
          <h2 class="h4 mb-2">Sign in to the demo</h2>
          <p class="text-secondary">Choose a role. There is no password in this reference product.</p>
          <div id="login-users">
            ${data.users.map((user) => `
              <button class="login-card" id="login-${escapeHtml(user.role)}" type="button" data-user="${escapeHtml(user.id)}">
                <strong>${escapeHtml(user.name)}</strong>
                <span>${escapeHtml(roleLabel(user.role))} · ${escapeHtml(tenants.get(user.tenantId) || user.tenantId)}</span>
              </button>`).join("")}
          </div>
        </section>
      </div>`;
    for (const button of root.querySelectorAll("[data-user]")) {
      button.addEventListener("click", () => {
        const user = data.users.find((item) => item.id === button.dataset.user);
        setSession({ id: user.id, name: user.name, role: user.role, tenantId: user.tenantId });
        window.location.assign("/app/dashboard.html");
      });
    }
  } catch (error) {
    root.innerHTML = `<div class="alert alert-danger m-4" role="alert">${escapeHtml(error.message)}</div>`;
  }
}
