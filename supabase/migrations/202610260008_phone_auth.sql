-- Eneres 08: staged phone/SMS authentication and verified booking contacts.
-- Install safely before connecting SMS/SMTP. Enforcement stays OFF until a
-- privileged administrator enables private.auth_settings after delivery tests.
-- Existing accounts, appointments, email-login recovery and manual entries remain.
begin;

create table if not exists private.auth_settings (
  singleton boolean primary key default true check(singleton),
  require_verified_booking_phone boolean not null default false
);
insert into private.auth_settings(singleton) values(true) on conflict(singleton) do nothing;
alter table private.auth_settings enable row level security;
revoke all on private.auth_settings from public,anon,authenticated;

create or replace function public.get_auth_requirements() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('require_verified_phone',coalesce((
    select require_verified_booking_phone from private.auth_settings where singleton),false))
$$;
revoke all on function public.get_auth_requirements() from public,anon,authenticated;
grant execute on function public.get_auth_requirements() to anon,authenticated;

-- Supabase Auth may store its trusted phone without a leading plus.
create or replace function private.canonical_auth_phone(p_phone text) returns text
language sql immutable security definer set search_path='' as $$
  select case when btrim(p_phone) ~ '^\+?[1-9][0-9]{7,14}$'
    then '+'||ltrim(btrim(p_phone),'+') else null end
$$;
revoke all on function private.canonical_auth_phone(text) from public,anon,authenticated;

-- Preserve email-first validation and validate a new/first phone identity when
-- the staged phone flow is active. The actual phone comes from Auth, never from
-- editable metadata; phone-less historical accounts are not rewritten.
create or replace function private.require_signup_mobile() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_phone text; v_name text; v_name_json jsonb; v_enabled boolean; v_phone_flow boolean:=false; v_email_flow boolean:=false;
begin
  v_enabled:=coalesce((select require_verified_booking_phone from private.auth_settings where singleton),false);
  if tg_op='INSERT' then
    v_email_flow:=nullif(btrim(new.email),'') is not null;
    v_phone_flow:=v_enabled and nullif(btrim(new.phone),'') is not null;
  else
    v_email_flow:=nullif(btrim(old.email),'') is null and nullif(btrim(new.email),'') is not null;
    v_phone_flow:=v_enabled and nullif(btrim(old.phone),'') is null and nullif(btrim(new.phone),'') is not null;
  end if;
  if not v_email_flow and not v_phone_flow then return new; end if;
  v_phone:=case when v_phone_flow or (v_enabled and private.canonical_auth_phone(new.phone) is not null)
    then private.canonical_auth_phone(new.phone) else btrim(new.raw_user_meta_data->>'mobile_phone') end;
  if v_phone is null or v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'SIGNUP_MOBILE_PHONE_REQUIRED' using errcode='23514';
  end if;
  v_name_json:=new.raw_user_meta_data->'full_name';
  if tg_op='UPDATE' and v_phone_flow and (jsonb_typeof(v_name_json) is distinct from 'string'
    or nullif(btrim(new.raw_user_meta_data->>'full_name'),'') is null) then
    select to_jsonb(p.full_name) into v_name_json from public.profiles p where p.user_id=new.id;
  end if;
  v_name:=v_name_json#>>'{}';
  v_name:=regexp_replace(btrim(v_name),'^[[:space:]]+|[[:space:]]+$','','g');
  if jsonb_typeof(v_name_json) is distinct from 'string' or v_name is null or char_length(v_name) not between 2 and 80 then
    raise exception 'SIGNUP_FULL_NAME_REQUIRED' using errcode='23514';
  end if;
  new.raw_user_meta_data:=coalesce(new.raw_user_meta_data,'{}'::jsonb)||jsonb_build_object('mobile_phone',v_phone,'full_name',v_name);
  return new;
end $$;
revoke all on function private.require_signup_mobile() from public,anon,authenticated;
drop trigger if exists eneres_signup_mobile_required on auth.users;
create trigger eneres_signup_mobile_required before insert or update of email,phone on auth.users
  for each row execute function private.require_signup_mobile();

create or replace function private.guard_profile_verified_phone() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_phone text; v_confirmed timestamptz;
begin
  if not coalesce((select require_verified_booking_phone from private.auth_settings where singleton),false) then return new; end if;
  if tg_op='UPDATE' and new.mobile_phone is not distinct from old.mobile_phone then return new; end if;
  select private.canonical_auth_phone(u.phone),u.phone_confirmed_at into v_phone,v_confirmed from auth.users u where u.id=new.user_id;
  -- PostgREST name-only upserts execute BEFORE INSERT even when they later
  -- resolve to an existing profile. Preserve that profile's current contact,
  -- or derive an already-confirmed Auth number for a genuinely new profile.
  if tg_op='INSERT' and new.mobile_phone is null then
    if v_confirmed is not null and v_phone is not null then
      new.mobile_phone:=v_phone;
    else
      select p.mobile_phone into new.mobile_phone from public.profiles p where p.user_id=new.user_id;
      if found then return new; end if;
    end if;
  end if;
  -- A pending phone-first Auth signup can create its initial private profile.
  -- The booking guard below still rejects it until the SMS has been verified.
  if tg_op='INSERT' and v_phone is not null and new.mobile_phone=v_phone then return new; end if;
  if v_confirmed is null or v_phone is null or new.mobile_phone is distinct from v_phone then
    raise exception 'PROFILE_PHONE_VERIFICATION_REQUIRED' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function private.guard_profile_verified_phone() from public,anon,authenticated;
drop trigger if exists profiles_verified_mobile on public.profiles;
create trigger profiles_verified_mobile before insert or update of mobile_phone on public.profiles
  for each row execute function private.guard_profile_verified_phone();

-- Only Auth's real phone/confirmation columns can synchronize a verified phone.
-- Editable user_metadata and JWT metadata never establish SMS verification.
create or replace function private.sync_auth_verified_phone() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_phone text:=private.canonical_auth_phone(new.phone);
begin
  if new.phone_confirmed_at is null or v_phone is null then return new; end if;
  if tg_op='UPDATE' and new.phone is not distinct from old.phone
    and new.phone_confirmed_at is not distinct from old.phone_confirmed_at then return new; end if;
  insert into public.profiles(user_id,full_name,mobile_phone)
    values(new.id,left(coalesce(new.raw_user_meta_data->>'full_name',''),100),v_phone)
    on conflict(user_id) do update set mobile_phone=excluded.mobile_phone
      where public.profiles.mobile_phone is distinct from excluded.mobile_phone;
  return new;
end $$;
revoke all on function private.sync_auth_verified_phone() from public,anon,authenticated;
drop trigger if exists eneres_auth_verified_mobile_sync on auth.users;
create trigger eneres_auth_verified_mobile_sync after insert or update of phone,phone_confirmed_at on auth.users
  for each row execute function private.sync_auth_verified_phone();

create or replace function private.guard_online_booking_contact() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_phone text; v_profile_phone text; v_email text; v_phone_confirmed timestamptz; v_email_confirmed timestamptz;
begin
  if new.booking_source<>'online' or not coalesce((select require_verified_booking_phone from private.auth_settings where singleton),false) then return new; end if;
  -- Changing a calendar time/status does not require old customers to reverify.
  -- In particular, an owner may always cancel an already-existing appointment.
  if tg_op='UPDATE' and new.customer_phone is not distinct from old.customer_phone
    and new.customer_id is not distinct from old.customer_id
    and new.customer_email is not distinct from old.customer_email then return new; end if;
  select private.canonical_auth_phone(u.phone),u.phone_confirmed_at,u.email,u.email_confirmed_at,p.mobile_phone
    into v_phone,v_phone_confirmed,v_email,v_email_confirmed,v_profile_phone
    from auth.users u join public.profiles p on p.user_id=u.id where u.id=new.customer_id
    for share of u,p;
  if v_email_confirmed is null or nullif(btrim(v_email),'') is null
    or lower(btrim(new.customer_email)) is distinct from lower(btrim(v_email)) then
    raise exception 'EMAIL_CONFIRMATION_REQUIRED' using errcode='42501';
  end if;
  if v_phone_confirmed is null or v_phone is null then
    raise exception 'PHONE_VERIFICATION_REQUIRED' using errcode='42501';
  end if;
  if v_profile_phone is distinct from v_phone then
    raise exception 'PROFILE_PHONE_VERIFICATION_REQUIRED' using errcode='23514';
  end if;
  -- The original booking RPC inserts first and adds contact in the same
  -- transaction. Derive its initial snapshot from the verified account, too.
  if tg_op='INSERT' and new.customer_phone is null then new.customer_phone:=v_phone; end if;
  if new.customer_phone is distinct from v_phone then
    raise exception 'BOOKING_PHONE_MISMATCH' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function private.guard_online_booking_contact() from public,anon,authenticated;
drop trigger if exists bookings_verified_contact on public.bookings;
create trigger bookings_verified_contact before insert or update of customer_phone,customer_id,customer_email on public.bookings
  for each row execute function private.guard_online_booking_contact();

comment on table private.auth_settings is 'Enable verified phone bookings only after configuring and testing Supabase SMS and email delivery';
notify pgrst,'reload schema';
commit;
