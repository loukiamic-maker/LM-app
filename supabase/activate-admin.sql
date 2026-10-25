-- Run only in the privileged Supabase SQL Editor, never from a browser.
-- First create and confirm the intended administrator's website account.
-- Replace the email below with that account's exact email address.
begin;
do $admin$
declare
  target_email constant text := lower('REPLACE_WITH_VERIFIED_ADMIN_EMAIL');
  target_id uuid;
  confirmed_at timestamptz;
  matches integer;
begin
  if target_email not like '%@%.%' then
    raise exception 'Replace REPLACE_WITH_VERIFIED_ADMIN_EMAIL before running this query';
  end if;
  select count(*) into matches from auth.users where lower(email) = target_email;
  if matches <> 1 then
    raise exception 'Expected exactly one account for this email; create and confirm the website account first';
  end if;
  select id, email_confirmed_at into target_id, confirmed_at
    from auth.users where lower(email) = target_email for update;
  if confirmed_at is null then
    raise exception 'Confirm this website account using its email confirmation link before granting administrator access';
  end if;
  update auth.users
    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
    where id = target_id;
  raise notice 'Administrator access assigned; sign in again or use Refresh access on the administration page';
end
$admin$;
commit;
