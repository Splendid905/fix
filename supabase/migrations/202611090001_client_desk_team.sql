alter table public.client_profiles
  drop constraint if exists client_profiles_role_check;

alter table public.client_profiles
  add constraint client_profiles_role_check
  check (role in ('customer', 'freelancer', 'owner'));

create table if not exists public.project_team_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.client_profiles(id) on delete cascade,
  assigned_by uuid not null references public.client_profiles(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index if not exists project_team_members_user_project_idx
  on public.project_team_members(user_id, project_id);

create or replace function public.is_project_freelancer(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.project_team_members tm
    join public.client_profiles cp on cp.id = tm.user_id
    where tm.project_id = p_project_id
      and tm.user_id = (select auth.uid())
      and cp.role = 'freelancer'
  );
$$;

revoke all on function public.is_project_freelancer(uuid) from public, anon;
grant execute on function public.is_project_freelancer(uuid) to authenticated, service_role;

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
  where id = p_user_id and role <> 'owner';
  if not found then
    raise exception 'Account not found or cannot be changed.';
  end if;

  if p_role = 'customer' then
    delete from public.project_team_members where user_id = p_user_id;
  end if;
end;
$$;

revoke all on function public.owner_set_freelancer_role(uuid, text) from public, anon;
grant execute on function public.owner_set_freelancer_role(uuid, text) to authenticated;

create or replace function public.owner_set_project_team(p_project_id uuid, p_freelancer_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  freelancer_ids uuid[] := coalesce(p_freelancer_ids, '{}'::uuid[]);
begin
  if not (select public.is_client_desk_owner()) then
    raise exception 'Admin access is required.';
  end if;
  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'Project not found.';
  end if;
  if exists (
    select 1
    from unnest(freelancer_ids) selected(user_id)
    left join public.client_profiles cp on cp.id = selected.user_id
    where cp.id is null or cp.role <> 'freelancer'
  ) then
    raise exception 'Every assigned account must have freelancer access.';
  end if;

  delete from public.project_team_members where project_id = p_project_id;
  insert into public.project_team_members (project_id, user_id, assigned_by)
  select p_project_id, selected.user_id, (select auth.uid())
  from (select distinct unnest(freelancer_ids) as user_id) selected;
end;
$$;

revoke all on function public.owner_set_project_team(uuid, uuid[]) from public, anon;
grant execute on function public.owner_set_project_team(uuid, uuid[]) to authenticated;

create or replace function public.log_project_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status is distinct from new.status then
    insert into public.project_events (project_id, actor_id, event_type, title, description, visible_to_customer)
    values (new.id, (select auth.uid()), 'status', 'Status updated', replace(new.status, '_', ' '), true);
  end if;
  if old.next_action is distinct from new.next_action then
    insert into public.project_events (project_id, actor_id, event_type, title, description, visible_to_customer)
    values (new.id, (select auth.uid()), 'next_action', 'Next step updated', coalesce(new.next_action, 'No next action set'), true);
  end if;
  return new;
end;
$$;

alter table public.project_team_members enable row level security;

drop policy if exists "project_team_read_owner_or_member" on public.project_team_members;
create policy "project_team_read_owner_or_member" on public.project_team_members for select to authenticated
using ((select public.is_client_desk_owner()) or user_id = (select auth.uid()));

drop policy if exists "profiles_update_own_name" on public.client_profiles;
create policy "profiles_update_own_name" on public.client_profiles for update to authenticated
using (id = (select auth.uid()) and role in ('customer', 'freelancer'))
with check (id = (select auth.uid()) and role in ('customer', 'freelancer'));

drop policy if exists "projects_read_customer_or_owner" on public.projects;
create policy "projects_read_customer_owner_or_freelancer" on public.projects for select to authenticated
using (
  customer_id = (select auth.uid()) or
  (select public.is_client_desk_owner()) or
  (select public.is_project_freelancer(id))
);

drop policy if exists "projects_update_owner_only" on public.projects;
create policy "projects_update_owner_or_assigned_freelancer" on public.projects for update to authenticated
using ((select public.is_client_desk_owner()) or (select public.is_project_freelancer(id)))
with check ((select public.is_client_desk_owner()) or (select public.is_project_freelancer(id)));

drop policy if exists "events_read_visible_participants" on public.project_events;
create policy "events_read_visible_participants" on public.project_events for select to authenticated
using (
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
);

drop policy if exists "messages_read_project_participants" on public.project_messages;
create policy "messages_read_project_participants" on public.project_messages for select to authenticated
using (
  (select public.is_client_desk_owner()) or
  (
    not is_internal and (
      exists (select 1 from public.projects p where p.id = project_id and p.customer_id = (select auth.uid())) or
      (select public.is_project_freelancer(project_id))
    )
  )
);

drop policy if exists "messages_add_customer_or_owner" on public.project_messages;
create policy "messages_add_customer_owner_or_freelancer" on public.project_messages for insert to authenticated
with check (
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
  (select public.is_client_desk_owner()) or
  (
    not is_internal and (
      exists (select 1 from public.projects p where p.id = project_id and p.customer_id = (select auth.uid())) or
      (select public.is_project_freelancer(project_id))
    )
  )
);

drop policy if exists "quotes_read_project_participants" on public.quotes;
create policy "quotes_read_project_participants" on public.quotes for select to authenticated
using (
  (select public.is_client_desk_owner()) or
  (status <> 'draft' and exists (
    select 1 from public.projects p
    where p.id = quotes.project_id and p.customer_id = (select auth.uid())
  )
  )
);

drop policy if exists "files_read_project_participants" on public.project_files;
create policy "files_read_project_participants" on public.project_files for select to authenticated
using (
  (select public.is_client_desk_owner()) or
  (
    not is_internal and exists (
      select 1 from public.projects p
      where p.id = project_id and (
        p.customer_id = (select auth.uid()) or
        (select public.is_project_freelancer(p.id))
      )
    )
  )
);

drop policy if exists "files_add_project_participants" on public.project_files;
create policy "files_add_project_participants" on public.project_files for insert to authenticated
with check (
  uploaded_by = (select auth.uid()) and (
    (select public.is_client_desk_owner()) or
    (
      not is_internal and exists (
        select 1 from public.projects p
        where p.id = project_id and (
          p.customer_id = (select auth.uid()) or
          (select public.is_project_freelancer(p.id))
        )
      )
    )
  )
);

drop policy if exists "project_files_storage_read_participants" on storage.objects;
create policy "project_files_storage_read_participants" on storage.objects for select to authenticated
using (
  bucket_id = 'client-project-files' and (
    (select public.is_client_desk_owner()) or
    exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(name))[1]
        and (
          p.customer_id = (select auth.uid()) or
          (select public.is_project_freelancer(p.id))
        )
        and not (select public.is_internal_project_file(name))
    )
  )
);

drop policy if exists "project_files_storage_add_participants" on storage.objects;
create policy "project_files_storage_add_participants" on storage.objects for insert to authenticated
with check (
  bucket_id = 'client-project-files' and (
    (select public.is_client_desk_owner()) or
    exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(name))[1]
        and (
          p.customer_id = (select auth.uid()) or
          (select public.is_project_freelancer(p.id))
        )
    )
  )
);

drop policy if exists "project_files_storage_delete_uploader_or_owner" on storage.objects;
create policy "project_files_storage_delete_uploader_or_owner" on storage.objects for delete to authenticated
using (
  bucket_id = 'client-project-files' and (
    (select public.is_client_desk_owner()) or
    (
      owner_id = (select auth.uid())::text and exists (
        select 1 from public.projects p
        where p.id::text = (storage.foldername(name))[1]
          and (
            p.customer_id = (select auth.uid()) or
            (select public.is_project_freelancer(p.id))
          )
      )
    )
  )
);

revoke all on public.project_team_members from public, anon, authenticated;
grant select on public.project_team_members to authenticated;

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
  if author_role in ('owner', 'freelancer') then
    insert into public.message_notification_jobs (project_id, message_id, recipient_email)
    values (new.project_id, new.id, customer_profile.email);
  else
    insert into public.message_notification_jobs (project_id, message_id, recipient_email)
    select new.project_id, new.id, cp.email from public.client_profiles cp where cp.role = 'owner';
  end if;
  return new;
end;
$$;
