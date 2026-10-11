// Client for the Waymark server API.

export class ApiError extends Error {
  constructor(status, body) { super(body?.error || `Request failed (${status})`); this.status = status; this.body = body; }
}

export async function api(method, url, body, { raw = false, headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: {
      'X-Waymark': '1',
      ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

/** Returns the signed-in user, or sends the browser to the sign-in page. */
export async function requireUser() {
  const { user } = await api('GET', '/api/me');
  if (!user) {
    location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
    return new Promise(() => {}); // never resolves; we're navigating away
  }
  return user;
}

export const signOut = () => api('POST', '/api/auth/logout').then(() => { location.href = '/login.html'; });

/* ---------- Image uploads ---------- */

const MAX_EDGE = 2400;

// Re-encode in the browser before upload: shrinks big photos and strips EXIF metadata (including GPS).
async function prepareImage(file) {
  if (file.type === 'image/gif') return file; // keep animation
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = (await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.85)));
  if (blob && blob.type === 'image/webp') return blob;
  return new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.88));
}

export async function uploadImage(file) {
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error('Choose a JPEG, PNG, WebP or GIF image');
  const body = await prepareImage(file);
  return api('POST', '/api/uploads', body, { raw: true, headers: { 'Content-Type': body.type, 'X-Filename': encodeURIComponent(file.name) } });
}
