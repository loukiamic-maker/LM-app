\set ON_ERROR_STOP on
begin;
create schema calendar_test;
create function calendar_test.ok(p_condition boolean,p_label text) returns void language plpgsql as $$
begin
  if p_condition is distinct from true then raise exception 'FAIL: %',p_label; end if;
  raise notice 'PASS: %',p_label;
end $$;
create function calendar_test.fails(p_sql text,p_state text,p_label text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then
    if sqlstate=p_state then raise notice 'PASS: % [%]',p_label,sqlstate; return; end if;
    raise exception 'FAIL: % expected %, got %: %',p_label,p_state,sqlstate,sqlerrm;
  end;
  raise exception 'FAIL: % did not fail',p_label;
end $$;
create function calendar_test.slot(p_offset integer,p_time text) returns timestamptz language sql stable as $$
  select (((now() at time zone 'Europe/Athens')::date+p_offset)+p_time::time) at time zone 'Europe/Athens'
$$;
grant usage on schema calendar_test to anon,authenticated,service_role;
grant execute on all functions in schema calendar_test to anon,authenticated,service_role;

-- Isolated local fixtures. Never run this test file on a hosted project.
insert into auth.users(id,email,email_confirmed_at) values
 ('90000000-0000-0000-0000-000000000001','manual-owner@example.test',now()),
 ('90000000-0000-0000-0000-000000000002','manual-customer@example.test',now()),
 ('90000000-0000-0000-0000-000000000003','manual-other-owner@example.test',now()),
 ('90000000-0000-0000-0000-000000000004','manual-unverified@example.test',null);
insert into public.salons(id,owner_id,name,category,city,country,address,status) values
 ('93000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','Calendar Salon','hair','Αθήνα','Ελλάδα','Calendar Street 1','published'),
 ('93000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000003','Other Calendar','hair','Αθήνα','Ελλάδα','Calendar Street 2','draft'),
 ('93000000-0000-0000-0000-000000000003','90000000-0000-0000-0000-000000000004','Unverified Calendar','hair','Αθήνα','Ελλάδα','Calendar Street 3','draft'),
 ('93000000-0000-0000-0000-000000000004','90000000-0000-0000-0000-000000000001','Draft Calendar','hair','Αθήνα','Ελλάδα','Calendar Street 4','draft');
insert into public.staff(id,salon_id,name) values
 ('91000000-0000-0000-0000-000000000001','93000000-0000-0000-0000-000000000001','First worker'),
 ('91000000-0000-0000-0000-000000000002','93000000-0000-0000-0000-000000000001','Second worker'),
 ('91000000-0000-0000-0000-000000000003','93000000-0000-0000-0000-000000000002','Other worker'),
 ('91000000-0000-0000-0000-000000000004','93000000-0000-0000-0000-000000000003','Unverified worker'),
 ('91000000-0000-0000-0000-000000000005','93000000-0000-0000-0000-000000000004','Draft worker');
insert into public.services(id,salon_id,name,duration_minutes,price_cents) values
 ('92000000-0000-0000-0000-000000000001','93000000-0000-0000-0000-000000000001','Hair service',60,3500),
 ('92000000-0000-0000-0000-000000000002','93000000-0000-0000-0000-000000000002','Other service',60,2500),
 ('92000000-0000-0000-0000-000000000003','93000000-0000-0000-0000-000000000003','Unverified service',60,2000),
 ('92000000-0000-0000-0000-000000000004','93000000-0000-0000-0000-000000000004','Draft service',45,3000);
insert into public.staff_hours(staff_id,weekday,opens_at,closes_at)
 select s.id,d,'09:00','18:00' from public.staff s cross join generate_series(0,6)d where s.salon_id in('93000000-0000-0000-0000-000000000001','93000000-0000-0000-0000-000000000004');

set local role anon;
set local request.jwt.claims='{"role":"anon"}';
select calendar_test.fails($q$select public.create_manual_booking('93000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001',calendar_test.slot(20,'10:00'),'Guest',gen_random_uuid())$q$,'42501','anonymous cannot create manual appointments');
select calendar_test.fails($q$select private.require_calendar_owner('93000000-0000-0000-0000-000000000001')$q$,'42501','browser cannot call internal manual preparation helpers');

set local role authenticated;
set local request.jwt.claims='{"sub":"90000000-0000-0000-0000-000000000003","role":"authenticated"}';
select calendar_test.fails($q$select public.create_manual_booking('93000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001',calendar_test.slot(20,'10:00'),'Guest',gen_random_uuid())$q$,'42501','other owner cannot create a manual appointment');
set local request.jwt.claims='{"sub":"90000000-0000-0000-0000-000000000004","role":"authenticated"}';
select calendar_test.fails($q$select public.create_manual_booking('93000000-0000-0000-0000-000000000003','92000000-0000-0000-0000-000000000003','91000000-0000-0000-0000-000000000004',calendar_test.slot(20,'10:00'),'Guest',gen_random_uuid())$q$,'42501','unverified owner cannot create a manual appointment');

set local request.jwt.claims='{"sub":"90000000-0000-0000-0000-000000000001","role":"authenticated"}';
select (public.create_manual_booking('93000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001',calendar_test.slot(20,'10:00'),'Offline customer','94000000-0000-0000-0000-000000000001',null,'+30 210 1234567',90,4000,'Telephone booking')).id as manual_one \gset
select calendar_test.ok((select booking_source='offline' and customer_id is null and customer_email is null and created_by=auth.uid() and ends_at-starts_at=interval '90 minutes' and price_cents=4000 and customer_phone='+302101234567' and notes='Telephone booking' and payment_method='pay_at_salon' and payment_status='unpaid' from public.bookings where id=:'manual_one'),'manual entry stores guest details without inventing an online customer');
select calendar_test.ok((public.create_manual_booking('93000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001',calendar_test.slot(20,'10:00'),'Offline customer','94000000-0000-0000-0000-000000000001',null,'+30 210 1234567',90,4000,'Telephone booking')).id=:'manual_one'::uuid,'manual create retry is idempotent');
select calendar_test.fails($q$select public.create_manual_booking('93000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001',calendar_test.slot(20,'11:00'),'Offline customer','94000000-0000-0000-0000-000000000001',null,'+30 210 1234567',90,4000,'Telephone booking')$q$,'23514','manual idempotency key cannot be reused with changed payload');
select calendar_test.fails($q$select public.create_manual_booking('93000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001',calendar_test.slot(20,'10:30'),'Overlap',gen_random_uuid(),null,'99123456',null,3500)$q$,'P0001','offline overlap rejected');
select calendar_test.fails($q$select public.create_manual_booking('93000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000001',calendar_test.slot(20,'13:00'),'Wrong service',gen_random_uuid(),null,'99123456',null,3500)$q$,'P0001','cross-salon service rejected');
select calendar_test.fails($q$select public.create_manual_booking('93000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000003',calendar_test.slot(20,'13:00'),'Wrong staff',gen_random_uuid(),null,'99123456',null,3500)$q$,'P0001','cross-salon staff rejected');
select calendar_test.fails($q$select public.create_manual_booking('93000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001',calendar_test.slot(20,'13:00'),'Bad duration',gen_random_uuid(),null,'99123456',17,3500)$q$,'23514','manual duration preserves five-minute steps');
select calendar_test.fails($q$select public.create_manual_booking('93000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001',calendar_test.slot(20,'13:00'),'Bad email',gen_random_uuid(),'not-an-email','99123456',null,3500)$q$,'23514','optional manual email is validated');
select calendar_test.fails($q$select public.create_manual_booking('93000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001',calendar_test.slot(367,'13:00'),'Too far',gen_random_uuid(),null,'99123456',null,3500)$q$,'23514','manual horizon is bounded');
insert into public.staff_time_off(staff_id,starts_at,ends_at) values('91000000-0000-0000-0000-000000000001',calendar_test.slot(20,'15:00'),calendar_test.slot(20,'16:00'));
select calendar_test.fails($q$select public.create_manual_booking('93000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001',calendar_test.slot(20,'15:00'),'Holiday clash',gen_random_uuid(),null,'99123456',null,3500)$q$,'P0001','manual appointment respects staff time off');
select calendar_test.fails(format('insert into public.staff_time_off(staff_id,starts_at,ends_at) values(%L,calendar_test.slot(20,''10:30''),calendar_test.slot(20,''11:30''))','91000000-0000-0000-0000-000000000001'),'23514','time off cannot invalidate offline bookings');

set local role anon;
set local request.jwt.claims='{"role":"anon"}';
select calendar_test.ok(not exists(select 1 from public.get_availability('92000000-0000-0000-0000-000000000001',(calendar_test.slot(20,'10:00') at time zone 'Europe/Athens')::date,'91000000-0000-0000-0000-000000000001') where starts_at>=calendar_test.slot(20,'09:15') and starts_at<calendar_test.slot(20,'11:30')),'consumer availability excludes every slot overlapping an offline appointment');
select calendar_test.ok(exists(select 1 from public.get_availability('92000000-0000-0000-0000-000000000001',(calendar_test.slot(20,'10:00') at time zone 'Europe/Athens')::date,'91000000-0000-0000-0000-000000000002') where starts_at=calendar_test.slot(20,'10:00')),'offline booking blocks only its own staff member');

set local role authenticated;
set local request.jwt.claims='{"sub":"90000000-0000-0000-0000-000000000002","role":"authenticated"}';
select calendar_test.ok((select count(*) from public.bookings where id=:'manual_one')=0,'offline guest appointment never appears in another customer history');
select calendar_test.fails(format('select public.cancel_booking(%L)',:'manual_one'),'42501','NULL guest identity does not authorize arbitrary customer cancellation');
select calendar_test.fails(format('select public.reschedule_booking(%L,%L,calendar_test.slot(20,''12:00''))',:'manual_one','91000000-0000-0000-0000-000000000001'),'42501','NULL guest identity does not authorize arbitrary customer rescheduling');
select calendar_test.fails(format('select public.edit_manual_booking(%L,%L,%L,calendar_test.slot(20,''12:00''),''Intruder'')',:'manual_one','92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001'),'42501','customer cannot edit a guest appointment');
select calendar_test.fails($q$select public.create_booking('92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001',calendar_test.slot(20,'10:00'),'Online customer',gen_random_uuid())$q$,'P0001','online booking cannot take an offline-reserved time');
select (public.create_booking('92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001',calendar_test.slot(20,'12:00'),'Online customer',gen_random_uuid())).id as online_one \gset

set local request.jwt.claims='{"sub":"90000000-0000-0000-0000-000000000001","role":"authenticated"}';
select calendar_test.fails($q$select public.create_manual_booking('93000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001',calendar_test.slot(20,'12:00'),'Offline clash',gen_random_uuid(),null,'99123456',null,3500)$q$,'P0001','manual booking cannot take an online-reserved time');
select calendar_test.fails(format('select public.edit_manual_booking(%L,%L,%L,calendar_test.slot(20,''12:00''),''Edited'',null,''99123456'',null,3500)',:'manual_one','92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001'),'P0001','conflicting manual edit is rejected atomically');
select calendar_test.ok((select starts_at=calendar_test.slot(20,'10:00') and customer_name='Offline customer' from public.bookings where id=:'manual_one'),'failed manual edit retains original appointment');
select (public.edit_manual_booking(:'manual_one','92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000002',calendar_test.slot(20,'13:00'),'Updated guest','guest@example.test','+357 99123456',45,2800,'Moved by telephone')).id;
select calendar_test.ok((select staff_id='91000000-0000-0000-0000-000000000002' and starts_at=calendar_test.slot(20,'13:00') and ends_at-starts_at=interval '45 minutes' and price_cents=2800 and customer_email='guest@example.test' and customer_phone='+35799123456' and notes='Moved by telephone' and customer_id is null from public.bookings where id=:'manual_one'),'owner can edit guest service time staff price duration and contacts');
select calendar_test.ok(exists(select 1 from public.get_availability('92000000-0000-0000-0000-000000000001',(calendar_test.slot(20,'10:00') at time zone 'Europe/Athens')::date,'91000000-0000-0000-0000-000000000001') where starts_at=calendar_test.slot(20,'10:00')),'editing a manual appointment releases its old online slot');
select calendar_test.ok(not exists(select 1 from public.get_availability('92000000-0000-0000-0000-000000000001',(calendar_test.slot(20,'13:00') at time zone 'Europe/Athens')::date,'91000000-0000-0000-0000-000000000002') where starts_at=calendar_test.slot(20,'13:00')),'editing a manual appointment blocks its new online slot');
select calendar_test.fails(format('select public.edit_manual_booking(%L,%L,%L,calendar_test.slot(20,''14:00''),''Changed online'')',:'online_one','92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001'),'23514','manual edit cannot alter agreed online booking data');
select calendar_test.ok((public.create_manual_booking('93000000-0000-0000-0000-000000000004','92000000-0000-0000-0000-000000000004','91000000-0000-0000-0000-000000000005',calendar_test.slot(20,'08:00'),'Draft offline',gen_random_uuid(),null,'99123456',null,3500)).booking_source='offline','owner calendar works in private drafts and outside public opening hours');
select count(*) from public.replace_staff_hours('91000000-0000-0000-0000-000000000005','[{"weekday":0,"opens_at":"10:00","closes_at":"16:00"}]');
set constraints all immediate;
select calendar_test.ok(true,'outside-hours manual appointments do not break legitimate working-hour edits');
set constraints all deferred;
select calendar_test.ok((public.create_manual_booking('93000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000002',calendar_test.slot(-2,'10:00'),'Past offline',gen_random_uuid(),null,'99123456',null,3500)).starts_at=calendar_test.slot(-2,'10:00'),'owner may record completed past calendar work');
select calendar_test.ok((public.cancel_booking(:'manual_one')).status='cancelled','owner can cancel manual appointment');
select calendar_test.ok(exists(select 1 from public.get_availability('92000000-0000-0000-0000-000000000001',(calendar_test.slot(20,'13:00') at time zone 'Europe/Athens')::date,'91000000-0000-0000-0000-000000000002') where starts_at=calendar_test.slot(20,'13:00')),'cancelling a manual appointment restores consumer availability');

reset role;
select calendar_test.ok((select count(*) from private.notification_outbox n join public.bookings b on b.id=n.booking_id where b.booking_source='offline')=0,'manual contacts do not silently enroll in automatic booking emails');
-- Position an offline appointment in the reminder window, without accepting a
-- customer identity. The reminder worker must ignore it even with an email.
update public.bookings set starts_at=date_trunc('minute',now()+interval '24 hours'),ends_at=date_trunc('minute',now()+interval '25 hours')
 where id=(select id from public.bookings where booking_source='offline' and salon_id='93000000-0000-0000-0000-000000000004' limit 1);
select public.enqueue_due_reminders();
select calendar_test.ok((select count(*) from private.notification_outbox n join public.bookings b on b.id=n.booking_id where b.booking_source='offline')=0,'automatic reminders exclude offline records');
select calendar_test.fails($q$insert into public.bookings(salon_id,service_id,staff_id,starts_at,ends_at,customer_name,customer_email,service_name,salon_name,staff_name,country,timezone,cancellation_hours,price_cents,idempotency_key,booking_source,created_by)
 values('93000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001',calendar_test.slot(30,'10:00'),calendar_test.slot(30,'11:00'),'Fake online',null,'Hair service','Calendar Salon','First worker','Ελλάδα','Europe/Athens',24,3500,gen_random_uuid(),'online','90000000-0000-0000-0000-000000000001')$q$,'23514','online records still require an authenticated customer and email');
commit;
