alter table public.team_messages
  add column if not exists mentioned_user_ids uuid[] not null default '{}';

grant insert (id, mentioned_user_ids) on public.team_messages to authenticated;

create table if not exists public.team_message_mentions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.team_messages(id) on delete cascade,
  mentioned_user_id uuid not null references public.client_profiles(id) on delete cascade,
  author_display_name text not null,
  message_preview text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (message_id, mentioned_user_id)
);

create index if not exists team_message_mentions_recipient_created_idx
  on public.team_message_mentions(mentioned_user_id, created_at desc);

alter table public.team_message_mentions enable row level security;
revoke all on public.team_message_mentions from public, anon, authenticated;
grant select on public.team_message_mentions to authenticated;
grant update (read_at) on public.team_message_mentions to authenticated;

create policy "team_message_mentions_read_recipient"
on public.team_message_mentions for select to authenticated
using (mentioned_user_id = (select auth.uid()));

create policy "team_message_mentions_mark_read"
on public.team_message_mentions for update to authenticated
using (mentioned_user_id = (select auth.uid()))
with check (mentioned_user_id = (select auth.uid()));

create or replace function public.validate_team_message_mentions()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  mentioned_id uuid;
begin
  if cardinality(new.mentioned_user_ids) > 20 then
    raise exception 'A message can mention up to 20 team members.';
  end if;

  if new.recipient_id is not null then
    new.mentioned_user_ids := '{}';
    return new;
  end if;

  foreach mentioned_id in array new.mentioned_user_ids loop
    if mentioned_id is null or mentioned_id = new.author_id or not exists (
      select 1 from public.client_profiles profile
      where profile.id = mentioned_id and profile.role in ('owner', 'freelancer')
    ) then
      raise exception 'Mentions must refer to other active staff members.';
    end if;
  end loop;

  select coalesce(array_agg(distinct mention_id order by mention_id), '{}')
  into new.mentioned_user_ids
  from unnest(new.mentioned_user_ids) as mentions(mention_id);
  return new;
end;
$$;

revoke all on function public.validate_team_message_mentions() from public, anon, authenticated;

drop trigger if exists team_messages_validate_mentions on public.team_messages;
create trigger team_messages_validate_mentions
before insert on public.team_messages
for each row execute function public.validate_team_message_mentions();

create or replace function public.create_team_message_mention_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.recipient_id is null and cardinality(new.mentioned_user_ids) > 0 then
    insert into public.team_message_mentions (
      message_id, mentioned_user_id, author_display_name, message_preview
    )
    select new.id, mentioned_id, new.author_display_name, new.body
    from unnest(new.mentioned_user_ids) as mentions(mentioned_id)
    on conflict (message_id, mentioned_user_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.create_team_message_mention_notifications() from public, anon, authenticated;

drop trigger if exists team_messages_create_mention_notifications on public.team_messages;
create trigger team_messages_create_mention_notifications
after insert on public.team_messages
for each row execute function public.create_team_message_mention_notifications();

create or replace function public.can_access_team_message(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.team_messages message
    join public.client_profiles profile on profile.id = (select auth.uid())
    where message.id = p_message_id
      and profile.role in ('owner', 'freelancer')
      and (
        message.recipient_id is null
        or message.author_id = (select auth.uid())
        or message.recipient_id = (select auth.uid())
      )
  );
$$;

create or replace function public.can_add_team_message_attachment(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.team_messages message
    join public.client_profiles profile on profile.id = (select auth.uid())
    where message.id = p_message_id
      and message.author_id = (select auth.uid())
      and profile.role in ('owner', 'freelancer')
      and message.created_at > now() - interval '30 days'
  );
$$;

revoke all on function public.can_access_team_message(uuid) from public, anon;
revoke all on function public.can_add_team_message_attachment(uuid) from public, anon;
grant execute on function public.can_access_team_message(uuid) to authenticated, service_role;
grant execute on function public.can_add_team_message_attachment(uuid) to authenticated, service_role;

create table if not exists public.team_message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.team_messages(id) on delete cascade,
  uploaded_by uuid not null references public.client_profiles(id) on delete restrict,
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 255),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);

create index if not exists team_message_attachments_expiry_idx
  on public.team_message_attachments(expires_at);

alter table public.team_message_attachments enable row level security;
revoke all on public.team_message_attachments from public, anon, authenticated;
grant select, insert on public.team_message_attachments to authenticated;
grant all on public.team_message_attachments to service_role;

create policy "team_message_attachments_read_participants"
on public.team_message_attachments for select to authenticated
using (
  expires_at > now()
  and (select public.can_access_team_message(message_id))
);

create policy "team_message_attachments_add_message_author"
on public.team_message_attachments for insert to authenticated
with check (
  uploaded_by = (select auth.uid())
  and (select public.can_add_team_message_attachment(message_id))
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'team-message-attachments',
  'team-message-attachments',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

drop policy if exists "team_message_attachments_storage_read_participants" on storage.objects;
create policy "team_message_attachments_storage_read_participants"
on storage.objects for select to authenticated
using (
  bucket_id = 'team-message-attachments'
  and exists (
    select 1 from public.team_message_attachments attachment
    where attachment.storage_path = name
      and attachment.expires_at > now()
      and (select public.can_access_team_message(attachment.message_id))
  )
);

drop policy if exists "team_message_attachments_storage_add_message_author" on storage.objects;
create policy "team_message_attachments_storage_add_message_author"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'team-message-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select public.can_add_team_message_attachment(((storage.foldername(name))[2])::uuid))
);

drop policy if exists "team_message_attachments_storage_delete_uploader_or_owner" on storage.objects;
create policy "team_message_attachments_storage_delete_uploader_or_owner"
on storage.objects for delete to authenticated
using (
  bucket_id = 'team-message-attachments'
  and (
    (select public.is_client_desk_owner())
    or (storage.foldername(name))[1] = (select auth.uid())::text
  )
);
