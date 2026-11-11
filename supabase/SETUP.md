# Client Portal Deployment Setup

The Client Portal is prepared in the static site and Supabase project files. It does not process real customer data or payments until the setup below is complete. The public Supabase anon key is intended for browser use; the service role key, payment secrets, email API key, and invoice dispatch secret are server-only secrets.

## 1. Create Supabase Project

1. Create a Supabase project in a region appropriate for the business and customer data.
2. Apply `migrations/202611080001_client_desk.sql`, `migrations/202611090001_client_desk_team.sql`, `migrations/202611090002_customer_profile_deletion.sql`, `migrations/202611090003_reclaim_orphaned_profile_email.sql`, `migrations/202611100001_project_progress.sql`, `migrations/202611110001_team_communication_and_fair_assignment.sql`, then `migrations/202611110002_staff_direct_messages.sql`, using the Supabase CLI or SQL editor. Review the migrations in a non-production project first.
3. Enable email-and-password sign-in and customer signups in Supabase Auth, configure email confirmation and Auth rate limits, and set the correct Site URL and allowed redirect URLs. Public registration through the Client Portal creates customer accounts only; it cannot assign admin or freelancer roles.
4. Customers can create an account from **New customer? Create an account** on the Client Portal sign-in page. They confirm their email if email confirmation is enabled, then sign in with their password. Existing magic-link accounts need a password set before they can use password sign-in.
5. Create/invite the owner account through Supabase Auth, or register it through the Client Portal, then promote that account's profile in the Supabase SQL editor:

   ```sql
   update public.client_profiles
   set role = 'owner'
   where id = (
     select id from auth.users
     where lower(email) = lower('the-verified-owner-address@example.com')
   )
   returning id, email, role;
   ```

   The database role is `owner`; the dashboard labels it **Admin**. The account must exist in `auth.users` so the profile trigger has created its `client_profiles` row. Verify the query returns exactly one row. Admins sign in through the same form as customers; the profile role controls which dashboard they see. Never expose an owner-role control to customers.

   If Auth invitation fails with `client_profiles_email_key`, a profile row may remain after its Auth user was deleted. Check whether the matching profile's id still exists in `auth.users` before changing anything. When the old Auth user is absent, apply the following in the SQL editor, replacing the email with the exact address you are trying to invite. This anonymizes the orphaned profile but retains its project history; then invite the account again and promote its newly created profile.

   ```sql
   do $$
   declare
     old_profile public.client_profiles%rowtype;
     replacement_email text;
   begin
     select * into old_profile
     from public.client_profiles
     where email = 'the-verified-owner-address@example.com'
     for update;
     if not found then raise exception 'No profile found for that email.'; end if;
     if exists (select 1 from auth.users where id = old_profile.id) then
       raise exception 'This profile still has an Auth user; do not anonymize it.';
     end if;

     replacement_email := 'deleted+' || replace(old_profile.id::text, '-', '') || '@deleted.invalid';
     update public.client_profiles
     set email = replacement_email, display_name = 'Deleted customer', role = 'deleted', updated_at = now()
     where id = old_profile.id;
     update public.message_notification_jobs
     set recipient_email = replacement_email,
         status = case when status = 'sent' then 'sent' else 'failed' end,
         claimed_at = null, retry_at = null, last_error = null
     where recipient_email = old_profile.email;
   end;
   $$;
   ```

   The follow-up migration automatically anonymizes such orphaned rows during future Auth invitations. If the Auth user still exists, recover that account through Supabase Auth instead of anonymizing its profile.

6. The project progress migration seeds a standard workflow (Discovery through Post-launch Support) and its steps for existing and new projects. Project progress is calculated from completed steps. Admins can assign each step to a freelancer already on that project's team and set a due date. Admins and assigned freelancers update work status; customers can approve steps in review or request changes. Each change is recorded in the existing project activity feed and synced to open portal sessions through Supabase Realtime. Apply this migration before relying on the progress tracker. No demo customer or project is created in production.

7. To onboard a freelancer, first create/invite their Auth account in Supabase, then sign in to the Client Portal as Admin. Under **Freelancer accounts**, change their portal access from Customer to Freelancer. Assign them to individual projects under each project's **Project team** controls. Freelancers only see assigned projects and can post client-visible status/next-step updates, messages, and files; they cannot access invoices, quotes, payment settings, private notes, or unassigned projects. Changing a freelancer back to Customer removes their project assignments.

8. The staff communication workspace has a shared group conversation and private one-to-one conversations. Row-level security lets staff read group messages and only the direct messages they sent or received; customers cannot access either staff channel. Apply `202611110002_staff_direct_messages.sql` to enable direct messages and the staff directory.

9. Admins can enable the **24-hour fair assignment fallback** from **Settings**. It is disabled by default. When enabled, an hourly Supabase Cron job assigns a client request that remains in **Request Received** for at least 24 hours and has no project team. It selects a freelancer with the fewest open project steps, then the freelancer assigned least recently, adds them to the project, and assigns the first unfinished step. Each automated assignment and setting change is recorded in the management audit log, and the assignment is visible in the project activity feed.

   The migration installs and schedules the job when `pg_cron` is available. If it reports that `pg_cron` is unavailable, enable that extension in the Supabase Dashboard, then schedule the job in the SQL Editor:

   ```sql
   select cron.schedule(
     'client-desk-stale-request-assignment',
     '0 * * * *',
     'select public.auto_assign_stale_client_requests()'
   );
   ```

   Do not enable the portal setting until the schedule exists. Staff selection currently considers workload, not skills or leave availability; keep assignment manual when a request requires specialist matching.

Saving a project status or next step automatically adds a dated event to the project timeline. Progress-step updates sync to open portal sessions; other changes appear when the Client Portal is opened or refreshed. These progress changes do not send a separate email or require a message.

Customers can request account deletion from the **Delete my Client Portal account** section in their dashboard by re-entering their current password. The server removes the Auth login and anonymizes the profile. Project history, messages, shared files, quotes, and invoices are retained without the customer's name or email. If Auth removal fails after anonymization, portal access stays disabled and the customer can sign in to retry or contact FixerCtrl. The account deletion Edge Function must be deployed for this action to work.

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

Invoice email contains the invoice number, amount, due date, and an authenticated Client Portal link. It does not attach a PDF in this first release. Customers see the full quote, invoice schedule, status, and payment options after signing in.

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
- The original Client Portal migration was syntax-applied and basic customer/owner role-isolation checks were run in a temporary PostgreSQL 16 instance with mocked Supabase schemas. The freelancer-team and account-deletion migrations and their new role boundaries still need equivalent checks in a disposable database and a real non-production Supabase project before launch; mocks do not verify Supabase Auth, Storage, Edge gateway, or provider behavior.

The implementation is a deployment foundation, not a claim that the system is secure by all means or legally ready. Security requires correct account configuration, ongoing monitoring, testing, backups, and timely updates.
