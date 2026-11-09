import { adminRequest, env, json, safeEqual, sha256 } from '../_shared/http.ts';

async function verifyStripeSignature(payload: string, header: string, secret: string): Promise<boolean> {
  const values = header.split(',').reduce((result, part) => {
    const separator = part.indexOf('=');
    if (separator > 0) result[part.slice(0, separator)] = [...(result[part.slice(0, separator)] || []), part.slice(separator + 1)];
    return result;
  }, {} as Record<string, string[]>);
  const timestamp = Number((values.t || [])[0]);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(timestamp + '.' + payload));
  const expected = Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return (values.v1 || []).some((candidate) => safeEqual(candidate, expected));
}

async function parseResponse(response: Response): Promise<any> {
  const text = await response.text();
  if (!response.ok) throw new Error('Backend request failed (' + response.status + '): ' + text.slice(0, 250));
  return text ? JSON.parse(text) : null;
}

async function getAttempt(id: string, provider: string): Promise<any> {
  const response = await adminRequest('/rest/v1/payment_attempts?id=eq.' + encodeURIComponent(id) + '&provider=eq.' + encodeURIComponent(provider) + '&select=*');
  const rows = await parseResponse(response);
  return rows && rows[0];
}

async function recordPayment(provider: string, eventId: string, attempt: any, amountMinor: number, currency: string, eventType: string, rawPayload: string): Promise<void> {
  const response = await adminRequest('/rest/v1/rpc/record_verified_payment', 'POST', {
    p_provider: provider,
    p_provider_event_id: eventId,
    p_attempt_id: attempt.id,
    p_amount_minor: amountMinor,
    p_currency: currency.toUpperCase(),
    p_event_type: eventType,
    p_payload_hash: await sha256(rawPayload)
  });
  await parseResponse(response);
}

async function handleStripe(request: Request, raw: string): Promise<Response> {
  const signature = request.headers.get('stripe-signature') || '';
  if (!await verifyStripeSignature(raw, signature, env('STRIPE_WEBHOOK_SECRET'))) return json({ error: 'Invalid signature.' }, 400);
  const event = JSON.parse(raw);
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) return json({ received: true });
  const session = event.data && event.data.object;
  if (!session || session.payment_status !== 'paid' || session.mode !== 'payment') return json({ error: 'Payment is not complete.' }, 400);
  const attemptId = String(session.metadata && session.metadata.attempt_id || '');
  if (!/^[0-9a-f-]{36}$/i.test(attemptId)) return json({ error: 'Missing payment reference.' }, 400);
  const attempt = await getAttempt(attemptId, 'stripe');
  if (!attempt || attempt.provider_reference !== session.id) return json({ error: 'Unknown payment attempt.' }, 404);
  if (!Number.isSafeInteger(session.amount_total)) return json({ error: 'Invalid payment amount.' }, 400);
  await recordPayment('stripe', String(event.id), attempt, session.amount_total, String(session.currency || ''), String(event.type), raw);
  return json({ received: true });
}

async function handlePayFast(raw: string): Promise<Response> {
  const form = new URLSearchParams(raw);
  const attemptId = String(form.get('m_payment_id') || '');
  if (!/^[0-9a-f-]{36}$/i.test(attemptId)) return json({ error: 'Missing payment reference.' }, 400);
  const sandbox = Deno.env.get('PAYFAST_SANDBOX') === 'true';
  const validateUrl = Deno.env.get('PAYFAST_VALIDATE_URL') || (sandbox
    ? 'https://sandbox.payfast.co.za/eng/query/validate'
    : 'https://www.payfast.co.za/eng/query/validate');
  const validation = await fetch(validateUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: raw
  });
  if (!validation.ok || (await validation.text()).trim() !== 'VALID') return json({ error: 'PayFast did not validate this notification.' }, 400);
  if (form.get('merchant_id') !== env('PAYFAST_MERCHANT_ID') || form.get('payment_status') !== 'COMPLETE') return json({ error: 'Unconfirmed PayFast transaction.' }, 400);

  const attempt = await getAttempt(attemptId, 'payfast');
  if (!attempt || attempt.provider_reference !== attemptId) return json({ error: 'Unknown payment attempt.' }, 404);
  const amount = Number(form.get('amount_gross'));
  const amountMinor = Math.round(amount * 100);
  if (!Number.isFinite(amount) || !Number.isSafeInteger(amountMinor)) return json({ error: 'Invalid payment amount.' }, 400);
  const eventId = String(form.get('pf_payment_id') || form.get('payment_id') || attemptId + ':' + form.get('payment_status'));
  await recordPayment('payfast', eventId, attempt, amountMinor, 'ZAR', 'payfast.payment.complete', raw);
  return json({ received: true });
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  try {
    const provider = new URL(request.url).searchParams.get('provider');
    const raw = await request.text();
    if (provider === 'stripe') return await handleStripe(request, raw);
    if (provider === 'payfast') return await handlePayFast(raw);
    return json({ error: 'Unsupported provider.' }, 400);
  } catch (error) {
    console.error('payment-webhook failed:', error);
    return json({ error: error instanceof Error ? error.message : 'Webhook processing failed.' }, 500);
  }
});
