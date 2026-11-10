create or replace function public.create_client_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  orphaned_profile_id uuid;
  replacement_email text;
  incoming_email text := coalesce(new.email, '');
begin
  if incoming_email <> '' then
    select id into orphaned_profile_id
    from public.client_profiles
    where email = incoming_email and id <> new.id
    for update;

    if found then
      if exists (select 1 from auth.users where id = orphaned_profile_id) then
        raise exception 'An active Client Portal profile already uses this email address.';
      end if;

      replacement_email := 'deleted+' || replace(orphaned_profile_id::text, '-', '') || '@deleted.invalid';
      update public.client_profiles
      set email = replacement_email,
          display_name = 'Deleted customer',
          role = 'deleted',
          updated_at = now()
      where id = orphaned_profile_id;

      update public.message_notification_jobs
      set recipient_email = replacement_email,
          status = case when status = 'sent' then 'sent' else 'failed' end,
          claimed_at = null,
          retry_at = null,
          last_error = null
      where recipient_email = incoming_email;
    end if;
  end if;

  insert into public.client_profiles (id, email, display_name)
  values (new.id, incoming_email, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;
