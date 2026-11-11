create table if not exists public.staff_payment_disputes (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.client_profiles(id) on delete restrict,
  payment_reference text check (payment_reference is null or char_length(payment_reference) <= 120),
  period_start date not null,
  period_end date not null,
  amount_claimed_minor bigint check (amount_claimed_minor is null or amount_claimed_minor > 0),
  currency text not null default 'ZAR' check (currency = 'ZAR'),
  issue_details text not null check (char_length(trim(issue_details)) between 1 and 3000),
  status text not null default 'open' check (status in ('open', 'under_review', 'resolved')),
  resolution_note text check (resolution_note is null or char_length(trim(resolution_note)) <= 2000),
  reviewed_by uuid references public.client_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (period_end >= period_start),
  check ((status = 'resolved') = (resolved_at is not null))
);

create index if not exists staff_payment_disputes_employee_created_idx
  on public.staff_payment_disputes(employee_id, created_at desc);
create index if not exists staff_payment_disputes_status_created_idx
  on public.staff_payment_disputes(status, created_at desc);

alter table public.staff_payment_disputes enable row level security;
revoke all on public.staff_payment_disputes from public, anon, authenticated;
grant select on public.staff_payment_disputes to authenticated;
grant insert (employee_id, payment_reference, period_start, period_end, amount_claimed_minor, currency, issue_details)
  on public.staff_payment_disputes to authenticated;
grant all on public.staff_payment_disputes to service_role;

create policy "staff_payment_disputes_read_employee_or_owner"
on public.staff_payment_disputes for select to authenticated
using (
  (select public.is_client_desk_owner())
  or (
    employee_id = (select auth.uid())
    and exists (
      select 1 from public.client_profiles profile
      where profile.id = (select auth.uid()) and profile.role = 'freelancer'
    )
  )
);

create policy "staff_payment_disputes_create_own"
on public.staff_payment_disputes for insert to authenticated
with check (
  employee_id = (select auth.uid())
  and status = 'open'
  and reviewed_by is null
  and resolution_note is null
  and resolved_at is null
  and exists (
    select 1 from public.client_profiles profile
    where profile.id = (select auth.uid()) and profile.role = 'freelancer'
  )
);

create or replace function public.audit_staff_payment_dispute()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.client_desk_audit_log (actor_id, action, details)
  values (
    new.employee_id,
    'staff_payment_dispute_submitted',
    jsonb_build_object(
      'dispute_id', new.id,
      'period_start', new.period_start,
      'period_end', new.period_end,
      'payment_reference', new.payment_reference,
      'amount_claimed_minor', new.amount_claimed_minor
    )
  );
  return new;
end;
$$;

revoke all on function public.audit_staff_payment_dispute() from public, anon, authenticated;

drop trigger if exists staff_payment_dispute_audit_insert on public.staff_payment_disputes;
create trigger staff_payment_dispute_audit_insert
after insert on public.staff_payment_disputes
for each row execute function public.audit_staff_payment_dispute();

create or replace function public.owner_review_staff_payment_dispute(
  p_dispute_id uuid,
  p_status text,
  p_resolution_note text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  note text := nullif(trim(p_resolution_note), '');
begin
  if not (select public.is_client_desk_owner()) then
    raise exception 'Admin access is required.';
  end if;
  if p_status is null or p_status not in ('under_review', 'resolved') then
    raise exception 'Choose Under Review or Resolved.';
  end if;
  if note is null or char_length(note) > 2000 then
    raise exception 'Enter a management note of up to 2,000 characters.';
  end if;

  update public.staff_payment_disputes
  set status = p_status,
      resolution_note = note,
      reviewed_by = (select auth.uid()),
      updated_at = now(),
      resolved_at = case when p_status = 'resolved' then now() else null end
  where id = p_dispute_id;
  if not found then raise exception 'Payment query not found.'; end if;

  insert into public.client_desk_audit_log (actor_id, action, details)
  values (
    (select auth.uid()),
    'staff_payment_dispute_reviewed',
    jsonb_build_object('dispute_id', p_dispute_id, 'status', p_status)
  );
end;
$$;

revoke all on function public.owner_review_staff_payment_dispute(uuid, text, text) from public, anon;
grant execute on function public.owner_review_staff_payment_dispute(uuid, text, text) to authenticated;

do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'staff_payment_disputes'
  ) then
    alter publication supabase_realtime add table public.staff_payment_disputes;
  end if;
end;
$$;
