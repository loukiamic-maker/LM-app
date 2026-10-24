-- Real bookings. No demo businesses, customers, or privileged credentials are seeded.
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 100)
);

create table public.salons (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  name text not null check (char_length(btrim(name)) between 2 and 100),
  category text not null check (category in ('hair','nails','face','massage','makeup','laser','brows','barber')),
  city text not null check (char_length(btrim(city)) between 2 and 100),
  country text not null check (country in ('Ελλάδα','Κύπρος')),
  address text not null check (char_length(btrim(address)) between 3 and 250),
  description text not null default '' check (char_length(description) <= 3000),
  timezone text not null default 'Europe/Athens' check (timezone in ('Europe/Athens','Europe/Nicosia')),
  photo_index integer not null default 8 check (photo_index between 0 and 11),
  image_url text check (image_url is null or (char_length(image_url) <= 2048 and image_url ~ '^https://')),
  status text not null default 'draft' check (status in ('draft','pending','published','rejected')),
  cancellation_hours integer not null default 24 check (cancellation_hours between 0 and 168),
  created_at timestamptz not null default now()
);

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 100),
  active boolean not null default true,
  unique (id, salon_id)
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 150),
  duration_minutes integer not null check (duration_minutes between 5 and 480 and duration_minutes % 5 = 0),
  price_cents integer not null check (price_cents between 0 and 1000000),
  active boolean not null default true,
  unique (id, salon_id)
);

create table public.staff_hours (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  weekday integer not null check (weekday between 0 and 6),
  opens_at time without time zone not null,
  closes_at time without time zone not null,
  check (opens_at < closes_at),
  check (extract(second from opens_at) = 0 and extract(second from closes_at) = 0),
  exclude using gist (
    staff_id extensions.gist_uuid_ops with =,
    weekday extensions.gist_int4_ops with =,
    int4range(extract(epoch from opens_at)::integer, extract(epoch from closes_at)::integer, '[)') with &&
  )
);

create table public.staff_time_off (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null default '' check (char_length(reason) <= 500),
  check (isfinite(starts_at) and isfinite(ends_at) and starts_at < ends_at),
  exclude using gist (staff_id extensions.gist_uuid_ops with =, tstzrange(starts_at, ends_at, '[)') with &&)
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id),
  service_id uuid not null,
  staff_id uuid not null,
  customer_id uuid not null references auth.users(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  customer_name text not null check (char_length(btrim(customer_name)) between 2 and 100),
  customer_email text not null check (char_length(customer_email) between 3 and 320),
  service_name text not null,
  salon_name text not null,
  staff_name text not null,
  country text not null check (country in ('Ελλάδα','Κύπρος')),
  timezone text not null check (timezone in ('Europe/Athens','Europe/Nicosia')),
  cancellation_hours integer not null check (cancellation_hours between 0 and 168),
  price_cents integer not null check (price_cents between 0 and 1000000),
  status text not null default 'confirmed' check (status in ('confirmed','cancelled','completed','no_show')),
  payment_method text not null default 'pay_at_salon' check (payment_method = 'pay_at_salon'),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','paid')),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  check (isfinite(starts_at) and isfinite(ends_at) and starts_at < ends_at),
  foreign key (service_id, salon_id) references public.services(id, salon_id),
  foreign key (staff_id, salon_id) references public.staff(id, salon_id),
  unique (customer_id, idempotency_key),
  constraint bookings_staff_no_overlap exclude using gist (
    staff_id extensions.gist_uuid_ops with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status = 'confirmed')
);
create index bookings_customer_starts on public.bookings(customer_id, starts_at desc);
create index bookings_salon_starts on public.bookings(salon_id, starts_at);
create index salons_published_city on public.salons(city) where status = 'published';
create index staff_salon on public.staff(salon_id);
create index services_salon on public.services(salon_id);

-- Delivery queue stays outside the exposed public schema. Never readable by browsers.
create table private.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id),
  event_type text not null check (event_type in ('booking_confirmed','booking_cancelled','booking_rescheduled','booking_reminder')),
  recipient_email text not null,
  scheduled_for timestamptz,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','processing','delivered','failed','cancelled')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create unique index notification_reminders_once on private.notification_outbox(booking_id,scheduled_for) where event_type='booking_reminder';
create index notification_outbox_pending on private.notification_outbox(next_attempt_at) where status in ('pending','processing');
alter table private.notification_outbox enable row level security;

create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select u.raw_app_meta_data->>'role' = 'admin' from auth.users u where u.id = auth.uid()), false
  ) or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role' = 'service_role', false)
    or (session_user in ('postgres','supabase_admin') and auth.uid() is null
        and coalesce(current_setting('request.jwt.claims', true),'') in ('','{}'))
$$;

create function private.owns_salon(p_salon_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.salons s where s.id = p_salon_id and s.owner_id = auth.uid())
$$;

create function private.can_read_salon(p_salon_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.salons s where s.id = p_salon_id and (s.status = 'published' or s.owner_id = auth.uid()))
$$;

create function private.owns_staff(p_staff_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff t join public.salons s on s.id = t.salon_id where t.id = p_staff_id and s.owner_id = auth.uid())
$$;

-- Owner IDs and publication are never owner-editable. Pending transitions are validated
-- even when attempted through direct table PATCH, not just the submit RPC.
create function private.guard_salon() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.is_admin() then return new; end if;
  if auth.uid() is null or new.owner_id is distinct from auth.uid() then
    raise exception 'SALON_OWNER_REQUIRED' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then raise exception 'SALON_ADMIN_PUBLICATION_REQUIRED' using errcode = '42501'; end if;
  else
    if new.owner_id is distinct from old.owner_id then raise exception 'SALON_OWNER_IMMUTABLE' using errcode = '42501'; end if;
    if new.status is distinct from old.status then
      if not (old.status in ('draft','rejected','pending') and new.status in ('draft','pending')) then
        raise exception 'SALON_ADMIN_PUBLICATION_REQUIRED' using errcode = '42501';
      end if;
      if new.status = 'pending' and (
        not exists (select 1 from public.services v where v.salon_id = new.id and v.active)
        or not exists (select 1 from public.staff t join public.staff_hours h on h.staff_id = t.id where t.salon_id = new.id and t.active)
      ) then raise exception 'SALON_SETUP_INCOMPLETE' using errcode = '23514'; end if;
    end if;
  end if;
  return new;
end $$;
create trigger salons_guard before insert or update on public.salons for each row execute function private.guard_salon();

-- Concurrent schedule writes and bookings serialize on the staff row. Time off cannot
-- silently invalidate an appointment already accepted by a customer.
create function private.guard_schedule() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_staff uuid;
begin
  v_staff := case when tg_op = 'DELETE' then old.staff_id else new.staff_id end;
  if tg_op = 'UPDATE' and new.staff_id is distinct from old.staff_id then
    raise exception 'STAFF_REFERENCE_IMMUTABLE' using errcode = '23514';
  end if;
  perform 1 from public.staff where id = v_staff for update;
  if tg_table_name = 'staff_time_off' and tg_op <> 'DELETE' then
    if exists (select 1 from public.bookings b where b.staff_id = v_staff and b.status = 'confirmed'
      and tstzrange(b.starts_at,b.ends_at,'[)') && tstzrange(new.starts_at,new.ends_at,'[)')) then
      raise exception 'TIME_OFF_HAS_BOOKINGS' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger staff_hours_guard before insert or update or delete on public.staff_hours for each row execute function private.guard_schedule();
create trigger staff_time_off_guard before insert or update or delete on public.staff_time_off for each row execute function private.guard_schedule();

create function private.slot_available(p_service_id uuid, p_staff_id uuid, p_starts_at timestamptz, p_ignore_booking_id uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.services v
    join public.salons s on s.id = v.salon_id
    join public.staff t on t.salon_id = s.id and t.id = p_staff_id
    where v.id = p_service_id and v.active and t.active and s.status = 'published'
      and p_starts_at >= now() + interval '1 hour' and p_starts_at <= now() + interval '90 days'
      and isfinite(p_starts_at)
      and extract(second from p_starts_at at time zone s.timezone) = 0
      and extract(minute from p_starts_at at time zone s.timezone)::integer % 15 = 0
      and (p_starts_at at time zone s.timezone)::date = ((p_starts_at + make_interval(mins => v.duration_minutes)) at time zone s.timezone)::date
      and exists (
        select 1 from public.staff_hours h
        where h.staff_id = t.id and h.weekday = extract(dow from p_starts_at at time zone s.timezone)::integer
          and (p_starts_at at time zone s.timezone)::time >= h.opens_at
          and ((p_starts_at + make_interval(mins => v.duration_minutes)) at time zone s.timezone)::time <= h.closes_at
      )
      and not exists (select 1 from public.staff_time_off o where o.staff_id = t.id
        and tstzrange(o.starts_at,o.ends_at,'[)') && tstzrange(p_starts_at,p_starts_at + make_interval(mins => v.duration_minutes),'[)'))
      and not exists (select 1 from public.bookings b where b.staff_id = t.id and b.status = 'confirmed'
        and b.id is distinct from p_ignore_booking_id
        and tstzrange(b.starts_at,b.ends_at,'[)') && tstzrange(p_starts_at,p_starts_at + make_interval(mins => v.duration_minutes),'[)'))
  )
$$;

create function public.get_availability(p_service_id uuid, p_date date, p_staff_id uuid default null)
returns table (staff_id uuid, staff_name text, starts_at timestamptz, ends_at timestamptz, local_time text)
language sql stable security definer set search_path = '' as $$
  with candidates as (
    select t.id, t.name, v.duration_minutes,
      (p_date::timestamp + make_interval(mins => n * 15)) at time zone s.timezone as slot_start,
      s.timezone
    from public.services v join public.salons s on s.id = v.salon_id
    join public.staff t on t.salon_id = s.id
    cross join generate_series(0, 95) n
    where v.id = p_service_id and v.active and t.active and s.status = 'published'
      and (p_staff_id is null or t.id = p_staff_id)
      and p_date >= (now() at time zone s.timezone)::date
      and p_date <= ((now() + interval '90 days') at time zone s.timezone)::date
  )
  select distinct c.id, c.name, c.slot_start, c.slot_start + make_interval(mins => c.duration_minutes),
    to_char(c.slot_start at time zone c.timezone, 'HH24:MI')
  from candidates c where private.slot_available(p_service_id,c.id,c.slot_start)
  order by 3, 2
$$;

create function public.create_booking(p_service_id uuid, p_staff_id uuid, p_starts_at timestamptz, p_customer_name text, p_idempotency_key uuid)
returns public.bookings language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_email text; v_service public.services; v_salon public.salons; v_staff_name text; v_existing public.bookings; v_booking public.bookings;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  select email into v_email from auth.users where id = v_uid and email_confirmed_at is not null;
  if v_email is null or btrim(v_email) = '' then raise exception 'EMAIL_CONFIRMATION_REQUIRED' using errcode = '42501'; end if;
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = '23514'; end if;
  if p_customer_name is null or char_length(btrim(p_customer_name)) not between 2 and 100 then raise exception 'CUSTOMER_NAME_INVALID' using errcode = '23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended('booking-customer:' || v_uid::text, 0));
  select * into v_existing from public.bookings where customer_id = v_uid and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.service_id is distinct from p_service_id or v_existing.staff_id is distinct from p_staff_id
      or v_existing.starts_at is distinct from p_starts_at or v_existing.customer_name is distinct from btrim(p_customer_name) then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '23514';
    end if;
    return v_existing;
  end if;
  if (select count(*) from public.bookings where customer_id=v_uid and status='confirmed' and starts_at>now())>=20 then
    raise exception 'BOOKING_LIMIT_REACHED' using errcode='23514';
  end if;
  -- Same staff lock order as schedule mutation prevents a time-off/booking race.
  perform 1 from public.staff where id = p_staff_id for update;
  select * into v_service from public.services where id = p_service_id for share;
  if not found then raise exception 'SLOT_UNAVAILABLE' using errcode='P0001'; end if;
  select * into v_salon from public.salons where id=v_service.salon_id for share;
  select name into v_staff_name from public.staff where id=p_staff_id;
  if not private.slot_available(p_service_id,p_staff_id,p_starts_at) then raise exception 'SLOT_UNAVAILABLE' using errcode='P0001'; end if;
  insert into public.bookings(salon_id,service_id,staff_id,customer_id,starts_at,ends_at,customer_name,customer_email,service_name,salon_name,staff_name,country,timezone,cancellation_hours,price_cents,idempotency_key)
  values (v_service.salon_id,v_service.id,p_staff_id,v_uid,p_starts_at,p_starts_at + make_interval(mins => v_service.duration_minutes),
    btrim(p_customer_name),v_email,v_service.name,v_salon.name,v_staff_name,v_salon.country,v_salon.timezone,v_salon.cancellation_hours,v_service.price_cents,p_idempotency_key)
  returning * into v_booking;
  return v_booking;
end $$;

create function public.cancel_booking(p_booking_id uuid) returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare v_booking public.bookings; v_owner boolean; v_cutoff integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002'; end if;
  v_owner := private.owns_salon(v_booking.salon_id);
  if v_booking.customer_id <> auth.uid() and not v_owner then raise exception 'BOOKING_FORBIDDEN' using errcode = '42501'; end if;
  if v_booking.status = 'cancelled' then return v_booking; end if;
  if v_booking.status <> 'confirmed' then raise exception 'BOOKING_NOT_CONFIRMED' using errcode = '23514'; end if;
  v_cutoff := v_booking.cancellation_hours;
  if not v_owner and v_booking.starts_at <= now() + make_interval(hours => v_cutoff) then raise exception 'CANCELLATION_CUTOFF' using errcode = '23514'; end if;
  update public.bookings set status = 'cancelled' where id = v_booking.id returning * into v_booking;
  return v_booking;
end $$;

create function public.reschedule_booking(p_booking_id uuid, p_staff_id uuid, p_starts_at timestamptz)
returns public.bookings language plpgsql security definer set search_path = '' as $$
declare v_booking public.bookings; v_owner boolean; v_cutoff integer; v_duration interval;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002'; end if;
  v_owner := private.owns_salon(v_booking.salon_id);
  if v_booking.customer_id <> auth.uid() and not v_owner then raise exception 'BOOKING_FORBIDDEN' using errcode = '42501'; end if;
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

create function public.create_salon(p_name text,p_city text,p_country text,p_category text,p_address text)
returns public.salons language plpgsql security definer set search_path = '' as $$
declare v_salon public.salons;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  insert into public.salons(owner_id,name,city,country,category,address,timezone)
  values(auth.uid(),btrim(p_name),btrim(p_city),p_country,p_category,btrim(p_address),case p_country when 'Κύπρος' then 'Europe/Nicosia' else 'Europe/Athens' end)
  returning * into v_salon;
  return v_salon;
end $$;

create function public.submit_salon(p_salon_id uuid) returns public.salons
language plpgsql security definer set search_path = '' as $$
declare v_salon public.salons;
begin
  if auth.uid() is null or not private.owns_salon(p_salon_id) then raise exception 'SALON_OWNER_REQUIRED' using errcode = '42501'; end if;
  select * into v_salon from public.salons where id=p_salon_id for update;
  if v_salon.status = 'published' then return v_salon; end if;
  if not exists (select 1 from public.services where salon_id=p_salon_id and active)
    or not exists (select 1 from public.staff t join public.staff_hours h on h.staff_id=t.id where t.salon_id=p_salon_id and t.active) then
    raise exception 'SALON_SETUP_INCOMPLETE' using errcode = '23514';
  end if;
  update public.salons set status='pending' where id=p_salon_id returning * into v_salon;
  return v_salon;
end $$;

create function public.complete_booking(p_booking_id uuid,p_paid boolean) returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare v_booking public.bookings;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='28000'; end if;
  select * into v_booking from public.bookings where id=p_booking_id for update;
  if not found or not private.owns_salon(v_booking.salon_id) then raise exception 'SALON_OWNER_REQUIRED' using errcode='42501'; end if;
  if v_booking.status not in ('confirmed','completed') then raise exception 'BOOKING_NOT_CONFIRMED' using errcode='23514'; end if;
  if v_booking.starts_at > now() then raise exception 'BOOKING_NOT_STARTED' using errcode='23514'; end if;
  if p_paid is null then raise exception 'PAYMENT_STATUS_REQUIRED' using errcode='23514'; end if;
  -- A completed unpaid appointment may be settled later. Repeated/stale calls
  -- cannot erase a venue payment already recorded by its owner.
  update public.bookings set status='completed',payment_status=case when p_paid or v_booking.payment_status='paid' then 'paid' else 'unpaid' end where id=p_booking_id returning * into v_booking;
  return v_booking;
end $$;

create function private.enqueue_booking_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_event text; v_salon public.salons; v_staff_name text;
begin
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
create trigger bookings_notify after insert or update on public.bookings for each row execute function private.enqueue_booking_notification();

-- RLS defaults deny; privileges are whitelisted explicitly below.
alter table public.profiles enable row level security;
alter table public.salons enable row level security;
alter table public.staff enable row level security;
alter table public.services enable row level security;
alter table public.staff_hours enable row level security;
alter table public.staff_time_off enable row level security;
alter table public.bookings enable row level security;

create policy profiles_self_select on public.profiles for select to authenticated using (user_id=auth.uid());
create policy profiles_self_insert on public.profiles for insert to authenticated with check (user_id=auth.uid());
create policy profiles_self_update on public.profiles for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy salons_public_or_owner on public.salons for select to anon,authenticated using (status='published' or owner_id=auth.uid());
create policy salons_owner_insert on public.salons for insert to authenticated with check (owner_id=auth.uid() and status='draft');
create policy salons_owner_update on public.salons for update to authenticated using (owner_id=auth.uid()) with check (owner_id=auth.uid());
create policy salons_admin_update on public.salons for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy salons_admin_select on public.salons for select to authenticated using (private.is_admin());
create policy staff_public_or_owner on public.staff for select to anon,authenticated using (private.owns_salon(salon_id) or (active and private.can_read_salon(salon_id)));
create policy staff_owner_insert on public.staff for insert to authenticated with check (private.owns_salon(salon_id));
create policy staff_owner_update on public.staff for update to authenticated using (private.owns_salon(salon_id)) with check (private.owns_salon(salon_id));
create policy staff_owner_delete on public.staff for delete to authenticated using (private.owns_salon(salon_id));
create policy services_public_or_owner on public.services for select to anon,authenticated using (private.owns_salon(salon_id) or (active and private.can_read_salon(salon_id)));
create policy services_owner_insert on public.services for insert to authenticated with check (private.owns_salon(salon_id));
create policy services_owner_update on public.services for update to authenticated using (private.owns_salon(salon_id)) with check (private.owns_salon(salon_id));
create policy services_owner_delete on public.services for delete to authenticated using (private.owns_salon(salon_id));
create policy hours_public_or_owner on public.staff_hours for select to anon,authenticated using (exists(select 1 from public.staff t where t.id=staff_id));
create policy hours_owner_insert on public.staff_hours for insert to authenticated with check (private.owns_staff(staff_id));
create policy hours_owner_update on public.staff_hours for update to authenticated using (private.owns_staff(staff_id)) with check (private.owns_staff(staff_id));
create policy hours_owner_delete on public.staff_hours for delete to authenticated using (private.owns_staff(staff_id));
create policy timeoff_owner_select on public.staff_time_off for select to authenticated using (private.owns_staff(staff_id));
create policy timeoff_owner_insert on public.staff_time_off for insert to authenticated with check (private.owns_staff(staff_id));
create policy timeoff_owner_update on public.staff_time_off for update to authenticated using (private.owns_staff(staff_id)) with check (private.owns_staff(staff_id));
create policy timeoff_owner_delete on public.staff_time_off for delete to authenticated using (private.owns_staff(staff_id));
create policy bookings_customer_or_owner on public.bookings for select to authenticated using (customer_id=auth.uid() or private.owns_salon(salon_id));

revoke all on public.profiles,public.salons,public.staff,public.services,public.staff_hours,public.staff_time_off,public.bookings from anon,authenticated;
grant select,insert,update on public.profiles to authenticated;
grant select on public.salons,public.staff,public.services,public.staff_hours to anon,authenticated;
grant insert,update on public.salons to authenticated;
grant insert,update,delete on public.staff,public.services,public.staff_hours,public.staff_time_off to authenticated;
grant select on public.staff_time_off,public.bookings to authenticated;
-- Policies call these helpers; private is not an exposed PostgREST schema.
grant usage on schema private to anon,authenticated;
revoke execute on all functions in schema private from public,anon,authenticated;
grant execute on function private.owns_salon(uuid),private.can_read_salon(uuid),private.owns_staff(uuid),private.is_admin() to anon,authenticated;
revoke execute on function public.get_availability(uuid,date,uuid),public.create_booking(uuid,uuid,timestamptz,text,uuid),
 public.cancel_booking(uuid),public.reschedule_booking(uuid,uuid,timestamptz),public.create_salon(text,text,text,text,text),
 public.submit_salon(uuid),public.complete_booking(uuid,boolean) from public,anon,authenticated;
grant execute on function public.get_availability(uuid,date,uuid) to anon,authenticated;
grant execute on function public.create_booking(uuid,uuid,timestamptz,text,uuid),public.cancel_booking(uuid),
 public.reschedule_booking(uuid,uuid,timestamptz),public.create_salon(text,text,text,text,text),
 public.submit_salon(uuid),public.complete_booking(uuid,boolean) to authenticated;

-- Replace a weekly schedule atomically; an invalid element leaves the old hours intact.
create function public.replace_staff_hours(p_staff_id uuid,p_hours jsonb)
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
    where b.staff_id=p_staff_id and b.status='confirmed' and b.starts_at>now()
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
revoke execute on function public.replace_staff_hours(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.replace_staff_hours(uuid,jsonb) to authenticated;

create function private.validate_hours_bookings() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_staff uuid := case when tg_op='DELETE' then old.staff_id else new.staff_id end;
begin
  if exists (
    select 1 from public.bookings b join public.salons s on s.id=b.salon_id
    where b.staff_id=v_staff and b.status='confirmed' and b.starts_at>now()
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
create constraint trigger hours_preserve_bookings after insert or update or delete on public.staff_hours
  deferrable initially deferred for each row execute function private.validate_hours_bookings();
revoke execute on function private.validate_hours_bookings() from public,anon,authenticated;

-- Outbox worker RPCs are service-role-only. Browser roles cannot claim/read/ack mail.
create function public.claim_notifications(p_limit integer default 25)
returns setof private.notification_outbox language plpgsql security definer set search_path = '' as $$
begin
  update private.notification_outbox n set status='cancelled',locked_at=null
  where n.event_type='booking_reminder' and n.status in ('pending','processing')
    and not exists (select 1 from public.bookings b where b.id=n.booking_id and b.status='confirmed' and b.starts_at=n.scheduled_for);
  update private.notification_outbox set status='failed',last_error='WORKER_LEASE_EXPIRED',locked_at=null
  where status='processing' and attempts>=5 and locked_at<now()-interval '10 minutes';
  return query
  with claimed as (
    select id from private.notification_outbox
    where attempts<5 and next_attempt_at<=now() and
      (status='pending' or (status='processing' and locked_at<now()-interval '10 minutes'))
    order by created_at for update skip locked limit least(greatest(p_limit,1),50)
  )
  update private.notification_outbox n set status='processing',attempts=n.attempts+1,locked_at=now()
  from claimed c where n.id=c.id returning n.*;
end $$;

create function public.ack_notification(p_notification_id uuid,p_delivered boolean,p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update private.notification_outbox set
    status=case when p_delivered then 'delivered' when attempts>=5 then 'failed' else 'pending' end,
    delivered_at=case when p_delivered then now() else null end,
    next_attempt_at=now()+make_interval(mins=>least(attempts*5,60)),
    locked_at=null,last_error=case when p_delivered then null else left(p_error,500) end
  where id=p_notification_id and status='processing';
end $$;
revoke execute on function public.claim_notifications(integer),public.ack_notification(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.claim_notifications(integer),public.ack_notification(uuid,boolean,text) to service_role;


-- Called by a trusted scheduler/worker, never by a browser. Wide enough for a
-- five-minute schedule; uniqueness prevents duplicate reminders across retries.
create function public.enqueue_due_reminders() returns integer
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
  where b.status='confirmed' and b.starts_at>=now()+interval '23 hours 45 minutes'
    and b.starts_at<=now()+interval '24 hours 15 minutes'
  on conflict (booking_id,scheduled_for) where event_type='booking_reminder'
    do update set status='pending',attempts=0,next_attempt_at=now(),payload=excluded.payload,locked_at=null
    where private.notification_outbox.status='cancelled';
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create function public.notification_is_current(p_notification_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.notification_outbox n join public.bookings b on b.id=n.booking_id
    where n.id=p_notification_id and n.status in ('pending','processing')
      and (n.event_type<>'booking_reminder' or (b.status='confirmed' and b.starts_at=n.scheduled_for and b.starts_at>now()))
  )
$$;
revoke execute on function public.enqueue_due_reminders(),public.notification_is_current(uuid) from public,anon,authenticated;
grant execute on function public.enqueue_due_reminders(),public.notification_is_current(uuid) to service_role;
