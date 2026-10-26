-- Eneres 07: new email accounts require a client name and international mobile.
-- Run after the existing setup. Safe to reapply; existing email accounts and
-- nonblank profile names are preserved. This does not verify phone ownership.
begin;

create or replace function private.require_signup_mobile() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_phone text; v_name text;
begin
  if nullif(btrim(new.email),'') is not null then
    -- Existing email accounts are grandfathered; an email-less account cannot
    -- bypass registration requirements by adding its email after insertion.
    if tg_op='UPDATE' and nullif(btrim(old.email),'') is not null then return new; end if;
    v_phone:=btrim(new.raw_user_meta_data->>'mobile_phone');
    if v_phone is null or v_phone !~ '^\+[1-9][0-9]{7,14}$' then
      raise exception 'SIGNUP_MOBILE_PHONE_REQUIRED' using errcode='23514';
    end if;
    v_name:=btrim(new.raw_user_meta_data->>'full_name');
    v_name:=regexp_replace(v_name,'^[[:space:]]+|[[:space:]]+$','','g');
    if jsonb_typeof(new.raw_user_meta_data->'full_name') is distinct from 'string'
      or v_name is null or char_length(v_name) not between 2 and 80 then
      raise exception 'SIGNUP_FULL_NAME_REQUIRED' using errcode='23514';
    end if;
    new.raw_user_meta_data:=coalesce(new.raw_user_meta_data,'{}'::jsonb)
      ||jsonb_build_object('mobile_phone',v_phone,'full_name',v_name);
  end if;
  return new;
end $$;

create or replace function private.create_signup_profile() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_phone text:=btrim(new.raw_user_meta_data->>'mobile_phone'); v_first_email boolean:=false;
begin
  if tg_op='UPDATE' then
    if nullif(btrim(old.email),'') is not null or nullif(btrim(new.email),'') is null then return new; end if;
    v_first_email:=true;
  end if;
  if v_phone is null or v_phone !~ '^\+[1-9][0-9]{7,14}$' then v_phone:=null; end if;
  insert into public.profiles(user_id,full_name,mobile_phone)
    values(new.id,left(coalesce(new.raw_user_meta_data->>'full_name',''),100),v_phone)
    on conflict(user_id) do update set
      mobile_phone=coalesce(public.profiles.mobile_phone,excluded.mobile_phone),
      full_name=case when v_first_email and nullif(regexp_replace(public.profiles.full_name,'[[:space:]]','','g'),'') is null
        then excluded.full_name else public.profiles.full_name end
      where (public.profiles.mobile_phone is null and excluded.mobile_phone is not null)
        or (v_first_email and nullif(regexp_replace(public.profiles.full_name,'[[:space:]]','','g'),'') is null);
  return new;
end $$;

revoke all on function private.require_signup_mobile(),private.create_signup_profile() from public,anon,authenticated;
comment on function private.require_signup_mobile()
  is 'Eneres signup requirements v2: full_name 2-80 characters and international mobile for new email accounts and first-email transitions';

commit;
