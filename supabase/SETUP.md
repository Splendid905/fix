# Client Desk Deployment Setup

The Client Desk is prepared in the static site and Supabase project files. It does not process real customer data or payments until the setup below is complete. The public Supabase anon key is intended for browser use; the service role key, payment secrets, email API key, and invoice dispatch secret are server-only secrets.

## 1. Create Supabase Project

1. Create a Supabase project in a region appropriate for the business and customer data.
2. Apply `migrations/202611080001_client_desk.sql`, `migrations/202611090001_client_desk_team.sql`, then `migrations/202611090002_customer_profile_deletion.sql`, using the Supabase CLI or SQL editor. Review the migrations in a non-production project first.
3. Enable email-and-password sign-in in Supabase Auth, disable public signups, and configure Auth rate limits. The Client Desk supports sign-in only; it does not create accounts or provide password reset.
4. Provision customer accounts through a trusted administrative process and securely provide their initial credentials. Existing magic-link accounts need a password set before they can use the Client Desk password sign-in.
5. Create your account in Supabase Auth with a password. Sign in at the site's **Client Desk** using that email and password. To enable the admin dashboard, promote that verified account in the Supabase SQL editor:

   ```sql
   update public.client_profiles
   set role = 'owner'
   where email = 'the-verified-owner-address@example.com';
   ```

   The database role is `owner`; the dashboard labels it **Admin**. The account must already exist in `auth.users` so the profile trigger has created its `client_profiles` row. Never expose an owner-role control to customers.

6. To onboard a freelancer, first create/invite their Auth account in Supabase, then sign in to the Client Desk as Admin. Under **Freelancer accounts**, change their portal access from Customer to Freelancer. Assign them to individual projects under each project's **Project team** controls. Freelancers only see assigned projects and can post client-visible status/next-step updates, messages, and files; they cannot access invoices, quotes, payment settings, private notes, or unassigned projects. Changing a freelancer back to Customer removes their project assignments.

Saving a project status or next step automatically adds a dated event to the project timeline. Clients see these updates in their dashboard when they open or refresh the Client Desk; progress changes do not send a separate email or require a message.

Customers can request account deletion from the **Delete my Client Desk account** section in their dashboard by re-entering their current password. The server removes the Auth login and anonymizes the profile. Project history, messages, shared files, quotes, and invoices are retained without the customer's name or email. If Auth removal fails after anonymization, portal access stays disabled and the customer can sign in to retry or contact FixerCtrl. The account deletion Edge Function must be deployed for this action to work.

## 2. Configure Public Site Settings

Set `supabaseUrl` and the public `supabaseAnonKey` in `client-desk-config.js`. This file is deployed publicly. The anon key is safe to expose only because the migration enables Row Level Security and grants restricted operations; do not put a service role key here.

The site Content Security Policy permits Supabase connections and the Supabase JS CDN. The SDK URL is pinned to a version and integrity hash in the portal script; update both only after verifying the package release and recomputing SRI. Keep the allowed origins narrow. Set `PORTAL_ALLOWED_ORIGINS` to the exact production origin and any local preview origin, without wildcards, for example `https://splendid905.github.io,http://localhost:4173`.

## 3. Deploy Edge Functions

Deploy the functions from the repository root using the Supabase CLI. `create-payment` and `delete-client-profile` require a signed-in user. `payment-webhook` and `dispatch-invoices` are configured without gateway JWT verification because they perform their own provider-signature or secret-token validation.

Required server secrets:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PORTAL_SITE_URL` (the site base path, such as `https://splendid905.github.io/fix`)
- `PORTAL_ALLOWED_ORIGINS`
- `RESEND_API_KEY`
- `EMAIL_FROM` (a sender on a verified domain)
- `INVOICE_DISPATCH_SECRET` (a unique random secret, used only by the scheduler)

Set these through Supabase's protected function-secret configuration or an approved secret manager. Do not commit them, place them in GitHub Pages configuration, or paste them into chat.

## 4. Configure Scheduled Email

The `dispatch-invoices` function claims due jobs and sends invoice and message-notification emails. Configure a trusted scheduler, such as Supabase Cron with an HTTP invocation, to POST to:

`https://<project-ref>.supabase.co/functions/v1/dispatch-invoices`

Run it every 5 to 15 minutes. Send this header using the protected scheduler secret:

`Authorization: Bearer <INVOICE_DISPATCH_SECRET>`

The function only claims invoices that have been accepted, are scheduled/sent/overdue, and have reached `email_send_at`. Jobs are claimed with database locks, retried with backoff, and capped at five attempts. Monitor failed jobs and email-provider delivery events; the dashboard must not describe a queued email as delivered.

Invoice email contains the invoice number, amount, due date, and an authenticated Client Desk link. It does not attach a PDF in this first release. Customers see the full quote, invoice schedule, status, and payment options after signing in.

## 5. Configure Payment Providers

Keep the provider rows disabled until the matching credentials and webhooks have been tested. Enable multiple providers only when each one has a working server configuration.

### PayFast

Configure the PayFast integration values in Supabase Function secrets:

- `PAYFAST_MERCHANT_ID`
- `PAYFAST_MERCHANT_KEY` (PayFast requires this value in its hosted-checkout form; it is returned to the browser as a provider form field and must not be reused as an authentication secret)
- `PAYFAST_PASSPHRASE` (if enabled on the merchant account; this remains server-only and is used only to calculate the signature)
- `PAYFAST_SANDBOX` (`true` for sandbox; omit or set `false` for production)

The hosted checkout form is generated server-side and includes a signature. The payment notification is sent to `payment-webhook?provider=payfast`, validated directly with PayFast, and checked against the exact invoice amount and currency before the database marks it paid. Test both successful, cancelled, and invalid notifications in sandbox before enabling production.

### Stripe

Configure `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` as server-only secrets. Register `https://<project-ref>.supabase.co/functions/v1/payment-webhook?provider=stripe` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, and `checkout.session.expired`. The endpoint validates the timestamped Stripe signature and checks the attempt, amount, currency, and paid state; sessions expire after 45 minutes. Test successful checkout, cancellation, expiry, duplicate webhook delivery, and failed/async payment cases before enabling the provider.

### Manual EFT

Enable EFT only after adding the correct public transfer instructions in the Admin dashboard. Customers should see the invoice reference and instructions. FixerCtrl must verify receipt in the bank account before using the admin-only reconciliation action. Never ask a customer to provide card details or banking passwords.

Payment success/cancel redirects are informational only. The verified server webhook is the source of truth. No progress status change triggers a charge; every quote total and milestone schedule must be explicitly accepted.

## 6. Production Readiness Checks

Before using this with real customers:

- Confirm the Terms and privacy page is no longer a draft and has complete operator disclosures and reviewed payment, cancellation, refund, tax, and privacy terms.
- Verify that customer A cannot read customer B's profiles, project rows, messages, invoices, checklist, or files by calling the Supabase API directly.
- Verify that only the admin can see internal notes, internal checklist items, internal attachments, and billing controls; a freelancer can see only assigned projects and non-internal files/messages.
- Test account deletion with no projects and with a full project, quote, invoice, message, and file history. Verify login removal, anonymized retained records, blocked access through an existing session, and no further notifications to the old email.
- Test signed file links expire and unsupported/oversized files are rejected.
- Test quote acceptance is customer-owned, unexpired, and bound to a milestone schedule whose sum exactly matches the quote total.
- Test a payment callback with a wrong amount/currency, invalid signature, duplicate event, and unknown invoice. All must leave the invoice unpaid.
- Test the scheduler's wrong-token response, retries, duplicate invocations, and delayed invoice send time.
- Verify the production build includes `client-desk.css`, `client-desk.js`, `client-desk-config.js`, and `assets/`.
- Use sandbox/test merchant accounts until these checks pass. The local static preview cannot validate real provider webhooks, auth email delivery, cron scheduling, or RLS isolation.
- The original Client Desk migration was syntax-applied and basic customer/owner role-isolation checks were run in a temporary PostgreSQL 16 instance with mocked Supabase schemas. The freelancer-team and account-deletion migrations and their new role boundaries still need equivalent checks in a disposable database and a real non-production Supabase project before launch; mocks do not verify Supabase Auth, Storage, Edge gateway, or provider behavior.

The implementation is a deployment foundation, not a claim that the system is secure by all means or legally ready. Security requires correct account configuration, ongoing monitoring, testing, backups, and timely updates.
