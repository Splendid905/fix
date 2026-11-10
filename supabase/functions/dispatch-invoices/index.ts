import { adminRequest, env, escapeHtml, json, safeEqual } from '../_shared/http.ts';

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!response.ok) throw new Error('Backend request failed (' + response.status + '): ' + text.slice(0, 250));
  return text ? JSON.parse(text) : null;
}

async function sendEmail(to: string, subject: string, html: string, text: string, idempotencyKey: string): Promise<void> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + env('RESEND_API_KEY'),
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey
    },
    body: JSON.stringify({ from: env('EMAIL_FROM'), to: [to], subject, html, text })
  });
  if (!response.ok) throw new Error('Email provider returned ' + response.status + ': ' + (await response.text()).slice(0, 300));
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const expected = 'Bearer ' + env('INVOICE_DISPATCH_SECRET');
  if (!safeEqual(request.headers.get('authorization') || '', expected)) return json({ error: 'Unauthorized.' }, 401);

  try {
    const claimedResponse = await adminRequest('/rest/v1/rpc/claim_due_invoices', 'POST', { p_limit: 25 });
    const invoices = await readJson(claimedResponse) || [];
    const siteUrl = env('PORTAL_SITE_URL').replace(/\/$/, '');
    const results: Array<{ invoice: string; sent: boolean }> = [];

    for (const invoice of invoices) {
      try {
        const projectResponse = await adminRequest('/rest/v1/projects?id=eq.' + encodeURIComponent(invoice.project_id) + '&select=id,title,reference,customer_id');
        const projects = await readJson(projectResponse);
        const project = projects && projects[0];
        if (!project) throw new Error('Project record not found.');

        const userResponse = await adminRequest('/auth/v1/admin/users/' + encodeURIComponent(project.customer_id));
        const customer = await readJson(userResponse);
        if (!customer || !customer.email) throw new Error('Customer email is unavailable.');

        const amount = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: invoice.currency || 'ZAR' }).format(invoice.amount_minor / 100);
        const dueDate = new Intl.DateTimeFormat('en-ZA', { dateStyle: 'long', timeZone: 'Africa/Johannesburg' }).format(new Date(invoice.due_at));
        const invoiceUrl = siteUrl + '/#/client-desk';
        const number = escapeHtml(invoice.invoice_number);
        const title = escapeHtml(project.title);
        const due = escapeHtml(dueDate);
        const safeAmount = escapeHtml(amount);
        const html = '<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;color:#151515"><p style="font:600 12px monospace;letter-spacing:1px;color:#087fbe">FIXERCTRL / CLIENT PORTAL</p><h1 style="font-size:24px">Invoice ' + number + '</h1><p>Invoice for <strong>' + title + '</strong>.</p><table style="width:100%;border-collapse:collapse;margin:24px 0"><tr><td style="padding:12px;border-bottom:1px solid #ddd">Amount due</td><td style="padding:12px;border-bottom:1px solid #ddd;text-align:right"><strong>' + safeAmount + '</strong></td></tr><tr><td style="padding:12px;border-bottom:1px solid #ddd">Due date</td><td style="padding:12px;border-bottom:1px solid #ddd;text-align:right">' + due + '</td></tr></table><p>Review the agreed scope, invoice status, and available payment methods in your private workspace.</p><p><a href="' + escapeHtml(invoiceUrl) + '" style="display:inline-block;padding:12px 18px;background:#1d9bf0;color:#101010;text-decoration:none;font-weight:bold">Open Client Portal</a></p><p style="font-size:12px;color:#555">Do not send card details by email. Payments are processed by the provider selected in your workspace.</p></div>';
        const text = 'FixerCtrl invoice ' + invoice.invoice_number + '\nProject: ' + project.title + '\nAmount due: ' + amount + '\nDue date: ' + dueDate + '\nReview and pay in your private workspace: ' + invoiceUrl + '\nDo not send card details by email.';
        await sendEmail(customer.email, 'FixerCtrl invoice ' + invoice.invoice_number, html, text, 'invoice-' + invoice.id);

        const status = new Date(invoice.due_at).getTime() < Date.now() ? 'overdue' : 'sent';
        const updateResponse = await adminRequest('/rest/v1/invoices?id=eq.' + encodeURIComponent(invoice.id), 'PATCH', {
          status,
          email_state: 'sent',
          email_last_error: null,
          email_retry_at: null
        });
        if (!updateResponse.ok) throw new Error('Invoice email status could not be saved.');
        results.push({ invoice: invoice.invoice_number, sent: true });
      } catch (error) {
        const attempts = Number(invoice.email_attempts || 1);
        const retryHours = Math.min(24, Math.pow(2, Math.max(0, attempts - 1)));
        await adminRequest('/rest/v1/invoices?id=eq.' + encodeURIComponent(invoice.id), 'PATCH', {
          email_state: attempts >= 5 ? 'failed' : 'retry',
          email_last_error: String(error instanceof Error ? error.message : 'Email delivery failed.').slice(0, 1000),
          email_retry_at: attempts >= 5 ? null : new Date(Date.now() + retryHours * 60 * 60 * 1000).toISOString()
        });
        results.push({ invoice: invoice.invoice_number, sent: false });
      }
    }

    const noticeResponse = await adminRequest('/rest/v1/rpc/claim_due_message_notifications', 'POST', { p_limit: 50 });
    const notices = await readJson(noticeResponse) || [];
    const noticeResults: Array<{ id: string; sent: boolean }> = [];
    for (const notice of notices) {
      try {
        const projectResponse = await adminRequest('/rest/v1/projects?id=eq.' + encodeURIComponent(notice.project_id) + '&select=title,reference');
        const projects = await readJson(projectResponse);
        const project = projects && projects[0];
        if (!project) throw new Error('Project record not found.');
        const link = siteUrl + '/#/client-desk';
        const title = escapeHtml(project.title);
        const reference = escapeHtml(project.reference);
        const safeLink = escapeHtml(link);
        await sendEmail(
          notice.recipient_email,
          'New FixerCtrl project update / ' + project.reference,
          '<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;color:#151515"><p style="font:600 12px monospace;letter-spacing:1px;color:#087fbe">FIXERCTRL / CLIENT PORTAL</p><h1 style="font-size:24px">New project update</h1><p>There is a new message in <strong>' + title + '</strong> (' + reference + '). Sign in to read and reply.</p><p><a href="' + safeLink + '" style="display:inline-block;padding:12px 18px;background:#1d9bf0;color:#101010;text-decoration:none;font-weight:bold">Open Client Portal</a></p><p style="font-size:12px;color:#555">For privacy, message contents are not included in this email.</p></div>',
          'There is a new message in FixerCtrl project ' + project.reference + '. Sign in to read and reply: ' + link,
          'message-' + notice.id
        );
        const sentResponse = await adminRequest('/rest/v1/message_notification_jobs?id=eq.' + encodeURIComponent(notice.id), 'PATCH', { status: 'sent', last_error: null, retry_at: null });
        if (!sentResponse.ok) throw new Error('Notification status could not be saved.');
        noticeResults.push({ id: notice.id, sent: true });
      } catch (error) {
        const attempts = Number(notice.attempts || 1);
        const retryHours = Math.min(24, Math.pow(2, Math.max(0, attempts - 1)));
        await adminRequest('/rest/v1/message_notification_jobs?id=eq.' + encodeURIComponent(notice.id), 'PATCH', {
          status: attempts >= 5 ? 'failed' : 'retry',
          last_error: String(error instanceof Error ? error.message : 'Notification delivery failed.').slice(0, 1000),
          retry_at: attempts >= 5 ? null : new Date(Date.now() + retryHours * 60 * 60 * 1000).toISOString()
        });
        noticeResults.push({ id: notice.id, sent: false });
      }
    }

    return json({
      invoices: { processed: results.length, sent: results.filter((result) => result.sent).length, failed: results.filter((result) => !result.sent).length },
      notifications: { processed: noticeResults.length, sent: noticeResults.filter((result) => result.sent).length, failed: noticeResults.filter((result) => !result.sent).length }
    });
  } catch (error) {
    console.error('dispatch-invoices failed:', error);
    return json({ error: error instanceof Error ? error.message : 'Invoice dispatch failed.' }, 500);
  }
});
