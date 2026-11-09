# FixerCtrl Client Desk: Feature Plan

## Goal

Build a professional customer area where a client can request IT, security, or web work; approve a clear quote; pay securely; share required materials; follow progress; and communicate with FixerCtrl in one place.

The Client Desk should reduce uncertainty and awkward payment conversations. It should make the scope, price, payment dates, current status, required customer actions, and next step visible before work begins and throughout the job.

## Implementation Status

The first implementation is now present in the site at `#/client-desk`, with a responsive customer and owner workspace, email-and-password sign-in flow, requests, messages, customer-visible progress, owner-only notes, checklists, private file uploads, quote approval, multi-milestone invoices, provider selection, and manual EFT reconciliation. GitHub Pages now includes the Client Desk assets.

The Supabase migration adds row-level access rules, private storage, immutable sent/accepted quotes and agreed invoice amounts/due dates, verified-payment recording, scheduled invoice/message notification queues, and owner reconciliation for manual EFT. Edge Functions provide hosted PayFast and Stripe checkout, PayFast/Stripe webhook verification, Resend invoice/message emails, and retryable invoice dispatch. Quotes support up to twelve agreed milestones. Stripe checkout sessions expire; provider state must be stored before a checkout link is returned. The browser SDK is version-pinned with SRI, and the inline app script is authorized by a CSP hash rather than `unsafe-inline`.

This is not live billing yet. `client-desk-config.js` intentionally has empty public Supabase settings, all payment methods start disabled, and no Supabase, email, scheduler, or merchant secrets are configured in this repository. Follow [supabase/SETUP.md](supabase/SETUP.md) before enabling real accounts or payments. The invoice email currently sends an invoice summary and authenticated portal link, not a PDF attachment. Absolute security cannot be guaranteed; the security design still requires deployment review, provider sandbox testing, RLS isolation checks, monitoring, and ongoing maintenance.

## Security Status

### Done in the repository

- Customer accounts default to the customer role; the owner role requires a deliberate database-side promotion.
- Database row-level security and least-privilege grants isolate customer projects, profiles, messages, quotes, invoices, and files. Internal messages/checklist entries/files are owner-only.
- Customers cannot update roles, quote/invoice state, or payment status through direct browser table writes. Quote acceptance, payment reconciliation, and payment callbacks use guarded database functions.
- Sent quotes and accepted quote terms are immutable. Invoice amounts and due dates are locked after quote acceptance. Milestone totals must equal the quote total.
- Private uploads are limited to JPG, PNG, WebP, and PDF with a 10 MB per-file cap and short-lived signed links. The upload path has no antivirus scanning yet.
- Payment callbacks verify provider signatures/notifications, invoice amount and currency, and idempotent event IDs. Duplicate confirmed charges are recorded for follow-up rather than silently discarded.
- Authenticated project request and customer message rates are limited in the database. Browser code escapes displayed customer-provided text.
- The site CSP is hash-based for its inline app script; the Supabase JS CDN file is pinned to a version with Subresource Integrity.
- Invoice and message email jobs are claimed transactionally, retried with a cap, and require a secret scheduler token. A failed invoice email can be retried by the owner.

### Verified locally

- The migration applied successfully to a temporary PostgreSQL 16 database with minimal mock Supabase auth/storage schemas.
- RLS smoke checks passed: a customer saw only their own project/profile and public messages; could not see an internal note; could not promote their account; and could not mark an invoice paid directly. The owner saw both sample projects and the internal note.
- Deno type-check passed for all Edge Function files.
- Browser JS syntax, CSP hash consistency, editor diagnostics, `git diff --check`, and local preview asset responses passed.

These are useful checks, not a production penetration test. The SQL test used mocked Supabase schemas; Supabase Auth, Storage, payment provider webhooks, email delivery, and scheduled invocation have not been exercised against real services.

## Remaining Before Live Customers

1. Create a Supabase project and apply the migration there. Confirm the schema, storage policies, and Auth profile trigger in Supabase itself.
2. Enable email-and-password authentication, disable public signups unless an account-creation flow is added, configure Auth rate limits, provision customer accounts securely, and promote only the verified owner account.
3. Set the public Supabase URL and anon key in `client-desk-config.js`. Keep the service role key out of the site and repository.
4. Deploy the three Edge Functions and set their server-side secrets through Supabase's protected secret configuration.
5. Verify the email sender domain, configure Resend, and set a trusted 5–15 minute scheduler with the dispatch bearer secret. Test retries and failed-delivery monitoring.
6. Configure one payment provider in sandbox first. Test successful, cancelled, expired, failed, duplicate, wrong-amount, and invalid-signature flows before enabling it. Enable another gateway only after its full path is tested.
7. Test customer A/customer B isolation and private file access against the real Supabase API, not only the UI. Add backups, restore tests, alerting, and an incident/credential-rotation process.
8. Complete business identity and South African legal/tax/privacy review before sending invoices or accepting money. The current Terms & privacy page is still a draft.

## Residual Risks and Suggestions

- No absolute security guarantee is possible. Keep provider methods disabled until all real-service tests pass; start with one payment provider and manual EFT only if you can reconcile it reliably.
- Customer uploads have size/type checks and private access, but no malware scanning, quota/retention automation, or incident review workflow. Consider scanning uploads before production use and decide how long files are retained.
- Invoice email is currently a summary with a sign-in link, not a downloadable PDF invoice. Confirm the required invoice fields and legal operator details, then decide whether a printable/PDF invoice is required.
- Refunds are not automated. Define a manual refund and duplicate-payment process in your terms and operating checklist.
- GitHub Pages supports the CSP meta policy but not all response security headers. If you later need HSTS, `frame-ancestors`, or other response-only headers, place the site behind a host/CDN that lets you configure them.
- Keep the public price guide indicative; the customer-specific accepted quote and milestone schedule remain the binding project price.

## Product Direction

Use a client portal with authenticated customer accounts rather than public, guessable ticket URLs. Each customer sees only their own projects and messages. The public website can remain a static GitHub Pages site, but private accounts, project data, file access, and payment confirmation require a trusted backend.

The visual language should remain FixerCtrl: charcoal surfaces, electric-blue highlights, technical typography, restrained borders, and the existing identity. The portal itself should prioritize legibility and scanning over decorative effects.

## Customer Experience

1. A customer submits a request and chooses a category: web, IT support, or security.
2. The request asks only for relevant details and materials. Examples include goals, affected device or service, deadline, existing site link, images, logo, and copy.
3. The customer sees the request as received while FixerCtrl reviews it. This is not yet a confirmed quote or commitment to start work.
4. FixerCtrl sends a written scope and quote through the portal. The customer can review deliverables, exclusions, timeline, payment milestones, and any third-party costs, then accept or ask a question.
5. After acceptance, the customer sees the agreed schedule, payment actions, checklist, messages, and progress history.
6. Replies are available in the portal and trigger email notifications. Email is a notification channel; the portal remains the canonical project record.
7. At handover, the portal shows the final deliverables, any remaining balance, and project completion status.

## Customer Dashboard

Each project should show:

- Service category, project title, and a human-readable reference.
- Current status, last update, and the next expected action.
- A progress timeline: request received, scoping, quote sent, awaiting approval/payment/materials, work underway, client review, handover, and complete.
- A checklist with clear ownership, such as “FixerCtrl: prepare quote” or “You: upload logo”.
- The agreed scope, deliverables, exclusions, timeline, total price, and payment schedule.
- Invoice and payment state for each amount: not yet due, due, processing, paid, overdue, or refunded where applicable.
- A message thread, attachments, and an audit-style history of important changes.

Only customer-visible updates should appear in this view. Keep private admin notes separate from messages and status updates.

## Owner Dashboard

FixerCtrl needs an admin-only view to:

- Review and qualify incoming requests.
- Ask questions, prepare a quote, and record the agreed scope and schedule.
- Set project status and next action.
- Add, assign, and complete checklist items.
- Send customer-visible updates and private internal notes separately.
- Create payment milestones, issue payment requests, and reconcile manual EFT payments.
- Upload deliverables and close out a project.

For a single operator, keep the first version focused on one owner role. Add staff roles only if the workflow later requires them.

## Current Public Price Guide

The existing IT & Web Support page lists these indicative prices in ZAR:

- One-page landing page: R1,500–R3,000.
- Small multi-page website, up to 5 pages: R3,500–R7,500.
- Website updates: R250 per hour.
- Basic deployment or project setup: from R500.
- Small feature or integration: from R800, quoted after review.
- IT and security support: quoted after review.

The site also says that final price depends on scope and that deliverables and total price are confirmed before work starts. Keep this distinction in the portal: public prices are guides, while a quote is the customer-approved amount for the specific job. Do not silently convert a “from” price into a fixed charge.

## Payment Recommendation

### Start with PayFast as the South African gateway to evaluate

For this South Africa-focused site, PayFast is the recommended first provider to investigate for online checkout and ZAR payments. Confirm current merchant eligibility, payment methods, settlement timing, fees, refund handling, and integration requirements directly with PayFast before committing. A second provider can be added later if customer research shows a need; avoid launching with multiple gateways unless there is a clear benefit.

The first implementation includes PayFast and Stripe hosted-checkout adapters, plus optional manual EFT. This provides more than one gateway choice, but it does not mean every provider is available in production: each provider must have a valid merchant account, backend secrets, and tested webhook before the owner enables it. Keep manual EFT as an explicitly supported alternative if it suits the business. Show the invoice reference and instructions, and mark the payment as paid only after checking the bank transaction. Never ask customers to send card details through a message or upload.

### Make milestones explicit, not dependent on vague progress percentages

Do not automatically charge a customer because a progress bar moved or a status changed. Progress is descriptive; an agreed invoice milestone is the payment obligation. Before work starts, the customer should accept the exact amount, due condition/date, scope, and deliverable associated with every payment.

A sensible starting policy to discuss and publish is:

- Small fixed-scope jobs: one agreed payment before work starts, or a clearly stated deposit and final balance.
- Larger projects: an initial deposit followed by named payments tied to agreed deliverables or review points, with the amount and due condition shown in advance.
- Hourly or uncertain diagnostic work: agree a time cap or first paid block before work; request approval before exceeding it.
- Third-party charges such as domains, subscriptions, or paid hosting: list them separately and state who pays them.

A 50% deposit / 50% before final handover can be offered as a simple default for suitable fixed-price work, but it should be a business policy the owner deliberately chooses, not an assumed rule. For longer projects, define smaller milestone amounts in the quote. Make due dates and any pause/resume behavior explicit. The customer must approve all scope or price changes before they become payable.

### Payment states and automation

A clear sequence could be:

1. Quote sent; customer reviews it.
2. Customer accepts the quote and payment schedule.
3. The first invoice or checkout action becomes available.
4. Payment provider confirmation is received and verified server-side.
5. The project is marked “Ready to start” once all start conditions are met, such as payment and required materials.
6. Later milestone invoices become due only under the accepted schedule.
7. Handover and final payment follow the agreed final milestone.

Show a plain-language explanation beside each amount, for example: “R1,750 deposit, due after quote acceptance; work starts once payment and the listed materials are received.” If work is waiting, say whether it is waiting on payment, customer materials, feedback, or FixerCtrl.

Payment success or cancellation redirects in the browser are not proof of payment. The backend must verify the provider's signed server notification/callback, expected amount, currency, and project/invoice reference before updating the invoice. Make callback processing idempotent so retries cannot create duplicate payments. Do not store card numbers or security codes.

## Suggested Data Concepts

These are product concepts, not a finished database migration:

- Customer identity/profile.
- Project/request, including owner and customer-visible status.
- Quote version and accepted terms, scope, total, and schedule.
- Invoice/payment milestone and provider reference/status.
- Checklist item with owner, due date, and completion state.
- Message with visibility (customer-visible or internal) and author.
- Attachment with private storage key, file metadata, and project access rules.
- Activity event for important changes and notification delivery state.

Keep money amounts in integer minor units (cents), with an explicit currency code such as ZAR. Store the quote and schedule accepted by the customer so later edits cannot silently change the original agreement.

## Architecture and Safety

- GitHub Pages can continue serving public pages, but it is not the backend for a private portal.
- Use Supabase Auth for email-link sign-in, Postgres for project records, and private Storage for customer uploads, with Row Level Security on every customer-owned record. The current [schema.sql](schema.sql) is only a blog/podcast starter schema; it does not configure this portal.
- Keep payment secrets and email-provider keys in backend secrets, never in the browser or a public repository.
- Create checkout sessions and process verified payment callbacks in trusted server-side code, such as Supabase Edge Functions or an equivalent backend.
- Send email from a verified business sender using a transactional provider. Include minimal information in email; link the customer to the authenticated portal rather than exposing sensitive project details or files in email.
- Use private, short-lived file links, validate file types and sizes, and provide deletion/retention rules.
- Add rate limits and abuse protection to request creation, sign-in, messaging, and uploads.
- Keep internal notes and any private customer data inaccessible to other clients by database and storage policy, not just by hiding UI elements.

## Legal and Operational Readiness

The current terms page identifies itself as a draft and says the operator's full legal name, legal form where applicable, and South African physical business address have not been supplied. It also says project agreements should confirm scope, deliverables, price, timing, payment arrangements, and review scope. Resolve these before accepting online payments or treating the portal terms as final.

Before launch, have the appropriate South African professional review the customer terms, privacy notice, cancellation/refund/change process, tax and invoice wording, payment-provider arrangement, POPIA obligations, and any consumer-law disclosures that apply. State clearly whether listed prices include any applicable taxes, and identify third-party costs. This plan is product guidance, not legal or tax advice.

## Delivery Phases

1. **Foundation:** decide the payment policy and provider; complete business/legal details; configure backend project, email sender, auth, and access policies.
2. **Request and quote:** customer request form, owner inbox, clarification thread, quote versioning, and explicit acceptance.
3. **Project tracking:** customer and owner dashboards, flexible checklists, status timeline, and notifications.
4. **Payments:** invoice/milestone records, hosted checkout, verified callbacks, manual EFT reconciliation, receipts, and refunds/cancellations workflow.
5. **Hardening and launch:** test account isolation, payment callback retries/failures, email delivery, upload permissions, mobile layouts, backups, and support procedures.

Do not collect real customer payment or sensitive documents until authentication, access-control policies, terms, and payment callbacks have been tested end to end.

## Decisions to Confirm

- Which legal/business name and address should appear on quotes and invoices?
- What deposit and milestone policy do you want to offer for fixed-price and hourly work?
- Should small jobs require full prepayment, a deposit, or payment after completion?
- Which PayFast merchant account and settlement details will be used, and are its current fees/methods acceptable?
- Will manual EFT be available alongside online checkout?
- Which sender address should deliver account and project notifications?
- What is the policy for cancellations, refunds, pauses, late customer materials, and scope changes?
- What file types, size limits, and retention period should apply to customer uploads?
- Will the first release include a customer portal sign-in, or should the first milestone be request/quote only?
