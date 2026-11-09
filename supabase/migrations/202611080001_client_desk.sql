create extension if not exists pgcrypto;

create table if not exists public.client_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text not null default '',
  role text not null default 'customer' check (role in ('customer', 'owner')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('FC-' || to_char(now() at time zone 'utc', 'YYMMDD') || '-' || upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6))),
  customer_id uuid not null references public.client_profiles(id) on delete restrict,
  title text not null check (char_length(title) between 2 and 120),
  service_category text not null check (service_category in ('web', 'it_support', 'security')),
  description text not null check (char_length(description) between 2 and 5000),
  status text not null default 'received' check (status in ('received', 'scoping', 'awaiting_approval', 'awaiting_payment', 'awaiting_customer', 'in_progress', 'review', 'handover', 'complete', 'paused')),
  preferred_date date,
  next_action text check (next_action is null or char_length(next_action) <= 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  actor_id uuid references public.client_profiles(id) on delete set null,
  event_type text not null,
  title text not null,
  description text not null default '',
  visible_to_customer boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.project_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  author_id uuid not null references public.client_profiles(id) on delete restrict,
  body text not null check (char_length(body) between 1 and 5000),
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.message_notification_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  message_id uuid not null references public.project_messages(id) on delete cascade,
  recipient_email text not null,
  send_at timestamptz not null default now(),
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'retry', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  claimed_at timestamptz,
  last_error text,
  retry_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.project_checklist (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 240),
  owner_kind text not null check (owner_kind in ('customer', 'owner')),
  is_internal boolean not null default false,
  position integer not null default 0,
  due_at timestamptz,
  completed_at timestamptz,
  completed_by uuid references public.client_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'declined', 'expired', 'superseded')),
  scope text not null check (char_length(scope) between 1 and 5000),
  deliverables text not null check (char_length(deliverables) between 1 and 3000),
  exclusions text not null default '',
  total_minor bigint not null check (total_minor > 0),
  currency text not null default 'ZAR' check (currency ~ '^[A-Z]{3}$'),
  valid_until date not null,
  accepted_by uuid references public.client_profiles(id) on delete set null,
  accepted_at timestamptz,
  created_by uuid not null default auth.uid() references public.client_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (project_id, version)
);

create table if not exists public.payment_providers (
  provider text primary key check (provider in ('payfast', 'stripe', 'eft')),
  label text not null,
  is_enabled boolean not null default false,
  public_instructions text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique default ('INV-' || to_char(now() at time zone 'utc', 'YYMMDD') || '-' || upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6))),
  project_id uuid not null references public.projects(id) on delete restrict,
  quote_id uuid references public.quotes(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sent', 'paid', 'overdue', 'void', 'refunded')),
  description text not null default 'Project milestone',
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'ZAR' check (currency ~ '^[A-Z]{3}$'),
  due_at timestamptz not null,
  email_send_at timestamptz not null,
  email_state text not null default 'queued' check (email_state in ('queued', 'sending', 'sent', 'retry', 'failed', 'not_required')),
  email_attempts integer not null default 0 check (email_attempts >= 0),
  email_last_error text,
  email_retry_at timestamptz,
  manual_payment_instructions text not null default '',
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  provider text not null references public.payment_providers(provider),
  provider_reference text,
  checkout_url text,
  status text not null default 'created' check (status in ('created', 'pending', 'paid', 'duplicate_paid', 'failed', 'cancelled', 'refunded')),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'ZAR' check (currency ~ '^[A-Z]{3}$'),
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null references public.payment_providers(provider),
  provider_event_id text not null,
  attempt_id uuid references public.payment_attempts(id) on delete set null,
  event_type text not null,
  payload_hash text not null,
  processed_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create table if not exists public.project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  uploaded_by uuid not null references public.client_profiles(id) on delete restrict,
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 255),
  content_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists projects_customer_updated_idx on public.projects(customer_id, updated_at desc);
create index if not exists project_events_project_created_idx on public.project_events(project_id, created_at);
create index if not exists project_messages_project_created_idx on public.project_messages(project_id, created_at);
create index if not exists message_notification_due_idx on public.message_notification_jobs(status, send_at);
create index if not exists invoices_schedule_idx on public.invoices(status, email_state, email_send_at);
create index if not exists payment_attempts_invoice_idx on public.payment_attempts(invoice_id, created_at desc);

create or replace function public.is_client_desk_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.client_profiles
    where id = (select auth.uid()) and role = 'owner'
  );
$$;

revoke all on function public.is_client_desk_owner() from public, anon;
grant execute on function public.is_client_desk_owner() to authenticated, service_role;

create or replace function public.is_internal_project_file(p_storage_path text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.project_files
    where storage_path = p_storage_path and is_internal
  );
$$;

revoke all on function public.is_internal_project_file(text) from public, anon;
grant execute on function public.is_internal_project_file(text) to authenticated, service_role;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.create_client_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.client_profiles (id, email, display_name)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create or replace function public.sync_client_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.email is distinct from old.email then
    update public.client_profiles set email = coalesce(new.email, '') where id = new.id;
  end if;
  return new;
end;
$$;

 drop trigger if exists auth_user_client_profile on auth.users;
create trigger auth_user_client_profile after insert on auth.users
for each row execute function public.create_client_profile();
drop trigger if exists auth_user_client_profile_email on auth.users;
create trigger auth_user_client_profile_email after update of email on auth.users
for each row execute function public.sync_client_profile_email();

create or replace function public.log_project_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status is distinct from new.status or old.next_action is distinct from new.next_action then
    insert into public.project_events (project_id, actor_id, event_type, title, description, visible_to_customer)
    values (
      new.id,
      (select auth.uid()),
      case when old.status is distinct from new.status then 'status' else 'next_action' end,
      case when old.status is distinct from new.status then 'Status updated' else 'Next step updated' end,
      case when old.status is distinct from new.status then replace(new.status, '_', ' ') else coalesce(new.next_action, 'No next action set') end,
      true
    );
  end if;
  return new;
end;
$$;

create or replace function public.enqueue_message_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  customer_profile public.client_profiles%rowtype;
  author_role text;
begin
  if new.is_internal then return new; end if;
  select role into author_role from public.client_profiles where id = new.author_id;
  select cp.* into customer_profile
  from public.projects p join public.client_profiles cp on cp.id = p.customer_id
  where p.id = new.project_id;

  if not found then return new; end if;
  if author_role = 'owner' then
    insert into public.message_notification_jobs (project_id, message_id, recipient_email)
    values (new.project_id, new.id, customer_profile.email);
  else
    insert into public.message_notification_jobs (project_id, message_id, recipient_email)
    select new.project_id, new.id, cp.email from public.client_profiles cp where cp.role = 'owner';
  end if;
  return new;
end;
$$;

drop trigger if exists message_notification_enqueue on public.project_messages;
create trigger message_notification_enqueue after insert on public.project_messages
for each row execute function public.enqueue_message_notification();

 drop trigger if exists projects_updated_at on public.projects;
create trigger projects_updated_at before update on public.projects
for each row execute function public.touch_updated_at();
drop trigger if exists projects_status_event on public.projects;
create trigger projects_status_event after update on public.projects
for each row execute function public.log_project_status_change();
drop trigger if exists client_profiles_updated_at on public.client_profiles;
create trigger client_profiles_updated_at before update on public.client_profiles
for each row execute function public.touch_updated_at();
drop trigger if exists invoices_updated_at on public.invoices;
create trigger invoices_updated_at before update on public.invoices
for each row execute function public.touch_updated_at();
drop trigger if exists payment_attempts_updated_at on public.payment_attempts;
create trigger payment_attempts_updated_at before update on public.payment_attempts
for each row execute function public.touch_updated_at();

create or replace function public.prevent_quote_acceptance_edit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.status = 'accepted' and new is distinct from old then
    raise exception 'Accepted quotes are immutable; create a new quote version.';
  end if;
  if old.status = 'sent' and (
    new.project_id is distinct from old.project_id or
    new.version is distinct from old.version or
    new.scope is distinct from old.scope or
    new.deliverables is distinct from old.deliverables or
    new.exclusions is distinct from old.exclusions or
    new.total_minor is distinct from old.total_minor or
    new.currency is distinct from old.currency or
    new.valid_until is distinct from old.valid_until
  ) then raise exception 'Sent quotes cannot be edited; create a new quote version.'; end if;
  return new;
end;
$$;

drop trigger if exists quotes_accepted_immutable on public.quotes;
create trigger quotes_accepted_immutable before update on public.quotes
for each row execute function public.prevent_quote_acceptance_edit();

create or replace function public.prevent_accepted_invoice_amount_edit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.quote_id is not null and exists (
    select 1 from public.quotes q where q.id = old.quote_id and q.status = 'accepted'
  ) and (
    new.project_id is distinct from old.project_id or
    new.quote_id is distinct from old.quote_id or
    new.description is distinct from old.description or
    new.amount_minor is distinct from old.amount_minor or
    new.currency is distinct from old.currency or
    new.due_at is distinct from old.due_at
  ) then
    raise exception 'Accepted invoice amounts cannot be changed; issue a new quote and schedule.';
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_accepted_amount_immutable on public.invoices;
create trigger invoices_accepted_amount_immutable before update on public.invoices
for each row execute function public.prevent_accepted_invoice_amount_edit();

create or replace function public.submit_project(
  p_title text,
  p_service_category text,
  p_description text,
  p_preferred_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_project_id uuid;
  recent_request_count integer;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required.'; end if;
  if p_service_category not in ('web', 'it_support', 'security') then raise exception 'Invalid service category.'; end if;
  if char_length(trim(p_title)) not between 2 and 120 then raise exception 'Project title must be 2 to 120 characters.'; end if;
  if char_length(trim(p_description)) not between 2 and 5000 then raise exception 'Describe your request in 2 to 5000 characters.'; end if;
  select count(*) into recent_request_count from public.projects
  where customer_id = (select auth.uid()) and created_at > now() - interval '24 hours';
  if recent_request_count >= 5 then raise exception 'Request limit reached. Please follow up on an existing request or try again later.'; end if;

  insert into public.projects (customer_id, title, service_category, description, preferred_date)
  values ((select auth.uid()), trim(p_title), p_service_category, trim(p_description), p_preferred_date)
  returning id into new_project_id;

  insert into public.project_events (project_id, actor_id, event_type, title, description, visible_to_customer)
  values (new_project_id, (select auth.uid()), 'created', 'Request received', 'FixerCtrl will review the request and follow up here.', true);

  return new_project_id;
end;
$$;

revoke all on function public.submit_project(text, text, text, date) from public, anon;
grant execute on function public.submit_project(text, text, text, date) to authenticated;

create or replace function public.limit_customer_message_rate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  recent_message_count integer;
  author_role text;
begin
  select role into author_role from public.client_profiles where id = new.author_id;
  if author_role = 'customer' and not new.is_internal then
    select count(*) into recent_message_count from public.project_messages
    where author_id = new.author_id and not is_internal and created_at > now() - interval '10 minutes';
    if recent_message_count >= 10 then raise exception 'Message rate limit reached. Please wait before sending another update.'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists customer_message_rate_limit on public.project_messages;
create trigger customer_message_rate_limit before insert on public.project_messages
for each row execute function public.limit_customer_message_rate();

create or replace function public.owner_create_project_quote(
  p_project_id uuid,
  p_scope text,
  p_deliverables text,
  p_exclusions text,
  p_total_minor bigint,
  p_valid_until date,
  p_schedule jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  project_row public.projects%rowtype;
  quote_id uuid;
  quote_version integer;
  schedule_item jsonb;
  schedule_total bigint := 0;
  item_amount bigint;
begin
  if not (select public.is_client_desk_owner()) then raise exception 'Owner access is required.'; end if;
  if char_length(trim(p_scope)) not between 1 and 5000 or char_length(trim(p_deliverables)) not between 1 and 3000 then
    raise exception 'Scope and deliverables are required.';
  end if;
  if p_total_minor <= 0 or p_valid_until < current_date then raise exception 'Invalid quote total or expiry date.'; end if;
  if jsonb_typeof(p_schedule) <> 'array' or jsonb_array_length(p_schedule) not between 1 and 12 then
    raise exception 'Add between one and twelve payment milestones.';
  end if;

  select p.* into project_row from public.projects p where p.id = p_project_id for update;
  if not found then raise exception 'Project not found.'; end if;

  for schedule_item in select value from jsonb_array_elements(p_schedule) as items(value) loop
    if char_length(trim(coalesce(schedule_item ->> 'description', ''))) not between 1 and 240 then
      raise exception 'Each payment milestone needs a short description.';
    end if;
    if coalesce(schedule_item ->> 'amount_minor', '') !~ '^[1-9][0-9]*$' then raise exception 'Invalid milestone amount.'; end if;
    item_amount := (schedule_item ->> 'amount_minor')::bigint;
    if item_amount > 9007199254740991 then raise exception 'Milestone amount is too large.'; end if;
    if coalesce(schedule_item ->> 'due_at', '') = '' or coalesce(schedule_item ->> 'email_send_at', '') = '' then
      raise exception 'Every milestone needs a due date and invoice send date.';
    end if;
    schedule_total := schedule_total + item_amount;
  end loop;
  if schedule_total <> p_total_minor then raise exception 'Milestone amounts must add up exactly to the quote total.'; end if;

  update public.quotes set status = 'superseded'
  where project_id = p_project_id and status = 'sent';
  select coalesce(max(q.version), 0) + 1 into quote_version from public.quotes q where q.project_id = p_project_id;
  insert into public.quotes (project_id, version, status, scope, deliverables, exclusions, total_minor, currency, valid_until, created_by)
  values (p_project_id, quote_version, 'sent', trim(p_scope), trim(p_deliverables), coalesce(trim(p_exclusions), ''), p_total_minor, 'ZAR', p_valid_until, (select auth.uid()))
  returning id into quote_id;

  for schedule_item in select value from jsonb_array_elements(p_schedule) as items(value) loop
    insert into public.invoices (project_id, quote_id, status, description, amount_minor, currency, due_at, email_send_at)
    values (
      p_project_id,
      quote_id,
      'draft',
      trim(schedule_item ->> 'description'),
      (schedule_item ->> 'amount_minor')::bigint,
      'ZAR',
      (schedule_item ->> 'due_at')::timestamptz,
      (schedule_item ->> 'email_send_at')::timestamptz
    );
  end loop;

  update public.projects set status = 'awaiting_approval' where id = p_project_id;
  insert into public.project_events (project_id, actor_id, event_type, title, description, visible_to_customer)
  values (p_project_id, (select auth.uid()), 'quote_sent', 'Quote sent', 'Review the scope, total, and payment schedule before accepting.', true);
  return quote_id;
end;
$$;

revoke all on function public.owner_create_project_quote(uuid, text, text, text, bigint, date, jsonb) from public, anon;
grant execute on function public.owner_create_project_quote(uuid, text, text, text, bigint, date, jsonb) to authenticated;

create or replace function public.accept_project_quote(p_quote_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  quote_row public.quotes%rowtype;
begin
  select q.* into quote_row
  from public.quotes q join public.projects p on p.id = q.project_id
  where q.id = p_quote_id and p.customer_id = (select auth.uid()) and q.status = 'sent'
  for update of q;

  if not found then raise exception 'This quote is unavailable or has already changed.'; end if;
  if quote_row.valid_until < current_date then raise exception 'This quote has expired.'; end if;
  if (select coalesce(sum(i.amount_minor), 0) from public.invoices i where i.quote_id = p_quote_id and i.status = 'draft') <> quote_row.total_minor then
    raise exception 'The invoice schedule must equal the agreed quote total.';
  end if;

  update public.quotes set status = 'accepted', accepted_by = (select auth.uid()), accepted_at = now()
  where id = p_quote_id;
  update public.invoices set status = 'scheduled'
  where quote_id = p_quote_id and status = 'draft';
  update public.projects set status = 'awaiting_payment'
  where id = quote_row.project_id;
  insert into public.project_events (project_id, actor_id, event_type, title, description)
  values (quote_row.project_id, (select auth.uid()), 'quote_accepted', 'Quote accepted', 'The agreed payment schedule is now active.', true);
end;
$$;

revoke all on function public.accept_project_quote(uuid) from public, anon;
grant execute on function public.accept_project_quote(uuid) to authenticated;

create or replace function public.complete_customer_checklist_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  completed_project uuid;
  completed_title text;
begin
  update public.project_checklist c
  set completed_at = now(), completed_by = (select auth.uid())
  from public.projects p
  where c.id = p_item_id and c.project_id = p.id and p.customer_id = (select auth.uid())
    and c.owner_kind = 'customer' and not c.is_internal and c.completed_at is null
  returning c.project_id, c.title into completed_project, completed_title;
  if not found then raise exception 'This checklist item is unavailable or already complete.'; end if;
  insert into public.project_events (project_id, actor_id, event_type, title, description, visible_to_customer)
  values (completed_project, (select auth.uid()), 'checklist', 'Customer item completed', completed_title, true);
end;
$$;

revoke all on function public.complete_customer_checklist_item(uuid) from public, anon;
grant execute on function public.complete_customer_checklist_item(uuid) to authenticated;

create or replace function public.claim_due_invoices(p_limit integer default 25)
returns table (id uuid, invoice_number text, project_id uuid, amount_minor bigint, currency text, due_at timestamptz, email_attempts integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Service role required.'; end if;
  update public.invoices set status = 'overdue'
  where status = 'sent' and due_at < now();
  update public.invoices i
  set email_state = 'failed', email_last_error = 'Invoice email worker stopped before completion.'
  where i.email_state = 'sending' and i.updated_at < now() - interval '15 minutes' and i.email_attempts >= 5;

  return query
  with due as (
    select i.id from public.invoices i
    where i.status in ('scheduled', 'sent', 'overdue')
      and (i.email_state in ('queued', 'retry') or (i.email_state = 'sending' and i.updated_at < now() - interval '15 minutes'))
      and i.email_send_at <= now()
      and (i.email_retry_at is null or i.email_retry_at <= now())
      and i.email_attempts < 5
    order by i.email_send_at
    limit least(greatest(p_limit, 1), 100)
    for update skip locked
  ), claimed as (
    update public.invoices i
    set email_state = 'sending', email_attempts = i.email_attempts + 1, email_last_error = null
    from due where i.id = due.id
    returning i.id, i.invoice_number, i.project_id, i.amount_minor, i.currency, i.due_at, i.email_attempts
  )
  select * from claimed;
end;
$$;

revoke all on function public.claim_due_invoices(integer) from public, anon, authenticated;
grant execute on function public.claim_due_invoices(integer) to service_role;

create or replace function public.record_verified_payment(
  p_provider text,
  p_provider_event_id text,
  p_attempt_id uuid,
  p_amount_minor bigint,
  p_currency text,
  p_event_type text,
  p_payload_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  attempt_row public.payment_attempts%rowtype;
  invoice_row public.invoices%rowtype;
  inserted_event uuid;
  existing_payload_hash text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Service role required.'; end if;
  select a.* into attempt_row from public.payment_attempts a
  where a.id = p_attempt_id and a.provider = p_provider for update;
  if not found then raise exception 'Payment attempt not found.'; end if;
  select i.* into invoice_row from public.invoices i
  where i.id = attempt_row.invoice_id for update;
  if not found then raise exception 'Invoice not found.'; end if;
  if attempt_row.amount_minor <> p_amount_minor or invoice_row.amount_minor <> p_amount_minor
     or lower(attempt_row.currency) <> lower(p_currency) or lower(invoice_row.currency) <> lower(p_currency) then
    raise exception 'Payment amount or currency does not match the invoice.';
  end if;

  insert into public.payment_events (provider, provider_event_id, attempt_id, event_type, payload_hash)
  values (p_provider, p_provider_event_id, p_attempt_id, p_event_type, p_payload_hash)
  on conflict (provider, provider_event_id) do nothing
  returning id into inserted_event;
  if inserted_event is null then
    select e.payload_hash into existing_payload_hash from public.payment_events e
    where e.provider = p_provider and e.provider_event_id = p_provider_event_id;
    if existing_payload_hash is distinct from p_payload_hash then raise exception 'Payment event ID was reused with different data.'; end if;
    return true;
  end if;

  if attempt_row.status = 'paid' then return true; end if;
  if invoice_row.status = 'paid' then
    update public.payment_attempts set status = 'duplicate_paid', updated_at = now() where id = p_attempt_id;
    insert into public.project_events (project_id, actor_id, event_type, title, description, visible_to_customer)
    values (invoice_row.project_id, null, 'duplicate_payment', 'Additional payment received', 'An additional payment for invoice ' || invoice_row.invoice_number || ' needs reconciliation. FixerCtrl will follow up.', true);
    return true;
  end if;

  update public.payment_attempts set status = 'paid', updated_at = now() where id = p_attempt_id;
  update public.invoices set status = 'paid', paid_at = coalesce(paid_at, now()), email_state = case when email_state = 'queued' then 'not_required' else email_state end
  where id = invoice_row.id;
  insert into public.project_events (project_id, actor_id, event_type, title, description, visible_to_customer)
  values (invoice_row.project_id, null, 'payment_received', 'Payment received', 'Payment confirmed for invoice ' || invoice_row.invoice_number || '.', true);
  return true;
end;
$$;

revoke all on function public.record_verified_payment(text, text, uuid, bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.record_verified_payment(text, text, uuid, bigint, text, text, text) to service_role;

create or replace function public.owner_mark_invoice_paid(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  invoice_row public.invoices%rowtype;
begin
  if not (select public.is_client_desk_owner()) then raise exception 'Owner access is required.'; end if;
  select i.* into invoice_row from public.invoices i where i.id = p_invoice_id for update;
  if not found or invoice_row.status not in ('sent', 'overdue') then raise exception 'Only a sent, unpaid invoice can be reconciled.'; end if;
  update public.invoices set status = 'paid', paid_at = coalesce(paid_at, now()) where id = p_invoice_id;
  insert into public.project_events (project_id, actor_id, event_type, title, description, visible_to_customer)
  values (invoice_row.project_id, (select auth.uid()), 'payment_received', 'Manual payment recorded', 'FixerCtrl confirmed receipt for invoice ' || invoice_row.invoice_number || '.', true);
end;
$$;

revoke all on function public.owner_mark_invoice_paid(uuid) from public, anon;
grant execute on function public.owner_mark_invoice_paid(uuid) to authenticated;

create or replace function public.owner_retry_invoice_email(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not (select public.is_client_desk_owner()) then raise exception 'Owner access is required.'; end if;
  update public.invoices i
  set email_state = 'queued', email_attempts = 0, email_last_error = null, email_retry_at = null, email_send_at = now()
  where i.id = p_invoice_id and i.status in ('scheduled', 'sent', 'overdue') and i.email_state = 'failed';
  if not found then raise exception 'Only a failed invoice email can be retried.'; end if;
end;
$$;

revoke all on function public.owner_retry_invoice_email(uuid) from public, anon;
grant execute on function public.owner_retry_invoice_email(uuid) to authenticated;

create or replace function public.claim_due_message_notifications(p_limit integer default 50)
returns table (id uuid, project_id uuid, message_id uuid, recipient_email text, attempts integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Service role required.'; end if;
  update public.message_notification_jobs n
  set status = 'failed', last_error = 'Notification worker stopped before completion.'
  where n.status = 'sending' and n.claimed_at < now() - interval '15 minutes' and n.attempts >= 5;

  return query
  with due as (
    select n.id from public.message_notification_jobs n
    where (n.status in ('queued', 'retry') or (n.status = 'sending' and n.claimed_at < now() - interval '15 minutes')) and n.send_at <= now()
      and (n.retry_at is null or n.retry_at <= now()) and n.attempts < 5
    order by n.send_at
    limit least(greatest(p_limit, 1), 100)
    for update skip locked
  ), claimed as (
    update public.message_notification_jobs n
    set status = 'sending', attempts = n.attempts + 1, last_error = null, claimed_at = now()
    from due where n.id = due.id
    returning n.id, n.project_id, n.message_id, n.recipient_email, n.attempts
  )
  select * from claimed;
end;
$$;

revoke all on function public.claim_due_message_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_due_message_notifications(integer) to service_role;

alter table public.client_profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_events enable row level security;
alter table public.project_messages enable row level security;
alter table public.message_notification_jobs enable row level security;
alter table public.project_checklist enable row level security;
alter table public.quotes enable row level security;
alter table public.payment_providers enable row level security;
alter table public.invoices enable row level security;
alter table public.payment_attempts enable row level security;
alter table public.payment_events enable row level security;
alter table public.project_files enable row level security;

create policy "profiles_read_self_or_owner" on public.client_profiles for select to authenticated
using (id = (select auth.uid()) or (select public.is_client_desk_owner()));
create policy "profiles_update_own_name" on public.client_profiles for update to authenticated
using (id = (select auth.uid()) and role = 'customer')
with check (id = (select auth.uid()) and role = 'customer');

create policy "projects_read_customer_or_owner" on public.projects for select to authenticated
using (customer_id = (select auth.uid()) or (select public.is_client_desk_owner()));
create policy "projects_update_owner_only" on public.projects for update to authenticated
using ((select public.is_client_desk_owner()))
with check ((select public.is_client_desk_owner()));

create policy "events_read_visible_participants" on public.project_events for select to authenticated
using (
  (select public.is_client_desk_owner()) or
  (visible_to_customer and exists (select 1 from public.projects p where p.id = project_id and p.customer_id = (select auth.uid())))
);

create policy "messages_read_project_participants" on public.project_messages for select to authenticated
using (
  (select public.is_client_desk_owner()) or
  (not is_internal and exists (select 1 from public.projects p where p.id = project_id and p.customer_id = (select auth.uid())))
);
create policy "messages_add_customer_or_owner" on public.project_messages for insert to authenticated
with check (
  author_id = (select auth.uid()) and (
    ((select public.is_client_desk_owner())) or
    (not is_internal and exists (select 1 from public.projects p where p.id = project_id and p.customer_id = (select auth.uid())))
  )
);

create policy "checklist_read_project_participants" on public.project_checklist for select to authenticated
using (
  (select public.is_client_desk_owner()) or
  (not is_internal and exists (select 1 from public.projects p where p.id = project_id and p.customer_id = (select auth.uid())))
);
create policy "checklist_owner_manage" on public.project_checklist for all to authenticated
using ((select public.is_client_desk_owner()))
with check ((select public.is_client_desk_owner()));

create policy "quotes_read_project_participants" on public.quotes for select to authenticated
using ((select public.is_client_desk_owner()) or (status <> 'draft' and exists (select 1 from public.projects p where p.id = project_id and p.customer_id = (select auth.uid()))));
create policy "providers_read_enabled" on public.payment_providers for select to authenticated
using (is_enabled or (select public.is_client_desk_owner()));
create policy "providers_owner_manage" on public.payment_providers for all to authenticated
using ((select public.is_client_desk_owner()))
with check ((select public.is_client_desk_owner()));

create policy "invoices_read_project_participants" on public.invoices for select to authenticated
using (
  (select public.is_client_desk_owner()) or exists (
    select 1 from public.projects p
    where p.id = invoices.project_id and p.customer_id = (select auth.uid())
      and (
        invoices.status <> 'draft' or exists (
          select 1 from public.quotes q where q.id = invoices.quote_id and q.project_id = invoices.project_id and q.status = 'sent'
        )
      )
  )
);

create policy "attempts_read_invoice_participants" on public.payment_attempts for select to authenticated
using (
  (select public.is_client_desk_owner()) or exists (
    select 1 from public.invoices i join public.projects p on p.id = i.project_id
    where i.id = invoice_id and p.customer_id = (select auth.uid())
  )
);
create policy "files_read_project_participants" on public.project_files for select to authenticated
using (
  (select public.is_client_desk_owner()) or
  (not is_internal and exists (select 1 from public.projects p where p.id = project_id and p.customer_id = (select auth.uid())))
);
create policy "files_add_project_participants" on public.project_files for insert to authenticated
with check (
  uploaded_by = (select auth.uid()) and (
    (select public.is_client_desk_owner()) or
    (not is_internal and exists (select 1 from public.projects p where p.id = project_id and p.customer_id = (select auth.uid())))
  )
);
create policy "files_delete_uploader_or_owner" on public.project_files for delete to authenticated
using ((select public.is_client_desk_owner()) or uploaded_by = (select auth.uid()));

revoke all on public.client_profiles, public.projects, public.project_events, public.project_messages,
  public.project_checklist, public.quotes, public.payment_providers, public.invoices,
  public.message_notification_jobs, public.payment_attempts, public.payment_events, public.project_files
  from public, anon, authenticated;
grant select on public.client_profiles to authenticated;
grant update (display_name) on public.client_profiles to authenticated;
grant select on public.projects to authenticated;
grant update (status, next_action) on public.projects to authenticated;
grant select, insert on public.project_messages to authenticated;
grant select on public.project_events to authenticated;
grant select, insert, update, delete on public.project_checklist to authenticated;
grant select on public.quotes to authenticated;
grant select, update (is_enabled, public_instructions) on public.payment_providers to authenticated;
grant select on public.invoices to authenticated;
grant select on public.payment_attempts to authenticated;
grant select, insert, delete on public.project_files to authenticated;
grant all on public.client_profiles, public.projects, public.project_events, public.project_messages,
  public.message_notification_jobs, public.project_checklist, public.quotes, public.payment_providers, public.invoices,
  public.payment_attempts, public.payment_events, public.project_files to service_role;

insert into public.payment_providers (provider, label, is_enabled, public_instructions)
values
  ('payfast', 'PayFast', false, ''),
  ('stripe', 'Card payment', false, ''),
  ('eft', 'Manual EFT', false, 'Bank transfer instructions will be provided on the invoice.')
on conflict (provider) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('client-project-files', 'client-project-files', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

create policy "project_files_storage_read_participants" on storage.objects for select to authenticated
using (
  bucket_id = 'client-project-files' and (
    (select public.is_client_desk_owner()) or
    exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(name))[1]
        and p.customer_id = (select auth.uid())
        and not (select public.is_internal_project_file(name))
    )
  )
);
create policy "project_files_storage_add_participants" on storage.objects for insert to authenticated
with check (
  bucket_id = 'client-project-files' and (
    (select public.is_client_desk_owner()) or
    exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(name))[1]
        and p.customer_id = (select auth.uid())
    )
  )
);
create policy "project_files_storage_delete_uploader_or_owner" on storage.objects for delete to authenticated
using (
  bucket_id = 'client-project-files' and (
    (select public.is_client_desk_owner()) or
    (owner_id = (select auth.uid())::text and exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(name))[1] and p.customer_id = (select auth.uid())
    ))
  )
);
