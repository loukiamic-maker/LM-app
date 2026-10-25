-- Eneres 05: owner booking inbox, customer contact and cancellation reasons.
-- Additive and safe to re-run after the existing booking/calendar installation.
begin;

-- Existing accounts remain valid with no phone. New email registrations must
-- provide an international mobile number in user metadata; this does not verify
-- ownership of that number or set Supabase's SMS-verification fields.
alter table public.profiles add column if not exists mobile_phone text;
alter table public.profiles drop constraint if exists profiles_mobile_phone_format;
alter table public.profiles add constraint profiles_mobile_phone_format
  check (mobile_phone is null or mobile_phone ~ '^\+[1-9][0-9]{7,14}$');

-- Preserve existing profile names and numbers. Only a missing number may be
-- populated from an already supplied, syntactically valid Auth metadata value.
insert into public.profiles(user_id,full_name,mobile_phone)
select u.id,left(coalesce(u.raw_user_meta_data->>'full_name',''),100),btrim(u.raw_user_meta_data->>'mobile_phone')
from auth.users u where btrim(u.raw_user_meta_data->>'mobile_phone') ~ '^\+[1-9][0-9]{7,14}$'
on conflict(user_id) do update set mobile_phone=excluded.mobile_phone
  where public.profiles.mobile_phone is null;

create or replace function private.require_signup_mobile() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_phone text;
begin
  if nullif(btrim(new.email),'') is not null then
    -- Existing email accounts are grandfathered; an email-less account cannot
    -- bypass registration requirements by adding its email after insertion.
    if tg_op='UPDATE' and nullif(btrim(old.email),'') is not null then return new; end if;
    v_phone:=btrim(new.raw_user_meta_data->>'mobile_phone');
    if v_phone is null or v_phone !~ '^\+[1-9][0-9]{7,14}$' then
      raise exception 'SIGNUP_MOBILE_PHONE_REQUIRED' using errcode='23514';
    end if;
    new.raw_user_meta_data:=coalesce(new.raw_user_meta_data,'{}'::jsonb)||jsonb_build_object('mobile_phone',v_phone);
  end if;
  return new;
end $$;
revoke all on function private.require_signup_mobile() from public,anon,authenticated;
drop trigger if exists eneres_signup_mobile_required on auth.users;
create trigger eneres_signup_mobile_required before insert or update of email on auth.users
  for each row execute function private.require_signup_mobile();

create or replace function private.create_signup_profile() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_phone text:=btrim(new.raw_user_meta_data->>'mobile_phone');
begin
  if tg_op='UPDATE' then
    if nullif(btrim(old.email),'') is not null or nullif(btrim(new.email),'') is null then return new; end if;
  end if;
  if v_phone is null or v_phone !~ '^\+[1-9][0-9]{7,14}$' then v_phone:=null; end if;
  insert into public.profiles(user_id,full_name,mobile_phone)
    values(new.id,left(coalesce(new.raw_user_meta_data->>'full_name',''),100),v_phone)
    on conflict(user_id) do update set mobile_phone=excluded.mobile_phone
      where public.profiles.mobile_phone is null and excluded.mobile_phone is not null;
  return new;
end $$;
revoke all on function private.create_signup_profile() from public,anon,authenticated;
drop trigger if exists eneres_signup_profile on auth.users;
create trigger eneres_signup_profile after insert or update of email on auth.users
  for each row execute function private.create_signup_profile();

alter table public.bookings
  add column if not exists cancellation_note text not null default '',
  add column if not exists contact_request_hash text;
alter table public.bookings drop constraint if exists bookings_cancellation_note_length;
alter table public.bookings add constraint bookings_cancellation_note_length check(char_length(cancellation_note)<=2000);

create table if not exists public.business_booking_alerts (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id),
  salon_id uuid not null references public.salons(id),
  status text not null default 'new' check(status in ('new','noted','cancelled')),
  noted_at timestamptz,
  noted_by uuid references auth.users(id),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id),
  cancellation_note text not null default '' check(char_length(cancellation_note)<=2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists business_booking_alerts_salon_created on public.business_booking_alerts(salon_id,created_at desc,id desc);
create index if not exists business_booking_alerts_new_count on public.business_booking_alerts(salon_id) where status='new';
alter table public.business_booking_alerts enable row level security;
revoke all on public.business_booking_alerts from public,anon,authenticated;
grant select on public.business_booking_alerts to authenticated;

create or replace function private.booking_alert_owner(p_salon_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.salons s join auth.users u on u.id=s.owner_id
    where s.id=p_salon_id and s.owner_id=auth.uid() and u.email_confirmed_at is not null)
$$;
revoke all on function private.booking_alert_owner(uuid) from public,anon,authenticated;
grant usage on schema private to authenticated;
grant execute on function private.booking_alert_owner(uuid) to authenticated;
drop policy if exists business_booking_alerts_owner_select on public.business_booking_alerts;
create policy business_booking_alerts_owner_select on public.business_booking_alerts for select to authenticated
  using(private.booking_alert_owner(salon_id));

create or replace function private.sync_business_booking_alert() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.booking_source<>'online' then return new; end if;
  insert into public.business_booking_alerts(booking_id,salon_id,status,cancelled_at,cancelled_by,cancellation_note,created_at)
    values(new.id,new.salon_id,case when new.status='cancelled' then 'cancelled' else 'new' end,
      case when new.status='cancelled' then now() end,
      case when new.status='cancelled' then auth.uid() end,coalesce(new.cancellation_note,''),new.created_at)
    on conflict(booking_id) do update set
      status=case when new.status='cancelled' then 'cancelled' else public.business_booking_alerts.status end,
      cancelled_at=case when new.status='cancelled' then coalesce(public.business_booking_alerts.cancelled_at,now()) else public.business_booking_alerts.cancelled_at end,
      cancelled_by=case when new.status='cancelled' then coalesce(public.business_booking_alerts.cancelled_by,auth.uid()) else public.business_booking_alerts.cancelled_by end,
      cancellation_note=coalesce(new.cancellation_note,''),updated_at=now();
  return new;
end $$;
revoke all on function private.sync_business_booking_alert() from public,anon,authenticated;
drop trigger if exists bookings_business_alert on public.bookings;
create trigger bookings_business_alert after insert or update on public.bookings
  for each row execute function private.sync_business_booking_alert();

-- Retain earlier online bookings in the history. Reapplying never clears an
-- acknowledgement, cancellation note or previously recorded action timestamp.
insert into public.business_booking_alerts(booking_id,salon_id,status,cancelled_at,cancellation_note,created_at)
select b.id,b.salon_id,case when b.status='cancelled' then 'cancelled' else 'new' end,
  case when b.status='cancelled' then b.created_at end,coalesce(b.cancellation_note,''),b.created_at
from public.bookings b where b.booking_source='online'
on conflict(booking_id) do nothing;

create or replace function private.business_booking_alert_json(p_alert_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select to_jsonb(a)||jsonb_build_object('booking',to_jsonb(b),'booking_status',b.status,
    'customer_name',b.customer_name,'customer_email',b.customer_email,'customer_phone',b.customer_phone,
    'notes',b.notes,'service_name',b.service_name,'staff_name',b.staff_name,'salon_name',b.salon_name,
    'starts_at',b.starts_at,'ends_at',b.ends_at,'price_cents',b.price_cents,'timezone',b.timezone)
  from public.business_booking_alerts a join public.bookings b on b.id=a.booking_id where a.id=p_alert_id
$$;
revoke all on function private.business_booking_alert_json(uuid) from public,anon,authenticated;

create or replace function public.list_business_booking_alerts(p_salon_id uuid,p_limit integer default 100,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb; v_unread integer;
begin
  perform private.require_calendar_owner(p_salon_id);
  if p_limit is null or p_limit not between 1 and 200 or p_offset is null or p_offset not between 0 and 100000 then
    raise exception 'ALERT_PAGINATION_INVALID' using errcode='23514';
  end if;
  select count(*) into v_unread from public.business_booking_alerts where salon_id=p_salon_id and status='new';
  select coalesce(jsonb_agg(x.item||jsonb_build_object('salon_unread_count',v_unread) order by x.created_at desc,x.id desc),'[]'::jsonb) into v_result from (
    select a.id,a.created_at,private.business_booking_alert_json(a.id) item from public.business_booking_alerts a
      where a.salon_id=p_salon_id order by a.created_at desc,a.id desc limit p_limit offset p_offset
  ) x;
  return v_result;
end $$;

create or replace function public.acknowledge_business_booking(p_alert_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_alert public.business_booking_alerts; v_booking public.bookings;
begin
  select * into v_alert from public.business_booking_alerts where id=p_alert_id;
  if not found then raise exception 'BOOKING_ALERT_NOT_FOUND' using errcode='P0002'; end if;
  perform private.require_calendar_owner(v_alert.salon_id);
  -- All inbox mutations lock booking first, matching cancellation and the trigger.
  select * into v_booking from public.bookings where id=v_alert.booking_id for update;
  select * into v_alert from public.business_booking_alerts where id=p_alert_id for update;
  if v_booking.status='cancelled' or v_alert.status='cancelled' then raise exception 'BOOKING_ALREADY_CANCELLED' using errcode='23514'; end if;
  if v_alert.status='new' then
    update public.business_booking_alerts set status='noted',noted_at=now(),noted_by=auth.uid(),updated_at=now() where id=p_alert_id;
  end if;
  return private.business_booking_alert_json(p_alert_id)||jsonb_build_object('salon_unread_count',
    (select count(*) from public.business_booking_alerts where salon_id=v_alert.salon_id and status='new'));
end $$;

create or replace function public.cancel_booking_with_note(p_booking_id uuid,p_reason text) returns public.bookings
language plpgsql security definer set search_path='' as $$
declare v_booking public.bookings; v_reason text:=btrim(p_reason);
begin
  select * into v_booking from public.bookings where id=p_booking_id for update;
  if not found then raise exception 'BOOKING_NOT_FOUND' using errcode='P0002'; end if;
  perform private.require_calendar_owner(v_booking.salon_id);
  if v_reason is null or char_length(v_reason) not between 2 and 2000 then
    raise exception 'CANCELLATION_NOTE_REQUIRED' using errcode='23514';
  end if;
  -- Idempotent repeated cancellation preserves the original reason and history.
  if v_booking.status='cancelled' then return v_booking; end if;
  if v_booking.status<>'confirmed' then raise exception 'BOOKING_NOT_CONFIRMED' using errcode='23514'; end if;
  update public.bookings set cancellation_note=v_reason where id=p_booking_id;
  v_booking:=public.cancel_booking(p_booking_id);
  return v_booking;
end $$;

create or replace function public.cancel_business_booking(p_alert_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_alert public.business_booking_alerts;
begin
  select * into v_alert from public.business_booking_alerts where id=p_alert_id;
  if not found then raise exception 'BOOKING_ALERT_NOT_FOUND' using errcode='P0002'; end if;
  perform private.require_calendar_owner(v_alert.salon_id);
  perform public.cancel_booking_with_note(v_alert.booking_id,p_reason);
  return private.business_booking_alert_json(p_alert_id)||jsonb_build_object('salon_unread_count',
    (select count(*) from public.business_booking_alerts where salon_id=v_alert.salon_id and status='new'));
end $$;

create or replace function public.create_booking_with_contact(
  p_service_id uuid,p_staff_id uuid,p_starts_at timestamptz,p_customer_name text,p_idempotency_key uuid,
  p_customer_phone text,p_notes text default ''
) returns public.bookings language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_booking public.bookings; v_phone text; v_notes text:=coalesce(btrim(p_notes),''); v_hash text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode='28000'; end if;
  if not exists(select 1 from auth.users where id=v_uid and email_confirmed_at is not null and nullif(btrim(email),'') is not null) then
    raise exception 'EMAIL_CONFIRMATION_REQUIRED' using errcode='42501';
  end if;
  v_phone:=regexp_replace(btrim(p_customer_phone),'[[:space:]().-]','','g');
  if v_phone is null or v_phone !~ '^\+?[0-9]{8,15}$' then raise exception 'CUSTOMER_PHONE_INVALID' using errcode='23514'; end if;
  if char_length(v_notes)>2000 then raise exception 'BOOKING_NOTES_INVALID' using errcode='23514'; end if;
  v_hash:=md5(jsonb_build_array(p_service_id,p_staff_id,extract(epoch from p_starts_at),btrim(p_customer_name),v_phone,v_notes)::text);
  perform pg_advisory_xact_lock(hashtextextended('booking-customer:'||v_uid::text,0));
  select * into v_booking from public.bookings where customer_id=v_uid and idempotency_key=p_idempotency_key;
  if found then
    if v_booking.contact_request_hash is distinct from v_hash then raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='23514'; end if;
    return v_booking;
  end if;
  v_booking:=public.create_booking(p_service_id,p_staff_id,p_starts_at,p_customer_name,p_idempotency_key);
  update public.bookings set customer_phone=v_phone,notes=v_notes,contact_request_hash=v_hash where id=v_booking.id returning * into v_booking;
  return v_booking;
end $$;

revoke all on function public.list_business_booking_alerts(uuid,integer,integer),public.acknowledge_business_booking(uuid),
  public.cancel_business_booking(uuid,text),public.cancel_booking_with_note(uuid,text),
  public.create_booking_with_contact(uuid,uuid,timestamptz,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.list_business_booking_alerts(uuid,integer,integer),public.acknowledge_business_booking(uuid),
  public.cancel_business_booking(uuid,text),public.cancel_booking_with_note(uuid,text),
  public.create_booking_with_contact(uuid,uuid,timestamptz,text,uuid,text,text) to authenticated;

-- Contact and the cancellation explanation are captured in the private delivery
-- queue, without issuing duplicate confirmations after a contact-only update.
create or replace function private.enqueue_booking_notification() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_event text; v_salon public.salons; v_staff_name text;
begin
  if new.booking_source='offline' then return new; end if;
  if tg_op='UPDATE' then
    update private.notification_outbox set status='cancelled',locked_at=null
      where booking_id=new.id and event_type='booking_reminder' and status in ('pending','processing')
        and (new.status<>'confirmed' or scheduled_for is distinct from new.starts_at);
    if old.customer_phone is distinct from new.customer_phone or old.notes is distinct from new.notes
      or old.cancellation_note is distinct from new.cancellation_note then
      update private.notification_outbox set payload=payload||jsonb_build_object('customer_phone',new.customer_phone,'notes',new.notes,'cancellation_note',new.cancellation_note)
        where booking_id=new.id and status in ('pending','processing');
    end if;
  end if;
  if tg_op='INSERT' then v_event:='booking_confirmed';
  elsif old.status<>new.status and new.status='cancelled' then v_event:='booking_cancelled';
  elsif old.starts_at is distinct from new.starts_at or old.staff_id is distinct from new.staff_id then v_event:='booking_rescheduled';
  else return new; end if;
  select * into v_salon from public.salons where id=new.salon_id;
  select name into v_staff_name from public.staff where id=new.staff_id;
  insert into private.notification_outbox(booking_id,event_type,recipient_email,payload)
  values(new.id,v_event,new.customer_email,jsonb_build_object(
    'booking_id',new.id,'customer_name',new.customer_name,'customer_phone',new.customer_phone,'notes',new.notes,'cancellation_note',new.cancellation_note,
    'salon_name',v_salon.name,'salon_address',v_salon.address,'salon_city',v_salon.city,'timezone',new.timezone,
    'owner_email',(select email from auth.users where id=v_salon.owner_id),'service_name',new.service_name,'staff_name',v_staff_name,
    'starts_at',new.starts_at,'ends_at',new.ends_at,'price_cents',new.price_cents,'payment_method',new.payment_method,
    'cancellation_hours',v_salon.cancellation_hours));
  return new;
end $$;

notify pgrst,'reload schema';
commit;
