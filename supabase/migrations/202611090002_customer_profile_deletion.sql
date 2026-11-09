alter table public.client_profiles
  drop constraint if exists client_profiles_role_check;

alter table public.client_profiles
  add constraint client_profiles_role_check
  check (role in ('customer', 'freelancer', 'owner', 'deleted'));

do $$
declare
  profile_auth_fk record;
begin
  for profile_auth_fk in
    select constraint_row.conname
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.client_profiles'::regclass
      and constraint_row.contype = 'f'
      and constraint_row.confrelid = 'auth.users'::regclass
  loop
    execute format('alter table public.client_profiles drop constraint %I', profile_auth_fk.conname);
  end loop;
end;
$$;

create or replace function public.is_client_desk_active()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.client_profiles
    where id = (select auth.uid())
      and role in ('customer', 'freelancer', 'owner')
  );
$$;

revoke all on function public.is_client_desk_active() from public, anon;
grant execute on function public.is_client_desk_active() to authenticated, service_role;

create or replace function public.owner_set_freelancer_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not (select public.is_client_desk_owner()) then
    raise exception 'Admin access is required.';
  end if;
  if p_role is null or p_role not in ('customer', 'freelancer') then
    raise exception 'Only customer or freelancer access can be assigned.';
  end if;

  update public.client_profiles
  set role = p_role
  where id = p_user_id and role in ('customer', 'freelancer');
  if not found then
    raise exception 'Account not found or cannot be changed.';
  end if;

  if p_role = 'customer' then
    delete from public.project_team_members where user_id = p_user_id;
  end if;
end;
$$;

create or replace function public.anonymize_client_profile(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old_email text;
  replacement_email text := 'deleted+' || replace(p_user_id::text, '-', '') || '@deleted.invalid';
  profile_role text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required.';
  end if;

  select email, role into old_email, profile_role
  from public.client_profiles
  where id = p_user_id
  for update;
  if not found then raise exception 'Client profile not found.'; end if;
  if profile_role not in ('customer', 'deleted') then
    raise exception 'Only customer accounts can be deleted here.';
  end if;

  update public.client_profiles
  set email = replacement_email,
      display_name = 'Deleted customer',
      role = 'deleted',
      updated_at = now()
  where id = p_user_id;

  update public.message_notification_jobs
  set recipient_email = replacement_email,
      status = case when status = 'sent' then 'sent' else 'failed' end,
      claimed_at = null,
      retry_at = null,
      last_error = null
  where recipient_email = old_email;
end;
$$;

revoke all on function public.anonymize_client_profile(uuid) from public, anon, authenticated;
grant execute on function public.anonymize_client_profile(uuid) to service_role;

create or replace function public.sync_client_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.email is distinct from old.email then
    update public.client_profiles
    set email = coalesce(new.email, '')
    where id = new.id and role <> 'deleted';
  end if;
  return new;
end;
$$;

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
  if not (select public.is_client_desk_active()) or (select auth.uid()) is null then
    raise exception 'Active customer access is required.';
  end if;
  if not exists (
    select 1 from public.client_profiles
    where id = (select auth.uid()) and role = 'customer'
  ) then raise exception 'Customer access is required.'; end if;
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

create or replace function public.accept_project_quote(p_quote_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  quote_row public.quotes%rowtype;
begin
  if not (select public.is_client_desk_active()) then
    raise exception 'Active customer access is required.';
  end if;

  select q.* into quote_row
  from public.quotes q join public.projects p on p.id = q.project_id
  where q.id = p_quote_id
    and p.customer_id = (select auth.uid())
    and q.status = 'sent'
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
  insert into public.project_events (project_id, actor_id, event_type, title, description, visible_to_customer)
  values (quote_row.project_id, (select auth.uid()), 'quote_accepted', 'Quote accepted', 'The agreed payment schedule is now active.', true);
end;
$$;

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
  if not (select public.is_client_desk_active()) then
    raise exception 'Active customer access is required.';
  end if;
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

drop policy if exists "profiles_read_self_or_owner" on public.client_profiles;
create policy "profiles_read_self_or_owner" on public.client_profiles for select to authenticated
using (id = (select auth.uid()) or (select public.is_client_desk_owner()));

drop policy if exists "profiles_update_own_name" on public.client_profiles;
create policy "profiles_update_own_name" on public.client_profiles for update to authenticated
using (id = (select auth.uid()) and role in ('customer', 'freelancer'))
with check (id = (select auth.uid()) and role in ('customer', 'freelancer'));

drop policy if exists "projects_read_customer_owner_or_freelancer" on public.projects;
create policy "projects_read_customer_owner_or_freelancer" on public.projects for select to authenticated
using (
  (select public.is_client_desk_active()) and (
    customer_id = (select auth.uid()) or
    (select public.is_client_desk_owner()) or
    (select public.is_project_freelancer(id))
  )
);

drop policy if exists "projects_update_owner_or_assigned_freelancer" on public.projects;
create policy "projects_update_owner_or_assigned_freelancer" on public.projects for update to authenticated
using (
  (select public.is_client_desk_active()) and
  ((select public.is_client_desk_owner()) or (select public.is_project_freelancer(id)))
)
with check (
  (select public.is_client_desk_active()) and
  ((select public.is_client_desk_owner()) or (select public.is_project_freelancer(id)))
);

drop policy if exists "events_read_visible_participants" on public.project_events;
create policy "events_read_visible_participants" on public.project_events for select to authenticated
using (
  (select public.is_client_desk_active()) and (
    (select public.is_client_desk_owner()) or
    (
      visible_to_customer and (
        exists (select 1 from public.projects p where p.id = project_id and p.customer_id = (select auth.uid())) or
        (
          event_type not in ('payment_received', 'duplicate_payment') and
          (select public.is_project_freelancer(project_id))
        )
      )
    )
  )
);

drop policy if exists "messages_read_project_participants" on public.project_messages;
create policy "messages_read_project_participants" on public.project_messages for select to authenticated
using (
  (select public.is_client_desk_active()) and (
    (select public.is_client_desk_owner()) or
    (
      not is_internal and (
        exists (select 1 from public.projects p where p.id = project_id and p.customer_id = (select auth.uid())) or
        (select public.is_project_freelancer(project_id))
      )
    )
  )
);

drop policy if exists "messages_add_customer_owner_or_freelancer" on public.project_messages;
create policy "messages_add_customer_owner_or_freelancer" on public.project_messages for insert to authenticated
with check (
  (select public.is_client_desk_active()) and
  author_id = (select auth.uid()) and (
    (select public.is_client_desk_owner()) or
    (
      not is_internal and (
        exists (select 1 from public.projects p where p.id = project_id and p.customer_id = (select auth.uid())) or
        (select public.is_project_freelancer(project_id))
      )
    )
  )
);

drop policy if exists "checklist_read_project_participants" on public.project_checklist;
create policy "checklist_read_project_participants" on public.project_checklist for select to authenticated
using (
  (select public.is_client_desk_active()) and (
    (select public.is_client_desk_owner()) or
    (
      not is_internal and (
        exists (select 1 from public.projects p where p.id = project_id and p.customer_id = (select auth.uid())) or
        (select public.is_project_freelancer(project_id))
      )
    )
  )
);

drop policy if exists "checklist_owner_manage" on public.project_checklist;
create policy "checklist_owner_manage" on public.project_checklist for all to authenticated
using ((select public.is_client_desk_active()) and (select public.is_client_desk_owner()))
with check ((select public.is_client_desk_active()) and (select public.is_client_desk_owner()));

drop policy if exists "quotes_read_project_participants" on public.quotes;
create policy "quotes_read_project_participants" on public.quotes for select to authenticated
using (
  (select public.is_client_desk_active()) and (
    (select public.is_client_desk_owner()) or
    (
      status <> 'draft' and exists (
        select 1 from public.projects p
        where p.id = quotes.project_id and p.customer_id = (select auth.uid())
      )
    )
  )
);

drop policy if exists "providers_read_enabled" on public.payment_providers;
create policy "providers_read_enabled" on public.payment_providers for select to authenticated
using (
  (select public.is_client_desk_active()) and
  (is_enabled or (select public.is_client_desk_owner()))
);

drop policy if exists "providers_owner_manage" on public.payment_providers;
create policy "providers_owner_manage" on public.payment_providers for all to authenticated
using ((select public.is_client_desk_active()) and (select public.is_client_desk_owner()))
with check ((select public.is_client_desk_active()) and (select public.is_client_desk_owner()));

drop policy if exists "invoices_read_project_participants" on public.invoices;
create policy "invoices_read_project_participants" on public.invoices for select to authenticated
using (
  (select public.is_client_desk_active()) and (
    (select public.is_client_desk_owner()) or exists (
      select 1 from public.projects p
      where p.id = invoices.project_id and p.customer_id = (select auth.uid())
        and (
          invoices.status <> 'draft' or exists (
            select 1 from public.quotes q
            where q.id = invoices.quote_id and q.project_id = invoices.project_id and q.status = 'sent'
          )
        )
    )
  )
);

drop policy if exists "attempts_read_invoice_participants" on public.payment_attempts;
create policy "attempts_read_invoice_participants" on public.payment_attempts for select to authenticated
using (
  (select public.is_client_desk_active()) and (
    (select public.is_client_desk_owner()) or exists (
      select 1 from public.invoices i join public.projects p on p.id = i.project_id
      where i.id = invoice_id and p.customer_id = (select auth.uid())
    )
  )
);

drop policy if exists "files_read_project_participants" on public.project_files;
create policy "files_read_project_participants" on public.project_files for select to authenticated
using (
  (select public.is_client_desk_active()) and (
    (select public.is_client_desk_owner()) or
    (
      not is_internal and exists (
        select 1 from public.projects p where p.id = project_id and (
          p.customer_id = (select auth.uid()) or (select public.is_project_freelancer(p.id))
        )
      )
    )
  )
);

drop policy if exists "files_add_project_participants" on public.project_files;
create policy "files_add_project_participants" on public.project_files for insert to authenticated
with check (
  (select public.is_client_desk_active()) and
  uploaded_by = (select auth.uid()) and (
    (select public.is_client_desk_owner()) or
    (
      not is_internal and exists (
        select 1 from public.projects p where p.id = project_id and (
          p.customer_id = (select auth.uid()) or (select public.is_project_freelancer(p.id))
        )
      )
    )
  )
);

drop policy if exists "files_delete_uploader_or_owner" on public.project_files;
create policy "files_delete_uploader_or_owner" on public.project_files for delete to authenticated
using (
  (select public.is_client_desk_active()) and
  ((select public.is_client_desk_owner()) or uploaded_by = (select auth.uid()))
);

drop policy if exists "project_team_read_owner_or_member" on public.project_team_members;
create policy "project_team_read_owner_or_member" on public.project_team_members for select to authenticated
using (
  (select public.is_client_desk_active()) and
  ((select public.is_client_desk_owner()) or user_id = (select auth.uid()))
);

drop policy if exists "project_files_storage_read_participants" on storage.objects;
create policy "project_files_storage_read_participants" on storage.objects for select to authenticated
using (
  bucket_id = 'client-project-files' and (select public.is_client_desk_active()) and (
    (select public.is_client_desk_owner()) or exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(name))[1]
        and (
          p.customer_id = (select auth.uid()) or (select public.is_project_freelancer(p.id))
        )
        and not (select public.is_internal_project_file(name))
    )
  )
);

drop policy if exists "project_files_storage_add_participants" on storage.objects;
create policy "project_files_storage_add_participants" on storage.objects for insert to authenticated
with check (
  bucket_id = 'client-project-files' and (select public.is_client_desk_active()) and (
    (select public.is_client_desk_owner()) or exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(name))[1]
        and (
          p.customer_id = (select auth.uid()) or (select public.is_project_freelancer(p.id))
        )
    )
  )
);

drop policy if exists "project_files_storage_delete_uploader_or_owner" on storage.objects;
create policy "project_files_storage_delete_uploader_or_owner" on storage.objects for delete to authenticated
using (
  bucket_id = 'client-project-files' and (select public.is_client_desk_active()) and (
    (select public.is_client_desk_owner()) or
    (
      owner_id = (select auth.uid())::text and exists (
        select 1 from public.projects p
        where p.id::text = (storage.foldername(name))[1]
          and (
            p.customer_id = (select auth.uid()) or (select public.is_project_freelancer(p.id))
          )
      )
    )
  )
);
