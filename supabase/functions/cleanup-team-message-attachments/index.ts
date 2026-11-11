import { adminRequest, env, json, safeEqual, serviceHeaders } from '../_shared/http.ts';

type Attachment = { id: string; storage_path: string };

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) throw new Error('Backend request failed (' + response.status + '): ' + text.slice(0, 250));
  return text ? JSON.parse(text) as T : [] as T;
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const expected = 'Bearer ' + env('TEAM_ATTACHMENT_CLEANUP_SECRET');
  if (!safeEqual(request.headers.get('authorization') || '', expected)) return json({ error: 'Unauthorized.' }, 401);

  try {
    const now = new Date().toISOString();
    const expiredResponse = await adminRequest(
      '/rest/v1/team_message_attachments?expires_at=lt.' + encodeURIComponent(now) + '&select=id,storage_path&limit=500'
    );
    const expired = await readJson<Attachment[]>(expiredResponse);
    let deleted = 0;
    const failures: string[] = [];

    for (const attachment of expired) {
      try {
        const objectPath = attachment.storage_path.split('/').map(encodeURIComponent).join('/');
        const removeObject = await fetch(
          env('SUPABASE_URL').replace(/\/$/, '') + '/storage/v1/object/team-message-attachments/' + objectPath,
          { method: 'DELETE', headers: serviceHeaders() }
        );
        if (!removeObject.ok && removeObject.status !== 404) {
          throw new Error('Storage returned ' + removeObject.status + '.');
        }
        const removeRecord = await adminRequest(
          '/rest/v1/team_message_attachments?id=eq.' + encodeURIComponent(attachment.id),
          'DELETE'
        );
        if (!removeRecord.ok) throw new Error('The expired attachment record could not be removed.');
        deleted++;
      } catch (error) {
        failures.push(attachment.id + ': ' + (error instanceof Error ? error.message : 'Cleanup failed.'));
      }
    }

    return json({ scanned: expired.length, deleted, failures });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Attachment cleanup failed.' }, 500);
  }
});
