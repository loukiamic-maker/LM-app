\set ON_ERROR_STOP on
begin;
create schema test;
create function test.ok(p_condition boolean,p_label text) returns void language plpgsql as $$
begin
  if p_condition is distinct from true then raise exception 'FAIL: %',p_label; end if;
  raise notice 'PASS: %',p_label;
end $$;
create function test.fails(p_sql text,p_state text,p_label text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate=p_state then raise notice 'PASS: % [%]',p_label,sqlstate; return; end if;
    raise exception 'FAIL: % expected %, got %: %',p_label,p_state,sqlstate,sqlerrm;
  end;
  raise exception 'FAIL: % did not fail',p_label;
end $$;
create function test.slot(p_offset integer,p_time text) returns timestamptz language sql stable as $$
  select (((now() at time zone 'Europe/Athens')::date+p_offset)+p_time::time) at time zone 'Europe/Athens'
$$;
grant usage on schema test to anon,authenticated,service_role;
grant execute on all functions in schema test to anon,authenticated,service_role;

-- All accounts and salons below are local test fixtures only.
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
 ('00000000-0000-0000-0000-000000000001','owner@example.test',now(),'{}'),
 ('00000000-0000-0000-0000-000000000002','alice@example.test',now(),'{}'),
 ('00000000-0000-0000-0000-000000000003','bob@example.test',now(),'{}'),
 ('00000000-0000-0000-0000-000000000004','unverified@example.test',null,'{}'),
 ('00000000-0000-0000-0000-000000000005','admin@example.test',now(),'{"role":"admin"}'),
 ('00000000-0000-0000-0000-000000000006','other-owner@example.test',now(),'{}');

set local role authenticated;
set local request.jwt.claims='{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
select test.ok((public.create_salon('New Salon','Αθήνα','Ελλάδα','hair','Οδός 1')).status='draft','create_salon owns draft');
insert into public.salons(id,owner_id,name,category,city,country,address) values
 ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Test Salon','hair','Αθήνα','Ελλάδα','Test Street 1'),
 ('30000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','Private Draft','hair','Αθήνα','Ελλάδα','Test Street 3');
select test.fails($q$update public.salons set status='published' where id='30000000-0000-0000-0000-000000000001'$q$,'42501','owner cannot self-publish');
select test.fails($q$select public.submit_salon('30000000-0000-0000-0000-000000000001')$q$,'23514','incomplete salon cannot submit');
select test.fails($q$insert into public.staff(salon_id,name) values('30000000-0000-0000-0000-000000000001','A')$q$,'23514','staff name validated');
insert into public.staff(id,salon_id,name) values
 ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Anna'),
 ('10000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','Maria');
insert into public.services(id,salon_id,name,duration_minutes,price_cents) values
 ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Haircut',60,3500);
select test.fails($q$insert into public.services(salon_id,name,duration_minutes,price_cents) values('30000000-0000-0000-0000-000000000001','Invalid',60,-1)$q$,'23514','negative price rejected');
select test.fails($q$insert into public.services(salon_id,name,duration_minutes,price_cents) values('30000000-0000-0000-0000-000000000001','Invalid',0,1000)$q$,'23514','zero duration rejected');
insert into public.services(id,salon_id,name,duration_minutes,price_cents,active) values ('20000000-0000-0000-0000-000000000020','30000000-0000-0000-0000-000000000001','Quick trim',20,1500,false);
select test.ok((select duration_minutes=20 from public.services where id='20000000-0000-0000-0000-000000000020'),'twenty-minute service duration supported');
select test.fails($q$insert into public.services(salon_id,name,duration_minutes,price_cents) values('30000000-0000-0000-0000-000000000001','Invalid',17,1000)$q$,'23514','duration must use five-minute steps');
select test.fails($q$insert into public.services(salon_id,name,duration_minutes,price_cents) values('30000000-0000-0000-0000-000000000001','Invalid',10000,1000)$q$,'23514','excessive duration rejected');
insert into public.staff_hours(staff_id,weekday,opens_at,closes_at)
 select t.id,d,'09:00','18:00' from public.staff t cross join generate_series(0,6) d;
select test.fails($q$insert into public.staff_hours(staff_id,weekday,opens_at,closes_at) values('10000000-0000-0000-0000-000000000001',1,'10:00','12:00')$q$,'23P01','overlapping hours rejected');
select test.fails($q$insert into public.staff_hours(staff_id,weekday,opens_at,closes_at) values('10000000-0000-0000-0000-000000000001',1,'18:00','09:00')$q$,'23514','inverted hours rejected');
select test.ok((public.submit_salon('30000000-0000-0000-0000-000000000001')).status='pending','complete salon submits pending');
select test.fails($q$update public.salons set owner_id='00000000-0000-0000-0000-000000000006' where id='30000000-0000-0000-0000-000000000001'$q$,'42501','ownership cannot be transferred by browser');

set local request.jwt.claims='{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}';
insert into public.salons(id,owner_id,name,category,city,country,address,timezone) values
 ('30000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000006','Other Salon','nails','Λευκωσία','Κύπρος','Other Street 1','Europe/Nicosia');
insert into public.staff(id,salon_id,name) values ('10000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000002','Eleni');
insert into public.services(id,salon_id,name,duration_minutes,price_cents) values ('20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','Nails',45,2500);
insert into public.staff_hours(staff_id,weekday,opens_at,closes_at) select '10000000-0000-0000-0000-000000000003',d,'09:00','18:00' from generate_series(0,6)d;
select test.ok((select count(*) from public.salons where id='30000000-0000-0000-0000-000000000003')=0,'other owner cannot see draft');
select test.fails($q$insert into public.services(salon_id,name,duration_minutes,price_cents) values('30000000-0000-0000-0000-000000000001','Intrusion',60,1000)$q$,'42501','cross-owner catalogue write denied');
select test.fails($q$select public.replace_staff_hours('10000000-0000-0000-0000-000000000001','[]')$q$,'42501','cross-owner schedule write denied');

set local role anon;
set local request.jwt.claims='{"role":"anon"}';
select test.ok((select count(*) from public.salons)=0,'anonymous cannot see drafts/pending');
select test.ok((select count(*) from public.get_availability('20000000-0000-0000-0000-000000000001',(now()+interval '3 days')::date))=0,'unpublished slots hidden');
select test.fails($q$select public.create_booking('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',test.slot(3,'10:00'),'Alice',gen_random_uuid())$q$,'42501','anonymous cannot execute booking RPC');
select test.fails('select * from public.bookings','42501','anonymous cannot read bookings');
select test.fails('select * from private.notification_outbox','42501','anonymous cannot read outbox');

set local role authenticated;
set local request.jwt.claims='{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}';
update public.salons set status='published' where id in ('30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002');
select test.ok((select count(*) from public.salons where status='published')=2,'server-appointed admin can publish');

set local role anon;
set local request.jwt.claims='{"role":"anon"}';
select test.ok((select count(*) from public.salons)=2,'anonymous sees published listings');
select test.ok((select count(*) from public.get_availability('20000000-0000-0000-0000-000000000001',(test.slot(3,'10:00') at time zone 'Europe/Athens')::date))=66,'anonymous sees actual staff availability');
select test.ok((select count(*) from public.get_availability('20000000-0000-0000-0000-000000000001',(test.slot(3,'10:00') at time zone 'Europe/Athens')::date,'10000000-0000-0000-0000-000000000001'))=33,'availability respects staff selection');

set local role authenticated;
set local request.jwt.claims='{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
select test.fails($q$select public.create_booking('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',test.slot(3,'10:00'),'Unverified',gen_random_uuid())$q$,'42501','unverified email cannot book');

set local request.jwt.claims='{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
select (public.create_booking('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',test.slot(3,'10:00'),'Alice','40000000-0000-0000-0000-000000000001')).id as booking_one \gset
select test.ok((select customer_id='00000000-0000-0000-0000-000000000002' and customer_email='alice@example.test' and price_cents=3500 and ends_at-starts_at=interval '60 minutes' and payment_status='unpaid' and payment_method='pay_at_salon' and cancellation_hours=24 and salon_name='Test Salon' and staff_name='Anna' and timezone='Europe/Athens' and country='Ελλάδα' from public.bookings where id=:'booking_one'),'server derives identity, verified email, price, duration, policy and snapshots');
select test.ok((public.create_booking('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',test.slot(3,'10:00'),'Alice','40000000-0000-0000-0000-000000000001')).id=:'booking_one'::uuid,'idempotent retry returns original booking');
select test.ok((select count(*) from public.bookings)=1,'idempotency did not create duplicates');
select test.fails($q$select public.create_booking('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',test.slot(3,'11:00'),'Alice','40000000-0000-0000-0000-000000000001')$q$,'23514','idempotency key cannot change payload');
select test.fails($q$select public.create_booking('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003',test.slot(3,'10:00'),'Alice',gen_random_uuid())$q$,'P0001','cross-salon staff rejected');
select test.fails($q$select public.create_booking('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',test.slot(3,'08:00'),'Alice',gen_random_uuid())$q$,'P0001','outside opening hours rejected');
select test.fails($q$select public.create_booking('20000000-0000-0000-0000-000000000020','10000000-0000-0000-0000-000000000001',test.slot(3,'14:00'),'Alice',gen_random_uuid())$q$,'P0001','inactive service cannot be booked');
select test.fails($q$select public.create_booking('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',now()+interval '30 minutes','Alice',gen_random_uuid())$q$,'P0001','one-hour notice required');
select test.fails($q$select public.create_booking('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',test.slot(91,'10:00'),'Alice',gen_random_uuid())$q$,'P0001','ninety-day horizon enforced');
select test.fails($q$select public.create_booking('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',test.slot(3,'10:10'),'Alice',gen_random_uuid())$q$,'P0001','slots aligned to fifteen minutes');
select test.fails($q$update public.bookings set price_cents=1$q$,'42501','browser cannot alter booking price');
select test.fails($q$update public.bookings set payment_status='paid'$q$,'42501','browser cannot forge paid status');
select test.fails($q$insert into public.bookings default values$q$,'42501','browser cannot insert bookings directly');
select test.fails($q$delete from public.bookings$q$,'42501','browser cannot delete booking history');
select test.fails($q$select public.claim_notifications(10)$q$,'42501','authenticated cannot claim notification outbox');
select test.fails($q$select public.complete_booking((select id from public.bookings limit 1),true)$q$,'42501','customer cannot mark own payment received');

set local request.jwt.claims='{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
select test.ok((select count(*) from public.bookings)=0,'other customer cannot see booking');
select test.fails(format('select public.cancel_booking(%L)',:'booking_one'),'42501','other customer cannot cancel booking');
select test.fails(format('select public.reschedule_booking(%L,%L,test.slot(3,''14:00''))',:'booking_one','10000000-0000-0000-0000-000000000001'),'42501','other customer cannot reschedule booking');
select test.fails($q$select public.create_booking('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',test.slot(3,'10:30'),'Bob',gen_random_uuid())$q$,'P0001','overlap rejected across customers');
select (public.create_booking('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',test.slot(3,'11:00'),'Bob','40000000-0000-0000-0000-000000000002')).id as booking_two \gset
select test.ok((select count(*) from public.bookings)=1,'customer sees only own booking after booking adjacent slot');

set local request.jwt.claims='{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
select test.ok((select count(*) from public.bookings)=2,'salon owner sees salon bookings');
select test.fails($q$insert into public.staff_time_off(staff_id,starts_at,ends_at) values('10000000-0000-0000-0000-000000000001',test.slot(3,'10:30'),test.slot(3,'12:00'))$q$,'23514','time off cannot displace confirmed booking');
insert into public.staff_time_off(staff_id,starts_at,ends_at,reason) values('10000000-0000-0000-0000-000000000001',test.slot(3,'12:00'),test.slot(3,'13:00'),'Private reason');
select test.fails($q$select public.replace_staff_hours('10000000-0000-0000-0000-000000000001','[]')$q$,'23514','schedule replacement preserves confirmed appointments');
select test.fails($q$select public.replace_staff_hours('10000000-0000-0000-0000-000000000002','[{"weekday":1,"opens_at":"18:00","closes_at":"09:00"}]')$q$,'23514','invalid schedule replacement rejected atomically');
select test.ok((select count(*) from public.staff_hours where staff_id='10000000-0000-0000-0000-000000000002')=7,'invalid replacement retains original hours');
select test.ok((select count(*) from public.replace_staff_hours('10000000-0000-0000-0000-000000000002',(select jsonb_agg(jsonb_build_object('weekday',d,'opens_at','09:00','closes_at','18:00')) from generate_series(0,6)d)))=7,'atomic valid schedule replacement works');

set local request.jwt.claims='{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
select test.ok((select count(*) from public.staff_time_off)=0,'customer cannot read private time-off reasons');
select test.ok(not exists(select 1 from public.get_availability('20000000-0000-0000-0000-000000000001',(test.slot(3,'10:00') at time zone 'Europe/Athens')::date,'10000000-0000-0000-0000-000000000001') where local_time in ('10:00','10:15','11:00','12:00','12:45')),'availability subtracts bookings and time off');
select test.fails($q$select public.create_booking('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',test.slot(3,'12:00'),'Alice',gen_random_uuid())$q$,'P0001','booking during time off rejected');
select test.fails(format('select public.reschedule_booking(%L,%L,test.slot(3,''11:00''))',:'booking_one','10000000-0000-0000-0000-000000000001'),'P0001','reschedule conflict rejected');
select test.ok((select starts_at=test.slot(3,'10:00') from public.bookings where id=:'booking_one'),'failed reschedule preserves original slot');

set local request.jwt.claims='{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
update public.services set price_cents=9900,duration_minutes=90 where id='20000000-0000-0000-0000-000000000001';
update public.salons set cancellation_hours=168 where id='30000000-0000-0000-0000-000000000001';
set local request.jwt.claims='{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
select test.ok((public.reschedule_booking(:'booking_one','10000000-0000-0000-0000-000000000002',test.slot(3,'14:00'))).starts_at=test.slot(3,'14:00'),'successful reschedule switches staff and slot');
select test.ok((select price_cents=3500 and ends_at-starts_at=interval '60 minutes' and cancellation_hours=24 and staff_name='Maria' from public.bookings where id=:'booking_one'),'reschedule preserves agreed price duration and policy snapshots');
select test.ok((public.cancel_booking(:'booking_one')).status='cancelled','customer can cancel before original cutoff despite later salon policy change');
select test.ok((public.cancel_booking(:'booking_one')).status='cancelled','cancellation retry is idempotent');

-- Test lifecycle time progression using privileged fixture changes only.
reset role;
set local request.jwt.claims='{}';
update public.bookings set starts_at=now()+interval '2 hours',ends_at=now()+interval '3 hours',staff_id='10000000-0000-0000-0000-000000000002' where id=:'booking_two';
set local role authenticated;
set local request.jwt.claims='{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
select test.fails(format('select public.cancel_booking(%L)',:'booking_two'),'23514','customer cannot cancel within cutoff');
select test.fails(format('select public.reschedule_booking(%L,%L,test.slot(3,''15:00''))',:'booking_two','10000000-0000-0000-0000-000000000002'),'23514','customer cannot reschedule within cutoff');
set local request.jwt.claims='{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
select test.ok((public.cancel_booking(:'booking_two')).status='cancelled','owner can override cancellation cutoff');
set local request.jwt.claims='{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
select (public.create_booking('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',test.slot(5,'10:00'),'Alice',gen_random_uuid())).id as booking_complete \gset
set local request.jwt.claims='{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
select test.fails(format('select public.complete_booking(%L,true)',:'booking_complete'),'23514','owner cannot complete future booking');
reset role;
set local request.jwt.claims='{}';
update public.bookings set starts_at=now()-interval '2 hours',ends_at=now()-interval '30 minutes' where id=:'booking_complete';
set local role authenticated;
set local request.jwt.claims='{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}';
select test.fails(format('select public.complete_booking(%L,true)',:'booking_complete'),'42501','other salon owner cannot complete booking');
set local request.jwt.claims='{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
select test.ok((public.complete_booking(:'booking_complete',false)).payment_status='unpaid','owner can complete appointment before cash payment arrives');
select test.ok((public.complete_booking(:'booking_complete',true)).payment_status='paid','owner records payment received at salon');
select test.ok((public.complete_booking(:'booking_complete',false)).payment_status='paid','stale unpaid retry cannot erase recorded venue payment');
select test.ok((select status='completed' and payment_method='pay_at_salon' from public.bookings where id=:'booking_complete'),'completed payment never becomes online payment');

reset role;
set local request.jwt.claims='{}';
select test.ok((select count(*) from private.notification_outbox where booking_id=:'booking_one' and event_type='booking_confirmed')=1,'exactly one confirmation enqueued for idempotent booking');
select test.ok((select count(*) from private.notification_outbox where booking_id=:'booking_one' and event_type='booking_rescheduled')=1,'reschedule enqueues notification transactionally');
select test.ok((select count(*) from private.notification_outbox where booking_id=:'booking_one' and event_type='booking_cancelled')=1,'cancel retry does not duplicate notification');
select test.ok((select bool_and(recipient_email='alice@example.test') from private.notification_outbox where booking_id=:'booking_one'),'notifications use authenticated email');
select test.fails($q$insert into public.bookings(salon_id,service_id,staff_id,customer_id,starts_at,ends_at,customer_name,customer_email,service_name,salon_name,staff_name,country,timezone,cancellation_hours,price_cents,idempotency_key)
 values('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',test.slot(8,'10:00'),test.slot(8,'11:00'),'Alice','alice@example.test','Invalid','Test','Anna','Ελλάδα','Europe/Athens',24,1,gen_random_uuid())$q$,'23503','composite foreign key prevents mismatched salon/service');

-- Rate limit is enforced transactionally by the server, not a UI counter.
insert into auth.users(id,email,email_confirmed_at) values ('00000000-0000-0000-0000-000000000007','limit@example.test',now());
set local role authenticated;
set local request.jwt.claims='{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}';
do $$ begin
  for i in 30..49 loop
    perform public.create_booking('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',test.slot(i,'10:00'),'Limit Test',gen_random_uuid());
  end loop;
end $$;
select test.ok((select count(*) from public.bookings)=20,'twenty future confirmed bookings allowed');
select test.fails($q$select public.create_booking('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',test.slot(50,'10:00'),'Limit Test',gen_random_uuid())$q$,'23514','twenty-first active future booking rejected');
reset role;
set local request.jwt.claims='{}';
update public.bookings set status='cancelled' where customer_id='00000000-0000-0000-0000-000000000007';

-- Service-role queue claim/ack, no browser credentials involved.
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select test.ok((select count(*) from public.claim_notifications(2))=2,'worker can atomically claim queue batch');
reset role;
set local request.jwt.claims='{}';
select id as outbox_one from private.notification_outbox where status='processing' order by created_at,id limit 1 \gset
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select public.ack_notification(:'outbox_one',true,null);
reset role;
set local request.jwt.claims='{}';
select test.ok((select status='delivered' and delivered_at is not null from private.notification_outbox where id=:'outbox_one'),'worker delivery acknowledgment stored');
-- Simulate the passage of time so reminder-window tests work at any wall clock.
set local role authenticated;
set local request.jwt.claims='{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
select test.fails('select public.enqueue_due_reminders()','42501','customer cannot enqueue reminder batch');
select (public.create_booking('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',test.slot(7,'10:00'),'Alice',gen_random_uuid())).id as reminder_booking \gset
reset role;
set local request.jwt.claims='{}';
update public.bookings set starts_at=date_trunc('hour',now()+interval '24 hours')+floor(extract(minute from now())/15)*interval '15 minutes',
  ends_at=date_trunc('hour',now()+interval '24 hours')+floor(extract(minute from now())/15)*interval '15 minutes'+interval '90 minutes'
where id=:'reminder_booking';
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select test.ok(public.enqueue_due_reminders()=1,'twenty-four-hour reminder enqueues once');
select test.ok(public.enqueue_due_reminders()=0,'repeated scheduler invocation does not duplicate reminder');
reset role;
set local request.jwt.claims='{}';
select id as reminder_id from private.notification_outbox where booking_id=:'reminder_booking' and event_type='booking_reminder' \gset
select test.ok((select count(*) from private.notification_outbox where booking_id=:'reminder_booking' and event_type='booking_reminder')=1,'unique reminder per booking and appointment start');
select test.ok((select payload->>'owner_email'='owner@example.test' from private.notification_outbox where booking_id=:'reminder_booking' and event_type='booking_confirmed'),'business recipient derived on server');
set local role authenticated;
set local request.jwt.claims='{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
select public.reschedule_booking(:'reminder_booking','10000000-0000-0000-0000-000000000001',test.slot(7,'12:00'));
reset role;
set local request.jwt.claims='{}';
select test.ok((select status='cancelled' from private.notification_outbox where id=:'reminder_id'),'reschedule cancels stale pending reminder');
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select test.ok(not public.notification_is_current(:'reminder_id'),'worker refuses stale reminder after reschedule');
select test.ok(public.enqueue_due_reminders()=0,'rescheduled distant appointment is outside reminder window');
reset role;
set local request.jwt.claims='{}';
update public.bookings set starts_at=date_trunc('hour',now()+interval '24 hours')+floor(extract(minute from now())/15)*interval '15 minutes',
  ends_at=date_trunc('hour',now()+interval '24 hours')+floor(extract(minute from now())/15)*interval '15 minutes'+interval '90 minutes'
where id=:'reminder_booking';
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select test.ok(public.enqueue_due_reminders()=1,'appointment returned to original start can reactivate unsent cancelled reminder');
select test.ok(public.notification_is_current(:'reminder_id'),'reactivated reminder refers to current confirmed appointment');
set local role authenticated;
set local request.jwt.claims='{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
select public.cancel_booking(:'reminder_booking');
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select test.ok(not public.notification_is_current(:'reminder_id'),'worker refuses reminder after appointment cancellation');
select test.ok(public.enqueue_due_reminders()=0,'cancelled booking never enqueues a due reminder');
reset role;
set local request.jwt.claims='{}';
select test.ok((select status='cancelled' from private.notification_outbox where id=:'reminder_id'),'cancellation invalidates pending reminder');

-- Restore initial catalogue for concurrent test, which runs after this transaction.
update public.services set price_cents=3500,duration_minutes=60 where id='20000000-0000-0000-0000-000000000001';
update public.salons set cancellation_hours=24 where id='30000000-0000-0000-0000-000000000001';
commit;
