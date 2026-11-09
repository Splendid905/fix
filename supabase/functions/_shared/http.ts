export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
  });
}

export function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get('origin') || '';
  const allowed = (Deno.env.get('PORTAL_ALLOWED_ORIGINS') || '').split(',').map((item) => item.trim()).filter(Boolean);
  return {
    ...(allowed.includes(origin) ? { 'access-control-allow-origin': origin } : {}),
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-max-age': '86400',
    'vary': 'origin'
  };
}

export function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error('Server configuration is missing ' + name + '.');
  return value;
}

export function serviceHeaders(prefer = ''): HeadersInit {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  return {
    apikey: key,
    authorization: 'Bearer ' + key,
    'content-type': 'application/json',
    ...(prefer ? { prefer } : {})
  };
}

export async function adminRequest(path: string, method = 'GET', body?: unknown, prefer = ''): Promise<Response> {
  const url = env('SUPABASE_URL').replace(/\/$/, '') + path;
  return fetch(url, {
    method,
    headers: serviceHeaders(prefer),
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

export async function getAuthUser(request: Request): Promise<Record<string, unknown> | null> {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return null;
  const response = await fetch(env('SUPABASE_URL').replace(/\/$/, '') + '/auth/v1/user', {
    headers: { apikey: env('SUPABASE_ANON_KEY'), authorization }
  });
  if (!response.ok) return null;
  return await response.json();
}

export function safeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let diff = a.length ^ b.length;
  const size = Math.max(a.length, b.length);
  for (let index = 0; index < size; index++) diff |= (a[index] || 0) ^ (b[index] || 0);
  return diff === 0;
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character] || character);
}
