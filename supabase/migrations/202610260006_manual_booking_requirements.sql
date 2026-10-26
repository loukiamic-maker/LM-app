-- Require complete details for every new or edited owner-entered appointment.
-- Run after the existing Eneres setup (migrations 001–005). Safe to run again.
-- Existing appointments, including older entries without a phone, stay unchanged.
-- Online and manual bookings retain the same protected staff calendar and GiST
-- overlap constraint. No table is dropped, no existing record is rewritten.
begin;

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
  v_phone text := nullif(regexp_replace(btrim(p_customer_phone),'[[:space:]().-]','','g'),'');
  v_name text := btrim(p_customer_name); v_notes text := coalesce(btrim(p_notes),'');
begin
  perform private.require_calendar_owner(p_salon_id);
  if v_name is null or char_length(v_name) not between 2 and 100 then
    raise exception 'CUSTOMER_NAME_INVALID' using errcode='23514';
  end if;
  if v_email is not null and (char_length(v_email)>320 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'CUSTOMER_EMAIL_INVALID' using errcode='23514';
  end if;
  if v_phone is null then raise exception 'CUSTOMER_PHONE_REQUIRED' using errcode='23514'; end if;
  if char_length(p_customer_phone)>40 or v_phone !~ '^\+?[0-9]{8,15}$' then
    raise exception 'CUSTOMER_PHONE_INVALID' using errcode='23514';
  end if;
  if p_price_cents is null then raise exception 'MANUAL_BOOKING_PRICE_REQUIRED' using errcode='23514'; end if;
  if char_length(v_notes)>2000 then
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
  v_price := p_price_cents;
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

-- Replacing the helper preserves its identity and callers; keep it private.
revoke execute on function private.prepare_manual_booking(uuid,uuid,uuid,timestamptz,text,text,text,integer,integer,text,uuid)
  from public,anon,authenticated;

comment on function private.prepare_manual_booking(uuid,uuid,uuid,timestamptz,text,text,text,integer,integer,text,uuid)
  is 'Eneres manual requirements v1: name, phone, service, explicit price, professional and appointment date/time; shared overlap protection';

commit;
