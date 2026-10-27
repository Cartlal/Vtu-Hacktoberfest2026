const TOKEN_KEY = 'toc_token';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage blocked (private mode): the session just won't persist
  }
}

// Same-origin /api in both dev (Vite proxy) and production (Express serves the app).
// `body` may be a plain object (sent as JSON) or FormData (file uploads).
export async function api(path, { method = 'GET', body } = {}) {
  const token = getToken();
  const isForm = body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Fetches a protected file (ticket screenshot) as an object URL; <img> tags
// can't send the Authorization header themselves.
export async function apiBlobUrl(path) {
  const token = getToken();
  const res = await fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`Could not load file (${res.status})`);
  return URL.createObjectURL(await res.blob());
}
