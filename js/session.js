const KEY = "sl.session";

export function getSession() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session?.id || !session.name || !session.role || !session.tenantId) return null;
    return session;
  } catch {
    return null;
  }
}

export function setSession(session) {
  sessionStorage.setItem(KEY, JSON.stringify(session));
}

export function clearSession() {
  sessionStorage.removeItem(KEY);
}

export function requireSession() {
  const session = getSession();
  if (!session) {
    window.location.replace("/");
    return null;
  }
  return session;
}
