-- Add real owner-entered appointments to the same protected booking calendar.
-- Run after 202610240001_booking_platform.sql. Safe to reapply; never resets data.
begin;

alter table public.bookings
  add column if not exists booking_source text not null default 'online',
  add column if not exists customer_phone text,
  add column if not exists notes text not null default '',
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists manual_request_hash text,
  alter column customer_id drop not null,
  alter column customer_email drop not null;

alter table public.bookings drop constraint if exists bookings_source_identity;
alter table public.bookings add constraint bookings_source_identity check (
  (booking_source='online' and customer_id is not null and customer_email is not null)
  or (booking_source='offline' and customer_id is null and created_by is not null and manual_request_hash is not null and char_length(manual_request_hash)=32)
);
alter table public.bookings drop constraint if exists bookings_manual_contact;
alter table public.bookings add constraint bookings_manual_contact check (
  (customer_phone is null or char_length(customer_phone)<=40)
  and char_length(notes)<=2000
);
create unique index if not exists bookings_manual_request_once
  on public.bookings(created_by,idempotency_key) where booking_source='offline';

-- These functions are never callable directly by a browser. The public owner
-- RPCs below derive ownership, snapshots and customer source on the server.
create or replace function private.require_calendar_owner(p_salon_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='28000'; end if;
  if not exists(select 1 from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null) then
    raise exception 'EMAIL_CONFIRMATION_REQUIRED' using errcode='42501';
  end if;
  if not private.owns_salon(p_salon_id) then raise exception 'SALON_OWNER_REQUIRED' using errcode='42501'; end if;
end $$;

create or replace function private.prepare_manual_booking(
  p_salon_id uuid,p_service_id uuid,p_staff_id uuid,p_starts_at timestamptz,
  p_customer_name text,p_customer_email text,p_customer_phone text,
  p_duration_minutes integer,p_price_cents integer,p_notes text,
  p_ignore_booking_id uuid default null
) returns public.bookings language plpgsql security definer set search_path='' as $$
declare
  v_salon public.salons; v_service public.services; v_staff public.staff;
  v_booking public.bookings; v_duration integer; v_price integer;
  v_email text := nullif(lower(btrim(p_customer_email)),'');
  v_phone text := nullif(btrim(p_customer_phone),'');
  v_name text := btrim(p_customer_name); v_notes text := coalesce(btrim(p_notes),'');
begin
  perform private.require_calendar_owner(p_salon_id);
  if v_name is null or char_length(v_name) not between 2 and 100 then
    raise exception 'CUSTOMER_NAME_INVALID' using errcode='23514';
  end if;
  if v_email is not null and (char_length(v_email)>320 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'CUSTOMER_EMAIL_INVALID' using errcode='23514';
  end if;
  if char_length(v_phone)>40 or char_length(v_notes)>2000 then
    raise exception 'CUSTOMER_CONTACT_INVALID' using errcode='23514';
  end if;
  -- Owners may record past work and appointments beyond the consumer's 90-day
  -- booking horizon. One year either side and whole-minute starts are supported.
  if p_starts_at is null or not isfinite(p_starts_at)
    or p_starts_at<now()-interval '366 days' or p_starts_at>now()+interval '366 days'
    or extract(second from p_starts_at)<>0 then
    raise exception 'MANUAL_BOOKING_DATE_INVALID' using errcode='23514';
  end if;
  select * into v_staff from public.staff where id=p_staff_id and salon_id=p_salon_id and active for update;
  if not found then raise exception 'STAFF_UNAVAILABLE' using errcode='P0001'; end if;
  select * into v_service from public.services where id=p_service_id and salon_id=p_salon_id and active for share;
  if not found then raise exception 'SERVICE_UNAVAILABLE' using errcode='P0001'; end if;
  select * into v_salon from public.salons where id=p_salon_id and owner_id=auth.uid() for share;
  if not found then raise exception 'SALON_OWNER_REQUIRED' using errcode='42501'; end if;
  v_duration := coalesce(p_duration_minutes,v_service.duration_minutes);
  v_price := coalesce(p_price_cents,v_service.price_cents);
  if v_duration not between 5 and 480 or v_duration%5<>0 or v_price not between 0 and 1000000 then
    raise exception 'MANUAL_BOOKING_SERVICE_INVALID' using errcode='23514';
  end if;
  if exists(select 1 from public.staff_time_off o where o.staff_id=p_staff_id
    and tstzrange(o.starts_at,o.ends_at,'[)') && tstzrange(p_starts_at,p_starts_at+make_interval(mins=>v_duration),'[)'))
    or exists(select 1 from public.bookings b where b.staff_id=p_staff_id and b.status='confirmed'
      and b.id is distinct from p_ignore_booking_id
      and tstzrange(b.starts_at,b.ends_at,'[)') && tstzrange(p_starts_at,p_starts_at+make_interval(mins=>v_duration),'[)')) then
    raise exception 'SLOT_UNAVAILABLE' using errcode='P0001';
  end if;
  -- Regular public opening hours intentionally do not restrict an owner-entered
  -- appointment. Time off and every confirmed online/offline appointment do.
  v_booking.salon_id:=v_salon.id; v_booking.service_id:=v_service.id; v_booking.staff_id:=v_staff.id;
  v_booking.customer_id:=null; v_booking.starts_at:=p_starts_at;
  v_booking.ends_at:=p_starts_at+make_interval(mins=>v_duration);
  v_booking.customer_name:=v_name; v_booking.customer_email:=v_email; v_booking.customer_phone:=v_phone;
  v_booking.service_name:=v_service.name; v_booking.salon_name:=v_salon.name; v_booking.staff_name:=v_staff.name;
  v_booking.country:=v_salon.country; v_booking.timezone:=v_salon.timezone;
  v_booking.cancellation_hours:=v_salon.cancellation_hours; v_booking.price_cents:=v_price;
  v_booking.booking_source:='offline'; v_booking.created_by:=auth.uid(); v_booking.notes:=v_notes;
  v_booking.status:='confirmed'; v_booking.payment_method:='pay_at_salon'; v_booking.payment_status:='unpaid';
  return v_booking;
end $$;

create or replace function public.create_manual_booking(
  p_salon_id uuid,p_service_id uuid,p_staff_id uuid,p_starts_at timestamptz,
  p_customer_name text,p_idempotency_key uuid,
  p_customer_email text default null,p_customer_phone text default null,
  p_duration_minutes integer default null,p_price_cents integer default null,p_notes text default ''
) returns public.bookings language plpgsql security definer set search_path='' as $$
declare v_booking public.bookings; v_existing public.bookings; v_hash text;
begin
  perform private.require_calendar_owner(p_salon_id);
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode='23514'; end if;
  v_hash:=md5(jsonb_build_array(p_salon_id,p_service_id,p_staff_id,extract(epoch from p_starts_at),btrim(p_customer_name),
    nullif(lower(btrim(p_customer_email)),''),nullif(btrim(p_customer_phone),''),p_duration_minutes,p_price_cents,coalesce(btrim(p_notes),''))::text);
  perform pg_advisory_xact_lock(hashtextextended('manual-booking:'||auth.uid()::text||':'||p_idempotency_key::text,0));
  select * into v_existing from public.bookings
    where booking_source='offline' and created_by=auth.uid() and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.manual_request_hash is distinct from v_hash then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='23514';
    end if;
    return v_existing;
  end if;
  v_booking:=private.prepare_manual_booking(p_salon_id,p_service_id,p_staff_id,p_starts_at,
    p_customer_name,p_customer_email,p_customer_phone,p_duration_minutes,p_price_cents,p_notes);
  insert into public.bookings(salon_id,service_id,staff_id,customer_id,starts_at,ends_at,
    customer_name,customer_email,customer_phone,service_name,salon_name,staff_name,country,timezone,
    cancellation_hours,price_cents,status,payment_method,payment_status,idempotency_key,
    booking_source,created_by,notes,manual_request_hash)
  values(v_booking.salon_id,v_booking.service_id,v_booking.staff_id,null,v_booking.starts_at,v_booking.ends_at,
    v_booking.customer_name,v_booking.customer_email,v_booking.customer_phone,v_booking.service_name,
    v_booking.salon_name,v_booking.staff_name,v_booking.country,v_booking.timezone,v_booking.cancellation_hours,
    v_booking.price_cents,'confirmed','pay_at_salon','unpaid',p_idempotency_key,'offline',auth.uid(),v_booking.notes,v_hash)
  returning * into v_booking;
  return v_booking;
end $$;

create or replace function public.edit_manual_booking(
  p_booking_id uuid,p_service_id uuid,p_staff_id uuid,p_starts_at timestamptz,p_customer_name text,
  p_customer_email text default null,p_customer_phone text default null,
  p_duration_minutes integer default null,p_price_cents integer default null,p_notes text default ''
) returns public.bookings language plpgsql security definer set search_path='' as $$
declare v_old public.bookings; v_booking public.bookings;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='28000'; end if;
  select * into v_old from public.bookings where id=p_booking_id for update;
  if not found then raise exception 'BOOKING_NOT_FOUND' using errcode='P0002'; end if;
  perform private.require_calendar_owner(v_old.salon_id);
  if v_old.booking_source<>'offline' then raise exception 'MANUAL_BOOKING_REQUIRED' using errcode='23514'; end if;
  if v_old.status<>'confirmed' then raise exception 'BOOKING_NOT_CONFIRMED' using errcode='23514'; end if;
  -- Consistent staff lock order also protects moves between two workers.
  perform 1 from public.staff where id in(v_old.staff_id,p_staff_id) order by id for update;
  v_booking:=private.prepare_manual_booking(v_old.salon_id,p_service_id,p_staff_id,p_starts_at,
    p_customer_name,p_customer_email,p_customer_phone,p_duration_minutes,p_price_cents,p_notes,v_old.id);
  update public.bookings set service_id=v_booking.service_id,staff_id=v_booking.staff_id,
    starts_at=v_booking.starts_at,ends_at=v_booking.ends_at,customer_name=v_booking.customer_name,
    customer_email=v_booking.customer_email,customer_phone=v_booking.customer_phone,
    service_name=v_booking.service_name,staff_name=v_booking.staff_name,salon_name=v_booking.salon_name,
    country=v_booking.country,timezone=v_booking.timezone,cancellation_hours=v_booking.cancellation_hours,
    price_cents=v_booking.price_cents,notes=v_booking.notes
  where id=v_old.id returning * into v_booking;
  return v_booking;
end $$;

revoke execute on function private.require_calendar_owner(uuid),
  private.prepare_manual_booking(uuid,uuid,uuid,timestamptz,text,text,text,integer,integer,text,uuid)
  from public,anon,authenticated;
revoke execute on function public.create_manual_booking(uuid,uuid,uuid,timestamptz,text,uuid,text,text,integer,integer,text),
  public.edit_manual_booking(uuid,uuid,uuid,timestamptz,text,text,text,integer,integer,text)
  from public,anon,authenticated;
grant execute on function public.create_manual_booking(uuid,uuid,uuid,timestamptz,text,uuid,text,text,integer,integer,text),
  public.edit_manual_booking(uuid,uuid,uuid,timestamptz,text,text,text,integer,integer,text) to authenticated;


-- NULL guest identities must never grant customer privileges.
create or replace function public.cancel_booking(p_booking_id uuid) returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare v_booking public.bookings; v_owner boolean; v_cutoff integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002'; end if;
  v_owner := private.owns_salon(v_booking.salon_id);
  if v_booking.customer_id is distinct from auth.uid() and not v_owner then raise exception 'BOOKING_FORBIDDEN' using errcode = '42501'; end if;
  if v_booking.status = 'cancelled' then return v_booking; end if;
  if v_booking.status <> 'confirmed' then raise exception 'BOOKING_NOT_CONFIRMED' using errcode = '23514'; end if;
  v_cutoff := v_booking.cancellation_hours;
  if not v_owner and v_booking.starts_at <= now() + make_interval(hours => v_cutoff) then raise exception 'CANCELLATION_CUTOFF' using errcode = '23514'; end if;
  update public.bookings set status = 'cancelled' where id = v_booking.id returning * into v_booking;
  return v_booking;
end $$;


-- NULL guest identities must never grant customer privileges.
create or replace function public.reschedule_booking(p_booking_id uuid, p_staff_id uuid, p_starts_at timestamptz)
returns public.bookings language plpgsql security definer set search_path = '' as $$
declare v_booking public.bookings; v_owner boolean; v_cutoff integer; v_duration interval;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002'; end if;
  v_owner := private.owns_salon(v_booking.salon_id);
  if v_booking.customer_id is distinct from auth.uid() and not v_owner then raise exception 'BOOKING_FORBIDDEN' using errcode = '42501'; end if;
  if v_booking.status <> 'confirmed' then raise exception 'BOOKING_NOT_CONFIRMED' using errcode = '23514'; end if;
  v_cutoff := v_booking.cancellation_hours;
  if not v_owner and v_booking.starts_at <= now() + make_interval(hours => v_cutoff) then raise exception 'CANCELLATION_CUTOFF' using errcode = '23514'; end if;
  -- Lock deterministically when moving between two staff members.
  perform 1 from public.staff where id in (v_booking.staff_id,p_staff_id) order by id for update;
  -- Preserve the duration and price agreed at booking, even if the catalogue changed.
  v_duration := v_booking.ends_at - v_booking.starts_at;
  if not private.slot_available(v_booking.service_id,p_staff_id,p_starts_at,v_booking.id) then raise exception 'SLOT_UNAVAILABLE' using errcode = 'P0001'; end if;
  -- slot_available uses the current service; additionally protect the original duration.
  if not exists (
    select 1 from public.salons s join public.staff_hours h on h.staff_id = p_staff_id
    join public.staff t on t.id = h.staff_id and t.salon_id = s.id and t.active
    where s.id = v_booking.salon_id and h.weekday = extract(dow from p_starts_at at time zone s.timezone)::integer
      and (p_starts_at at time zone s.timezone)::time >= h.opens_at
      and (p_starts_at at time zone s.timezone)::date = ((p_starts_at + v_duration) at time zone s.timezone)::date
      and ((p_starts_at + v_duration) at time zone s.timezone)::time <= h.closes_at
  ) or exists (select 1 from public.staff_time_off o where o.staff_id = p_staff_id and tstzrange(o.starts_at,o.ends_at,'[)') && tstzrange(p_starts_at,p_starts_at+v_duration,'[)'))
    or exists (select 1 from public.bookings b where b.staff_id=p_staff_id and b.id<>v_booking.id and b.status='confirmed' and tstzrange(b.starts_at,b.ends_at,'[)') && tstzrange(p_starts_at,p_starts_at+v_duration,'[)')) then
    raise exception 'SLOT_UNAVAILABLE' using errcode = 'P0001';
  end if;
  update public.bookings set staff_id=p_staff_id, staff_name=(select name from public.staff where id=p_staff_id), starts_at=p_starts_at, ends_at=p_starts_at+v_duration where id=v_booking.id returning * into v_booking;
  return v_booking;
end $$;


-- Offline customers are entered by the owner, not enrolled in email delivery.
create or replace function private.enqueue_booking_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_event text; v_salon public.salons; v_staff_name text;
begin
  if new.booking_source='offline' then return new; end if;
  if tg_op='UPDATE' then
    update private.notification_outbox set status='cancelled',locked_at=null
    where booking_id=new.id and event_type='booking_reminder' and status in ('pending','processing')
      and (new.status<>'confirmed' or scheduled_for is distinct from new.starts_at);
  end if;
  if tg_op='INSERT' then v_event := 'booking_confirmed';
  elsif old.status <> new.status and new.status='cancelled' then v_event := 'booking_cancelled';
  elsif old.starts_at is distinct from new.starts_at or old.staff_id is distinct from new.staff_id then v_event := 'booking_rescheduled';
  else return new; end if;
  select * into v_salon from public.salons where id=new.salon_id;
  select name into v_staff_name from public.staff where id=new.staff_id;
  insert into private.notification_outbox(booking_id,event_type,recipient_email,payload)
  values(new.id,v_event,new.customer_email,jsonb_build_object(
    'booking_id',new.id,'customer_name',new.customer_name,'salon_name',v_salon.name,
    'salon_address',v_salon.address,'salon_city',v_salon.city,'timezone',new.timezone,
    'owner_email',(select email from auth.users where id=v_salon.owner_id),
    'service_name',new.service_name,'staff_name',v_staff_name,'starts_at',new.starts_at,
    'ends_at',new.ends_at,'price_cents',new.price_cents,'payment_method',new.payment_method,
    'cancellation_hours',v_salon.cancellation_hours));
  return new;
end $$;


-- Only real online customers enter the automatic reminder queue.
create or replace function public.enqueue_due_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  insert into private.notification_outbox(booking_id,event_type,recipient_email,scheduled_for,payload)
  select b.id,'booking_reminder',b.customer_email,b.starts_at,jsonb_build_object(
    'booking_id',b.id,'customer_name',b.customer_name,'salon_name',b.salon_name,
    'salon_address',s.address,'salon_city',s.city,'timezone',b.timezone,
    'service_name',b.service_name,'staff_name',b.staff_name,'starts_at',b.starts_at,
    'ends_at',b.ends_at,'price_cents',b.price_cents,'payment_method',b.payment_method,
    'cancellation_hours',b.cancellation_hours)
  from public.bookings b join public.salons s on s.id=b.salon_id
  where b.booking_source='online' and b.status='confirmed' and b.starts_at>=now()+interval '23 hours 45 minutes'
    and b.starts_at<=now()+interval '24 hours 15 minutes'
  on conflict (booking_id,scheduled_for) where event_type='booking_reminder'
    do update set status='pending',attempts=0,next_attempt_at=now(),payload=excluded.payload,locked_at=null
    where private.notification_outbox.status='cancelled';
  get diagnostics v_count = row_count;
  return v_count;
end $$;


-- Online hours remain protected without invalidating deliberately out-of-hours manual work.
create or replace function public.replace_staff_hours(p_staff_id uuid,p_hours jsonb)
returns setof public.staff_hours language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.owns_staff(p_staff_id) then raise exception 'SALON_OWNER_REQUIRED' using errcode='42501'; end if;
  if p_hours is null or jsonb_typeof(p_hours) <> 'array' or jsonb_array_length(p_hours)>28 then raise exception 'HOURS_INVALID' using errcode='23514'; end if;
  perform 1 from public.staff where id=p_staff_id for update;
  -- Parse/validate before removing the previous schedule. Table constraints also reject
  -- inverted/overlapping intervals and the enclosing statement rolls back on any error.
  if exists (select 1 from jsonb_to_recordset(p_hours) as x(weekday integer,opens_at time,closes_at time)
    where weekday is null or weekday not between 0 and 6 or opens_at is null or closes_at is null or opens_at>=closes_at
      or extract(second from opens_at)<>0 or extract(second from closes_at)<>0) then
    raise exception 'HOURS_INVALID' using errcode='23514';
  end if;
  if exists (
    select 1 from public.bookings b join public.salons s on s.id=b.salon_id
    where b.staff_id=p_staff_id and b.booking_source='online' and b.status='confirmed' and b.starts_at>now()
      and not exists (
        select 1 from jsonb_to_recordset(p_hours) as h(weekday integer,opens_at time,closes_at time)
        where h.weekday=extract(dow from b.starts_at at time zone s.timezone)::integer
          and (b.starts_at at time zone s.timezone)::date=(b.ends_at at time zone s.timezone)::date
          and (b.starts_at at time zone s.timezone)::time>=h.opens_at
          and (b.ends_at at time zone s.timezone)::time<=h.closes_at
      )
  ) then raise exception 'HOURS_HAVE_EXISTING_BOOKINGS' using errcode='23514'; end if;
  delete from public.staff_hours where staff_id=p_staff_id;
  insert into public.staff_hours(staff_id,weekday,opens_at,closes_at)
  select p_staff_id,x.weekday,x.opens_at,x.closes_at from jsonb_to_recordset(p_hours) as x(weekday integer,opens_at time,closes_at time);
  return query select * from public.staff_hours where staff_id=p_staff_id order by weekday,opens_at;
end $$;


create or replace function private.validate_hours_bookings() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_staff uuid := case when tg_op='DELETE' then old.staff_id else new.staff_id end;
begin
  if exists (
    select 1 from public.bookings b join public.salons s on s.id=b.salon_id
    where b.staff_id=v_staff and b.booking_source='online' and b.status='confirmed' and b.starts_at>now()
    and not exists (
      select 1 from public.staff_hours h where h.staff_id=v_staff
        and h.weekday=extract(dow from b.starts_at at time zone s.timezone)::integer
        and (b.starts_at at time zone s.timezone)::date=(b.ends_at at time zone s.timezone)::date
        and (b.starts_at at time zone s.timezone)::time>=h.opens_at
        and (b.ends_at at time zone s.timezone)::time<=h.closes_at
    )
  ) then raise exception 'HOURS_HAVE_EXISTING_BOOKINGS' using errcode='23514'; end if;
  return null;
end $$;

notify pgrst,'reload schema';
commit;
