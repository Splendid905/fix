import md5 from 'npm:md5@2.3.0';
import { adminRequest, corsHeaders, env, getAuthUser, json } from '../_shared/http.ts';

function respond(request: Request, data: unknown, status = 200): Response {
  return json(data, status, corsHeaders(request));
}

function asZar(minor: number): string {
  return (minor / 100).toFixed(2);
}

function payfastSignature(fields: Record<string, string>, passphrase: string): string {
  const encoded = Object.keys(fields)
    .filter((key) => fields[key] !== '')
    .map((key) => key + '=' + encodeURIComponent(fields[key].trim()).replace(/%20/g, '+'))
    .join('&');
  const suffix = passphrase ? '&passphrase=' + encodeURIComponent(passphrase.trim()).replace(/%20/g, '+') : '';
  return md5(encoded + suffix);
}

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!response.ok) throw new Error('Backend request failed (' + response.status + '): ' + text.slice(0, 300));
  return text ? JSON.parse(text) : null;
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return respond(request, { ok: true });
  if (request.method !== 'POST') return respond(request, { error: 'Method not allowed.' }, 405);

  try {
    const user = await getAuthUser(request);
    if (!user || typeof user.id !== 'string') return respond(request, { error: 'Sign in is required.' }, 401);

    const input = await request.json();
    const invoiceId = String(input.invoice_id || '');
    const provider = String(input.provider || '');
    if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) return respond(request, { error: 'Invalid invoice.' }, 400);
    if (!['payfast', 'stripe', 'eft'].includes(provider)) return respond(request, { error: 'Unsupported payment method.' }, 400);

    const invoiceQuery = '/rest/v1/invoices?id=eq.' + encodeURIComponent(invoiceId) + '&select=*,projects!inner(customer_id,title,reference)';
    const invoiceResponse = await adminRequest(invoiceQuery);
    const invoices = await readJson(invoiceResponse);
    const invoice = invoices && invoices[0];
    if (!invoice) return respond(request, { error: 'Invoice not found.' }, 404);

    const profileResponse = await adminRequest('/rest/v1/client_profiles?id=eq.' + encodeURIComponent(String(user.id)) + '&select=role');
    const profiles = await readJson(profileResponse);
    const isOwner = profiles && profiles[0] && profiles[0].role === 'owner';
    if (!isOwner && invoice.projects.customer_id !== user.id) return respond(request, { error: 'Invoice not found.' }, 404);
    if (!['scheduled', 'sent', 'overdue'].includes(invoice.status)) return respond(request, { error: 'This invoice is not payable.' }, 409);
    if (invoice.status === 'scheduled' && new Date(invoice.email_send_at).getTime() > Date.now()) {
      return respond(request, { error: 'Payment opens when the invoice is sent on ' + invoice.email_send_at + '.' }, 409);
    }

    const recentCutoff = encodeURIComponent(new Date(Date.now() - 10 * 60 * 1000).toISOString());
    const recentResponse = await adminRequest('/rest/v1/payment_attempts?invoice_id=eq.' + encodeURIComponent(invoice.id) + '&created_at=gt.' + recentCutoff + '&select=id');
    const recentAttempts = await readJson(recentResponse);
    if (recentAttempts.length >= 5) return respond(request, { error: 'Too many checkout attempts. Please wait a few minutes or contact FixerCtrl.' }, 429);

    const providerResponse = await adminRequest('/rest/v1/payment_providers?provider=eq.' + encodeURIComponent(provider) + '&is_enabled=eq.true&select=provider,label,public_instructions');
    const providers = await readJson(providerResponse);
    const selectedProvider = providers && providers[0];
    if (!selectedProvider) return respond(request, { error: 'This payment method is not currently available.' }, 409);
    if (provider === 'eft') return respond(request, { manual: true, instructions: selectedProvider.public_instructions, reference: invoice.invoice_number });

    const attemptId = crypto.randomUUID();
    const insertResponse = await adminRequest('/rest/v1/payment_attempts', 'POST', {
      id: attemptId,
      invoice_id: invoice.id,
      provider,
      status: 'created',
      amount_minor: invoice.amount_minor,
      currency: invoice.currency,
      idempotency_key: crypto.randomUUID()
    }, 'return=representation');
    await readJson(insertResponse);

    const siteUrl = env('PORTAL_SITE_URL').replace(/\/$/, '');
    if (provider === 'stripe') {
      const params = new URLSearchParams();
      params.set('mode', 'payment');
      params.set('success_url', siteUrl + '/?payment=success&invoice=' + encodeURIComponent(invoice.id) + '#/client-desk');
      params.set('cancel_url', siteUrl + '/?payment=cancelled&invoice=' + encodeURIComponent(invoice.id) + '#/client-desk');
      params.set('customer_email', String(user.email || ''));
      params.set('client_reference_id', attemptId);
      params.set('metadata[invoice_id]', invoice.id);
      params.set('metadata[attempt_id]', attemptId);
      params.set('line_items[0][quantity]', '1');
      params.set('line_items[0][price_data][currency]', String(invoice.currency).toLowerCase());
      params.set('line_items[0][price_data][unit_amount]', String(invoice.amount_minor));
      params.set('line_items[0][price_data][product_data][name]', 'FixerCtrl ' + invoice.invoice_number);
      params.set('line_items[0][price_data][product_data][description]', String(invoice.description || invoice.projects.title).slice(0, 300));
      const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + env('STRIPE_SECRET_KEY'),
          'content-type': 'application/x-www-form-urlencoded',
          'idempotency-key': attemptId
        },
        body: params
      });
      const session = await stripeResponse.json();
      if (!stripeResponse.ok || !session.url) throw new Error('Stripe could not start checkout.');
      await adminRequest('/rest/v1/payment_attempts?id=eq.' + attemptId, 'PATCH', {
        provider_reference: session.id,
        checkout_url: session.url,
        status: 'pending'
      });
      return respond(request, { provider, checkout_url: session.url });
    }

    const merchantId = env('PAYFAST_MERCHANT_ID');
    const sandbox = Deno.env.get('PAYFAST_SANDBOX') === 'true';
    const fields: Record<string, string> = {
      merchant_id: merchantId,
      merchant_key: env('PAYFAST_MERCHANT_KEY'),
      return_url: siteUrl + '/?payment=success&invoice=' + encodeURIComponent(invoice.id) + '#/client-desk',
      cancel_url: siteUrl + '/?payment=cancelled&invoice=' + encodeURIComponent(invoice.id) + '#/client-desk',
      notify_url: env('SUPABASE_URL').replace(/\/$/, '') + '/functions/v1/payment-webhook?provider=payfast',
      email_address: String(user.email || ''),
      m_payment_id: attemptId,
      amount: asZar(invoice.amount_minor),
      item_name: String(invoice.invoice_number).slice(0, 100),
      item_description: String(invoice.description || invoice.projects.title).slice(0, 255)
    };
    const passphrase = Deno.env.get('PAYFAST_PASSPHRASE') || '';
    fields.signature = payfastSignature(fields, passphrase);
    await adminRequest('/rest/v1/payment_attempts?id=eq.' + attemptId, 'PATCH', { provider_reference: attemptId, status: 'pending' });
    return respond(request, {
      provider,
      form_url: sandbox ? 'https://sandbox.payfast.co.za/eng/process' : 'https://www.payfast.co.za/eng/process',
      form_fields: fields
    });
  } catch (error) {
    console.error('create-payment failed:', error);
    return respond(request, { error: error instanceof Error ? error.message : 'Payment could not be started.' }, 500);
  }
});
