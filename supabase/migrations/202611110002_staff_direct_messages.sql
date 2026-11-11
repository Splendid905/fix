alter table public.team_messages
  add column if not exists recipient_id uuid references public.client_profiles(id) on delete cascade;

grant insert (recipient_id) on public.team_messages to authenticated;

drop policy if exists "team_messages_read_staff" on public.team_messages;
create policy "team_messages_read_participant_staff"
on public.team_messages for select to authenticated
using (
  (recipient_id is null or author_id = (select auth.uid()) or recipient_id = (select auth.uid()))
  and exists (
    select 1 from public.client_profiles profile
    where profile.id = (select auth.uid())
      and profile.role in ('owner', 'freelancer')
  )
);

drop policy if exists "team_messages_add_staff" on public.team_messages;
create policy "team_messages_add_staff"
on public.team_messages for insert to authenticated
with check (
  author_id = (select auth.uid())
  and exists (
    select 1 from public.client_profiles profile
    where profile.id = (select auth.uid())
      and profile.role in ('owner', 'freelancer')
  )
  and (
    recipient_id is null
    or (
      recipient_id <> (select auth.uid())
      and exists (
        select 1 from public.client_profiles recipient
        where recipient.id = recipient_id
          and recipient.role in ('owner', 'freelancer')
      )
    )
  )
);

create or replace function public.set_team_message_author()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  author_role text;
begin
  select coalesce(nullif(trim(profile.display_name), ''), profile.email), profile.role
  into new.author_display_name, author_role
  from public.client_profiles profile
  where profile.id = new.author_id;
  if not found or author_role not in ('owner', 'freelancer') then
    raise exception 'An active staff profile is required.';
  end if;

  if new.recipient_id is not null and not exists (
    select 1 from public.client_profiles recipient
    where recipient.id = new.recipient_id
      and recipient.role in ('owner', 'freelancer')
  ) then
    raise exception 'Choose an active staff member for a private message.';
  end if;

  return new;
end;
$$;

create or replace function public.get_team_directory()
returns table (id uuid, display_name text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.client_profiles profile
    where profile.id = (select auth.uid())
      and profile.role in ('owner', 'freelancer')
  ) then
    raise exception 'Staff access is required.';
  end if;

  return query
  select profile.id,
         coalesce(nullif(trim(profile.display_name), ''), 'Team member')::text
  from public.client_profiles profile
  where profile.role in ('owner', 'freelancer')
    and profile.id <> (select auth.uid())
  order by coalesce(nullif(trim(profile.display_name), ''), profile.email);
end;
$$;

revoke all on function public.get_team_directory() from public, anon;
grant execute on function public.get_team_directory() to authenticated;
