import { adminRequest, corsHeaders, getAuthUser, json } from '../_shared/http.ts';

function respond(request: Request, data: unknown, status = 200): Response {
  return json(data, status, corsHeaders(request));
}

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!response.ok) throw new Error('Backend request failed (' + response.status + '): ' + text.slice(0, 250));
  return text ? JSON.parse(text) : null;
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return respond(request, { ok: true });
  if (request.method !== 'POST') return respond(request, { error: 'Method not allowed.' }, 405);

  try {
    const user = await getAuthUser(request);
    if (!user || typeof user.id !== 'string') return respond(request, { error: 'Sign in is required.' }, 401);
    const lastSignInAt = Date.parse(String(user.last_sign_in_at || ''));
    if (!Number.isFinite(lastSignInAt) || Date.now() - lastSignInAt > 5 * 60 * 1000) {
      return respond(request, { error: 'Re-enter your current password before deleting your account.' }, 401);
    }

    const profileResponse = await adminRequest(
      '/rest/v1/client_profiles?id=eq.' + encodeURIComponent(user.id) + '&select=role'
    );
    const profiles = await readJson(profileResponse);
    const profile = profiles && profiles[0];
    if (!profile || !['customer', 'deleted'].includes(profile.role)) {
      return respond(request, { error: 'Only customer accounts can be deleted here.' }, 403);
    }

    const anonymizedResponse = await adminRequest(
      '/rest/v1/rpc/anonymize_client_profile',
      'POST',
      { p_user_id: user.id }
    );
    await readJson(anonymizedResponse);

    const deleteResponse = await adminRequest(
      '/auth/v1/admin/users/' + encodeURIComponent(user.id),
      'DELETE'
    );
    if (!deleteResponse.ok && deleteResponse.status !== 404) {
      const detail = (await deleteResponse.text()).slice(0, 250);
      return respond(request, {
        error: 'Your profile has been anonymized, but account removal did not finish. Retry deletion from the Client Portal or contact FixerCtrl. ' + detail
      }, 502);
    }

    return respond(request, { deleted: true });
  } catch (error) {
    return respond(request, {
      error: error instanceof Error ? error.message : 'Account deletion could not be completed.'
    }, 500);
  }
});
