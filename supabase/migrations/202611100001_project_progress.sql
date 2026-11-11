create table if not exists public.project_stage_templates (
  stage_key text primary key,
  title text not null,
  position integer not null unique check (position >= 0)
);

create table if not exists public.project_step_templates (
  stage_key text not null references public.project_stage_templates(stage_key) on delete cascade,
  step_key text not null,
  title text not null,
  position integer not null check (position >= 0),
  primary key (stage_key, step_key),
  unique (stage_key, position)
);

insert into public.project_stage_templates (stage_key, title, position)
values
  ('discovery', 'Discovery', 0),
  ('design', 'Design', 1),
  ('development', 'Development', 2),
  ('content', 'Content', 3),
  ('testing', 'Testing / QA', 4),
  ('launch', 'Launch', 5),
  ('support', 'Post-launch Support', 6)
on conflict (stage_key) do update
set title = excluded.title, position = excluded.position;

insert into public.project_step_templates (stage_key, step_key, title, position)
values
  ('discovery', 'brief', 'Confirm goals and project brief', 0),
  ('discovery', 'scope', 'Agree scope and deliverables', 1),
  ('design', 'wireframes', 'Prepare page wireframes', 0),
  ('design', 'visual-design', 'Create visual design', 1),
  ('design', 'design-review', 'Review and approve design', 2),
  ('development', 'build', 'Build agreed pages and features', 0),
  ('development', 'responsive', 'Check responsive layouts', 1),
  ('content', 'assets', 'Collect content and brand assets', 0),
  ('content', 'add-content', 'Add and format approved content', 1),
  ('testing', 'functional-qa', 'Test forms, links, and key features', 0),
  ('testing', 'quality-review', 'Review accessibility and mobile layout', 1),
  ('launch', 'domain', 'Confirm domain and launch settings', 0),
  ('launch', 'publish', 'Publish the approved website', 1),
  ('support', 'launch-check', 'Complete post-launch checks', 0),
  ('support', 'handover', 'Share handover and support details', 1)
on conflict (stage_key, step_key) do update
set title = excluded.title, position = excluded.position;

create table if not exists public.project_stages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  stage_key text not null references public.project_stage_templates(stage_key),
  title text not null,
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, stage_key),
  unique (project_id, position),
  unique (id, project_id)
);

create table if not exists public.project_steps (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  stage_id uuid not null,
  title text not null check (char_length(title) between 1 and 240),
  position integer not null check (position >= 0),
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'in_review', 'done')),
  owner_id uuid references public.client_profiles(id) on delete set null,
  owner_display_name text not null default '',
  due_at timestamptz,
  completed_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.client_profiles(id) on delete set null,
  review_feedback text check (review_feedback is null or char_length(review_feedback) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (stage_id, project_id) references public.project_stages(id, project_id) on delete cascade,
  unique (stage_id, position)
);

create index if not exists project_stages_project_position_idx
  on public.project_stages(project_id, position);
create index if not exists project_steps_project_stage_position_idx
  on public.project_steps(project_id, stage_id, position);
create index if not exists project_steps_owner_status_idx
  on public.project_steps(owner_id, status);

alter table public.project_stage_templates enable row level security;
alter table public.project_step_templates enable row level security;
alter table public.project_stages enable row level security;
alter table public.project_steps enable row level security;

revoke all on public.project_stage_templates, public.project_step_templates from public, anon, authenticated;
revoke all on public.project_stages, public.project_steps from public, anon, authenticated;
grant select on public.project_stages, public.project_steps to authenticated;
grant all on public.project_stage_templates, public.project_step_templates,
  public.project_stages, public.project_steps to service_role;

create policy "project_stages_read_project_participants"
on public.project_stages for select to authenticated
using (
  (select public.is_client_desk_active()) and (
    (select public.is_client_desk_owner()) or
    exists (select 1 from public.projects p where p.id = project_id and p.customer_id = (select auth.uid())) or
    (select public.is_project_freelancer(project_id))
  )
);

create policy "project_steps_read_project_participants"
on public.project_steps for select to authenticated
using (
  (select public.is_client_desk_active()) and (
    (select public.is_client_desk_owner()) or
    exists (select 1 from public.projects p where p.id = project_id and p.customer_id = (select auth.uid())) or
    (select public.is_project_freelancer(project_id))
  )
);

create or replace function public.create_project_progress(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.project_stages (project_id, stage_key, title, position)
  select p_project_id, template.stage_key, template.title, template.position
  from public.project_stage_templates template
  on conflict (project_id, stage_key) do nothing;

  insert into public.project_steps (project_id, stage_id, title, position)
  select p_project_id, stage.id, step.title, step.position
  from public.project_stages stage
  join public.project_step_templates step on step.stage_key = stage.stage_key
  where stage.project_id = p_project_id
  on conflict (stage_id, position) do nothing;
end;
$$;

revoke all on function public.create_project_progress(uuid) from public, anon, authenticated;
grant execute on function public.create_project_progress(uuid) to service_role;

create or replace function public.seed_project_progress()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.create_project_progress(new.id);
  return new;
end;
$$;

revoke all on function public.seed_project_progress() from public, anon, authenticated;

drop trigger if exists projects_seed_progress on public.projects;
create trigger projects_seed_progress after insert on public.projects
for each row execute function public.seed_project_progress();

select public.create_project_progress(project.id)
from public.projects project
where not exists (
  select 1 from public.project_stages stage where stage.project_id = project.id
);

create or replace function public.audit_project_step_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  event_title text;
  event_description text;
  actor_role text;
begin
  if old.status is not distinct from new.status
     and old.owner_id is not distinct from new.owner_id
     and old.owner_display_name is not distinct from new.owner_display_name
     and old.due_at is not distinct from new.due_at
     and old.review_feedback is not distinct from new.review_feedback then
    return new;
  end if;

  select profile.role into actor_role
  from public.client_profiles profile
  where profile.id = (select auth.uid());

  if new.status is distinct from old.status then
    if actor_role = 'customer' and new.status = 'done' then
      event_title := 'Deliverable approved';
    elsif actor_role = 'customer' and old.status = 'in_review' and new.status = 'in_progress' then
      event_title := 'Changes requested';
    elsif new.status = 'in_review' then
      event_title := 'Ready for review';
    elsif new.status = 'done' then
      event_title := 'Step completed';
    else
      event_title := 'Project step updated';
    end if;
    event_description := new.title;
  elsif new.owner_id is distinct from old.owner_id
        or new.owner_display_name is distinct from old.owner_display_name then
    event_title := 'Project step reassigned';
    event_description := new.title || ' — ' ||
      case when new.owner_display_name = '' then 'Unassigned' else 'Assigned to ' || new.owner_display_name end;
  elsif new.due_at is distinct from old.due_at then
    event_title := 'Project step schedule updated';
    event_description := new.title;
  else
    event_title := 'Review feedback added';
    event_description := new.title;
  end if;

  if new.review_feedback is distinct from old.review_feedback and new.review_feedback is not null then
    event_description := event_description || ' — ' || new.review_feedback;
  end if;

  insert into public.project_events (project_id, actor_id, event_type, title, description, visible_to_customer)
  values (new.project_id, (select auth.uid()), 'project_step', event_title, event_description, true);

  update public.projects set updated_at = now() where id = new.project_id;
  return new;
end;
$$;

revoke all on function public.audit_project_step_change() from public, anon, authenticated;

drop trigger if exists project_steps_audit_change on public.project_steps;
create trigger project_steps_audit_change after update on public.project_steps
for each row execute function public.audit_project_step_change();

create or replace function public.update_project_step(p_step_id uuid, p_status text, p_feedback text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  step_row public.project_steps%rowtype;
  project_customer uuid;
  actor_role text;
  feedback text := nullif(trim(p_feedback), '');
begin
  if (select auth.uid()) is null then raise exception 'Authentication required.'; end if;
  if p_status not in ('not_started', 'in_progress', 'in_review', 'done') then
    raise exception 'Invalid project step status.';
  end if;
  if feedback is not null and char_length(feedback) > 1000 then
    raise exception 'Review feedback must be 1000 characters or fewer.';
  end if;

  select step.* into step_row
  from public.project_steps step
  where step.id = p_step_id
  for update;
  if not found then raise exception 'Project step not found.'; end if;

  select project.customer_id into project_customer
  from public.projects project
  where project.id = step_row.project_id;

  select profile.role into actor_role
  from public.client_profiles profile
  where profile.id = (select auth.uid());

  if actor_role = 'owner' then
    null;
  elsif actor_role = 'freelancer'
        and (select public.is_project_freelancer(step_row.project_id))
        and p_status in ('not_started', 'in_progress', 'in_review') then
    null;
  elsif actor_role = 'customer'
        and project_customer = (select auth.uid())
        and step_row.status = 'in_review'
        and p_status in ('done', 'in_progress') then
    if p_status = 'in_progress' and feedback is null then
      raise exception 'Add a short note describing the changes you need.';
    end if;
  else
    raise exception 'You are not allowed to update this project step.';
  end if;

  update public.project_steps
  set status = p_status,
      completed_at = case when p_status = 'done' then coalesce(completed_at, now()) else null end,
      reviewed_at = case when actor_role = 'customer' then now() else reviewed_at end,
      reviewed_by = case when actor_role = 'customer' then (select auth.uid()) else reviewed_by end,
      review_feedback = case
        when actor_role = 'customer' and p_status = 'in_progress' then feedback
        when p_status = 'done' then null
        else review_feedback
      end,
      updated_at = now()
  where id = p_step_id;
end;
$$;

revoke all on function public.update_project_step(uuid, text, text) from public, anon;
grant execute on function public.update_project_step(uuid, text, text) to authenticated;

create or replace function public.owner_assign_project_step(
  p_step_id uuid,
  p_owner_id uuid default null,
  p_due_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  project_step public.project_steps%rowtype;
  assignee_name text;
begin
  if not (select public.is_client_desk_owner()) then
    raise exception 'Admin access is required.';
  end if;

  select step.* into project_step
  from public.project_steps step
  where step.id = p_step_id
  for update;
  if not found then raise exception 'Project step not found.'; end if;

  if p_owner_id is not null then
    select profile.display_name into assignee_name
    from public.client_profiles profile
    join public.project_team_members team
      on team.user_id = profile.id and team.project_id = project_step.project_id
    where profile.id = p_owner_id and profile.role = 'freelancer';
    if not found then raise exception 'Choose a freelancer assigned to this project.'; end if;
  end if;

  update public.project_steps
  set owner_id = p_owner_id,
      owner_display_name = case
        when p_owner_id is null or coalesce(trim(assignee_name), '') = '' then ''
        else trim(assignee_name)
      end,
      due_at = p_due_at,
      updated_at = now()
  where id = p_step_id;
end;
$$;

revoke all on function public.owner_assign_project_step(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.owner_assign_project_step(uuid, uuid, timestamptz) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'project_steps'
    ) then
      alter publication supabase_realtime add table public.project_steps;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'project_events'
    ) then
      alter publication supabase_realtime add table public.project_events;
    end if;
  end if;
end;
$$;
