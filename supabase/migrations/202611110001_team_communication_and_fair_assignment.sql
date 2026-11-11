create table if not exists public.team_messages (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.client_profiles(id) on delete restrict,
  author_display_name text not null default '',
  body text not null check (char_length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists team_messages_created_at_idx
  on public.team_messages(created_at desc);

alter table public.team_messages enable row level security;
revoke all on public.team_messages from public, anon, authenticated;
grant select on public.team_messages to authenticated;
grant insert (author_id, body) on public.team_messages to authenticated;

create policy "team_messages_read_staff"
on public.team_messages for select to authenticated
using (
  exists (
    select 1 from public.client_profiles profile
    where profile.id = (select auth.uid())
      and profile.role in ('owner', 'freelancer')
  )
);

create policy "team_messages_add_staff"
on public.team_messages for insert to authenticated
with check (
  author_id = (select auth.uid())
  and exists (
    select 1 from public.client_profiles profile
    where profile.id = (select auth.uid())
      and profile.role in ('owner', 'freelancer')
  )
);

create or replace function public.set_team_message_author()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  select coalesce(nullif(trim(profile.display_name), ''), profile.email)
  into new.author_display_name
  from public.client_profiles profile
  where profile.id = new.author_id;
  if not found then raise exception 'An active staff profile is required.'; end if;
  return new;
end;
$$;

revoke all on function public.set_team_message_author() from public, anon, authenticated;

drop trigger if exists team_messages_set_author on public.team_messages;
create trigger team_messages_set_author
before insert on public.team_messages
for each row execute function public.set_team_message_author();

create table if not exists public.client_desk_settings (
  setting_key text primary key check (setting_key = 'portal'),
  automatic_assignment_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.client_profiles(id) on delete set null
);

insert into public.client_desk_settings (setting_key)
values ('portal')
on conflict (setting_key) do nothing;

alter table public.client_desk_settings enable row level security;
revoke all on public.client_desk_settings from public, anon, authenticated;
grant select on public.client_desk_settings to authenticated;

create policy "client_desk_settings_read_owner"
on public.client_desk_settings for select to authenticated
using ((select public.is_client_desk_owner()));

create table if not exists public.client_desk_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.client_profiles(id) on delete set null,
  action text not null check (char_length(action) between 1 and 120),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists client_desk_audit_log_created_at_idx
  on public.client_desk_audit_log(created_at desc);

alter table public.client_desk_audit_log enable row level security;
revoke all on public.client_desk_audit_log from public, anon, authenticated;
grant select on public.client_desk_audit_log to authenticated;

create policy "client_desk_audit_log_read_owner"
on public.client_desk_audit_log for select to authenticated
using ((select public.is_client_desk_owner()));

create or replace function public.owner_set_automatic_assignment(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  scheduled boolean := false;
begin
  if not (select public.is_client_desk_owner()) then
    raise exception 'Admin access is required.';
  end if;
  if p_enabled is null then
    raise exception 'Choose whether automatic assignment should be enabled.';
  end if;

  if p_enabled and to_regnamespace('cron') is not null then
    execute
      'select exists (select 1 from cron.job where jobname = $1)'
      into scheduled
      using 'client-desk-stale-request-assignment';
  end if;

  if p_enabled and not scheduled then
    raise exception 'Automatic assignment is unavailable because its hourly Supabase schedule is not configured.';
  end if;

  update public.client_desk_settings
  set automatic_assignment_enabled = p_enabled,
      updated_at = now(),
      updated_by = (select auth.uid())
  where setting_key = 'portal';

  insert into public.client_desk_audit_log (actor_id, action, details)
  values (
    (select auth.uid()),
    'automatic_assignment_setting_changed',
    jsonb_build_object('enabled', p_enabled)
  );
end;
$$;

revoke all on function public.owner_set_automatic_assignment(boolean) from public, anon;
grant execute on function public.owner_set_automatic_assignment(boolean) to authenticated;

alter table public.project_team_members
  alter column assigned_by drop not null;

alter table public.project_team_members
  add column if not exists assigned_via text not null default 'manual'
  check (assigned_via in ('manual', 'automatic'));

create or replace function public.auto_assign_stale_client_requests()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  request_row record;
  selected_staff_id uuid;
  selected_staff_name text;
  selected_step_id uuid;
  assignment_count integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('client-desk-stale-request-assignment')) then
    return 0;
  end if;

  if not exists (
    select 1 from public.client_desk_settings
    where setting_key = 'portal' and automatic_assignment_enabled
  ) then
    return 0;
  end if;

  for request_row in
    select project.id
    from public.projects project
    where project.status = 'received'
      and project.created_at <= now() - interval '24 hours'
      and not exists (
        select 1 from public.project_team_members team
        where team.project_id = project.id
      )
    order by project.created_at, project.id
    for update of project skip locked
  loop
    select profile.id, coalesce(nullif(trim(profile.display_name), ''), profile.email)
    into selected_staff_id, selected_staff_name
    from public.client_profiles profile
    where profile.role = 'freelancer'
    order by
      (
        select count(*)
        from public.project_steps step
        where step.owner_id = profile.id
          and step.status <> 'done'
          and exists (
            select 1 from public.project_team_members team
            where team.project_id = step.project_id and team.user_id = profile.id
          )
      ),
      (
        select max(team.assigned_at)
        from public.project_team_members team
        where team.user_id = profile.id
      ) nulls first,
      profile.id
    limit 1;

    if selected_staff_id is null then
      exit;
    end if;

    insert into public.project_team_members (project_id, user_id, assigned_by, assigned_via)
    values (request_row.id, selected_staff_id, null, 'automatic')
    on conflict (project_id, user_id) do nothing;

    select step.id into selected_step_id
    from public.project_steps step
    join public.project_stages stage on stage.id = step.stage_id
    where step.project_id = request_row.id and step.status <> 'done'
    order by stage.position, step.position
    limit 1;

    if selected_step_id is not null then
      update public.project_steps
      set owner_id = selected_staff_id,
          owner_display_name = selected_staff_name,
          updated_at = now()
      where id = selected_step_id;
    else
      insert into public.project_events (project_id, actor_id, event_type, title, description, visible_to_customer)
      values (
        request_row.id,
        null,
        'automatic_assignment',
        'Project team assigned',
        'The request was assigned to ' || selected_staff_name || ' using the fair workload rotation.',
        true
      );
    end if;

    insert into public.client_desk_audit_log (actor_id, action, details)
    values (
      null,
      'client_request_automatically_assigned',
      jsonb_build_object(
        'project_id', request_row.id,
        'staff_id', selected_staff_id,
        'step_id', selected_step_id,
        'rule', 'fewest_open_tasks_then_least_recently_assigned'
      )
    );

    assignment_count := assignment_count + 1;
    selected_staff_id := null;
    selected_staff_name := null;
    selected_step_id := null;
  end loop;

  return assignment_count;
end;
$$;

revoke all on function public.auto_assign_stale_client_requests() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron';
    if to_regnamespace('cron') is not null then
      execute $schedule$
        select cron.unschedule(jobid)
        from cron.job
        where jobname = 'client-desk-stale-request-assignment'
      $schedule$;
      execute $schedule$
        select cron.schedule(
          'client-desk-stale-request-assignment',
          '0 * * * *',
          'select public.auto_assign_stale_client_requests()'
        )
      $schedule$;
    end if;
  else
    raise notice 'pg_cron is not available; enable it in Supabase before enabling automatic assignment.';
  end if;
end;
$$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'team_messages'
     ) then
    alter publication supabase_realtime add table public.team_messages;
  end if;
end;
$$;
