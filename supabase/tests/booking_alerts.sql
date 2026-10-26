\set ON_ERROR_STOP on
-- Isolated fixtures only. Never execute tests in a hosted production project.
begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('86000000-0000-0000-0000-000000000001','alerts-owner@example.test',now()),
 ('86000000-0000-0000-0000-000000000002','alerts-customer@example.test',now()),
 ('86000000-0000-0000-0000-000000000003','alerts-other-owner@example.test',now()),
 ('86000000-0000-0000-0000-000000000004','alerts-other-customer@example.test',now()),
 ('86000000-0000-0000-0000-000000000005','alerts-unverified@example.test',null);
insert into public.salons(id,owner_id,name,category,city,country,address,timezone,status) values
 ('86300000-0000-0000-0000-000000000001','86000000-0000-0000-0000-000000000001','Alerts Salon','hair','Αθήνα','Ελλάδα','Test address','Europe/Athens','published'),
 ('86300000-0000-0000-0000-000000000002','86000000-0000-0000-0000-000000000005','Unverified Salon','hair','Αθήνα','Ελλάδα','Test address','Europe/Athens','published');
insert into public.staff(id,salon_id,name) values ('86100000-0000-0000-0000-000000000001','86300000-0000-0000-0000-000000000001','Alerts Staff');
insert into public.services(id,salon_id,name,duration_minutes,price_cents) values ('86200000-0000-0000-0000-000000000001','86300000-0000-0000-0000-000000000001','Alerts Service',60,3500);
insert into public.staff_hours(staff_id,weekday,opens_at,closes_at) select '86100000-0000-0000-0000-000000000001',d,'08:00','19:00' from generate_series(0,6)d;

select test.ok((select relrowsecurity from pg_class where oid='public.business_booking_alerts'::regclass),'business inbox row security is enabled');
select test.ok(not has_function_privilege('anon','public.create_booking_with_contact(uuid,uuid,timestamptz,text,uuid,text,text)','execute'),'anonymous cannot execute contact booking RPC');
select test.ok(not has_function_privilege('authenticated','private.business_booking_alert_json(uuid)','execute'),'private alert renderer cannot be called by browser');
select test.ok((select bool_and(prosecdef and proconfig@>array['search_path=""']) from pg_proc where oid in (
 'public.create_booking_with_contact(uuid,uuid,timestamptz,text,uuid,text,text)'::regprocedure,
 'public.list_business_booking_alerts(uuid,integer,integer)'::regprocedure,
 'public.acknowledge_business_booking(uuid)'::regprocedure,
 'public.cancel_business_booking(uuid,text)'::regprocedure,
 'public.cancel_booking_with_note(uuid,text)'::regprocedure)),'new browser RPCs use security definer with empty search path');

set local role anon;
set local request.jwt.claims='{"role":"anon"}';
select test.fails('select * from public.business_booking_alerts','42501','anonymous cannot read inbox');
select test.fails($q$select public.list_business_booking_alerts('86300000-0000-0000-0000-000000000001')$q$,'42501','anonymous cannot execute inbox RPC');

set local role authenticated;
set local request.jwt.claims='{"sub":"86000000-0000-0000-0000-000000000005","role":"authenticated"}';
select test.fails($q$select public.create_booking_with_contact('86200000-0000-0000-0000-000000000001','86100000-0000-0000-0000-000000000001',test.slot(40,'10:00'),'Customer',gen_random_uuid(),'+35799123456')$q$,'42501','unverified customer cannot book with contact');
select test.fails($q$select public.list_business_booking_alerts('86300000-0000-0000-0000-000000000002')$q$,'42501','unverified salon owner cannot read inbox');

set local request.jwt.claims='{"sub":"86000000-0000-0000-0000-000000000002","role":"authenticated"}';
select test.fails($q$select public.create_booking_with_contact('86200000-0000-0000-0000-000000000001','86100000-0000-0000-0000-000000000001',test.slot(40,'10:00'),'Customer',gen_random_uuid(),'')$q$,'23514','contact booking requires phone');
select test.fails($q$select public.create_booking_with_contact('86200000-0000-0000-0000-000000000001','86100000-0000-0000-0000-000000000001',test.slot(40,'10:00'),'Customer',gen_random_uuid(),'call me')$q$,'23514','phone letters are rejected');
select test.fails($q$select public.create_booking_with_contact('86200000-0000-0000-0000-000000000001','86100000-0000-0000-0000-000000000001',test.slot(40,'10:00'),'Customer',gen_random_uuid(),'1234567')$q$,'23514','too-short phone is rejected');
select test.fails($q$select public.create_booking_with_contact('86200000-0000-0000-0000-000000000001','86100000-0000-0000-0000-000000000001',test.slot(40,'10:00'),'Customer',gen_random_uuid(),'+35799123456',repeat('x',2001))$q$,'23514','overlong appointment notes are rejected');
select (public.create_booking_with_contact('86200000-0000-0000-0000-000000000001','86100000-0000-0000-0000-000000000001',test.slot(40,'10:00'),'Contact Customer','86400000-0000-0000-0000-000000000001',' +357 99 123456 ','Please call before visit')).id as contact_booking \gset
select test.ok((select customer_phone='+35799123456' and notes='Please call before visit' and price_cents=3500 and customer_id=auth.uid() and char_length(contact_request_hash)=32 from public.bookings where id=:'contact_booking'),'server stores normalized phone, customer note and price/identity snapshot');
select test.ok((public.create_booking_with_contact('86200000-0000-0000-0000-000000000001','86100000-0000-0000-0000-000000000001',test.slot(40,'10:00'),'Contact Customer','86400000-0000-0000-0000-000000000001','+35799123456','Please call before visit')).id=:'contact_booking'::uuid,'contact retry returns same confirmed booking');
select test.fails($q$select public.create_booking_with_contact('86200000-0000-0000-0000-000000000001','86100000-0000-0000-0000-000000000001',test.slot(40,'10:00'),'Contact Customer','86400000-0000-0000-0000-000000000001','+35799123457','Please call before visit')$q$,'23514','idempotency key cannot change phone');
select test.fails($q$select public.create_booking_with_contact('86200000-0000-0000-0000-000000000001','86100000-0000-0000-0000-000000000001',test.slot(40,'10:00'),'Contact Customer','86400000-0000-0000-0000-000000000001','+35799123456','Different notes')$q$,'23514','idempotency key cannot change notes');
select test.ok((select count(*) from public.business_booking_alerts)=0,'customer cannot directly read business inbox');
select test.fails($q$select public.list_business_booking_alerts('86300000-0000-0000-0000-000000000001')$q$,'42501','customer cannot use salon inbox endpoint');
select test.fails($q$insert into public.business_booking_alerts default values$q$,'42501','browser cannot create fake alerts');
select test.fails($q$update public.business_booking_alerts set status='noted'$q$,'42501','browser cannot directly forge noted status');

reset role;
select id as contact_alert from public.business_booking_alerts where booking_id=:'contact_booking' \gset
select test.ok((select count(*) from public.business_booking_alerts where booking_id=:'contact_booking')=1,'idempotent booking has exactly one persisted alert');
select test.ok((select count(*) from private.notification_outbox where booking_id=:'contact_booking' and event_type='booking_confirmed')=1,'contact snapshot update does not duplicate email confirmation');
select test.ok((select payload->>'customer_phone'='+35799123456' and payload->>'notes'='Please call before visit' from private.notification_outbox where booking_id=:'contact_booking' and event_type='booking_confirmed'),'private notification payload includes committed contact');

set local role authenticated;
set local request.jwt.claims='{"sub":"86000000-0000-0000-0000-000000000003","role":"authenticated"}';
select test.ok((select count(*) from public.business_booking_alerts)=0,'other owner cannot read alert rows');
select test.fails(format('select public.acknowledge_business_booking(%L)',:'contact_alert'),'42501','other owner cannot mark a booking noted');
select test.fails(format('select public.cancel_business_booking(%L,%L)',:'contact_alert','Not ours'),'42501','other owner cannot cancel through inbox');

set local request.jwt.claims='{"sub":"86000000-0000-0000-0000-000000000001","role":"authenticated"}';
select test.ok((select count(*) from public.business_booking_alerts)=1,'verified owner reads their own inbox');
select test.ok((public.list_business_booking_alerts('86300000-0000-0000-0000-000000000001')->0->>'customer_phone')='+35799123456','owner inbox returns phone');
select test.ok((public.list_business_booking_alerts('86300000-0000-0000-0000-000000000001')->0->'booking'->>'notes')='Please call before visit','owner inbox has full booking details');
select test.fails($q$select public.list_business_booking_alerts('86300000-0000-0000-0000-000000000001',201)$q$,'23514','inbox fetch limits are bounded');
select test.ok(jsonb_array_length(public.list_business_booking_alerts('86300000-0000-0000-0000-000000000001',100,1))=0,'inbox history offset pagination is honored');
select test.ok((public.acknowledge_business_booking(:'contact_alert')->>'status')='noted','owner marks online booking noted');
select test.ok((public.acknowledge_business_booking(:'contact_alert')->>'salon_unread_count')::integer=0,'acknowledgement returns global unread count');
select noted_at::text as first_noted_at from public.business_booking_alerts where id=:'contact_alert' \gset
select test.ok((public.acknowledge_business_booking(:'contact_alert')->>'noted_at')::timestamptz=:'first_noted_at'::timestamptz,'repeated note preserves original acknowledgement time');
select test.ok((select noted_by=auth.uid() from public.business_booking_alerts where id=:'contact_alert'),'acknowledgement records owner identity');
select test.fails(format('select public.cancel_business_booking(%L,%L)',:'contact_alert',' '),'23514','cancelling requires explanation');
select test.ok((public.cancel_business_booking(:'contact_alert','Staff illness — please call us')->>'status')='cancelled','owner can cancel from inbox');
select test.ok((select status='cancelled' and cancellation_note='Staff illness — please call us' from public.bookings where id=:'contact_booking'),'cancellation updates shared calendar booking and reason');
select test.ok((select status='cancelled' and noted_at is not null and noted_by=auth.uid() and cancelled_by=auth.uid() and cancellation_note='Staff illness — please call us' from public.business_booking_alerts where id=:'contact_alert'),'cancelled alert retains acknowledgement history');
select test.fails(format('select public.acknowledge_business_booking(%L)',:'contact_alert'),'23514','cancelled booking cannot be changed back to noted');
select test.ok((public.cancel_business_booking(:'contact_alert','A different retry reason')->>'cancellation_note')='Staff illness — please call us','repeat cancellation preserves original reason');

reset role;
select test.ok((select payload->>'cancellation_note'='Staff illness — please call us' and payload->>'customer_phone'='+35799123456' from private.notification_outbox where booking_id=:'contact_booking' and event_type='booking_cancelled'),'cancellation email payload captures explanation and contact');
set local role authenticated;
set local request.jwt.claims='{"sub":"86000000-0000-0000-0000-000000000002","role":"authenticated"}';
select test.ok((select cancellation_note='Staff illness — please call us' from public.bookings where id=:'contact_booking'),'customer sees explanation on their own cancelled booking');
select (public.create_booking('86200000-0000-0000-0000-000000000001','86100000-0000-0000-0000-000000000001',test.slot(40,'11:00'),'Legacy Customer','86400000-0000-0000-0000-000000000002')).id as legacy_booking \gset
select test.ok((select customer_phone is null from public.bookings where id=:'legacy_booking'),'legacy booking API remains backward compatible without a fabricated phone');
select test.ok((select count(*) from public.get_availability('86200000-0000-0000-0000-000000000001',(test.slot(40,'10:00') at time zone 'Europe/Athens')::date,'86100000-0000-0000-0000-000000000001') where starts_at=test.slot(40,'10:00'))=1,'inbox cancellation restores online availability');
select public.cancel_booking(:'legacy_booking');
reset role;
select test.ok((select status='cancelled' and cancellation_note='' from public.business_booking_alerts where booking_id=:'legacy_booking'),'customer cancellation also updates persistent business history');
set local role authenticated;
set local request.jwt.claims='{"sub":"86000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local request.jwt.claims='{"sub":"86000000-0000-0000-0000-000000000002","role":"authenticated"}';
select public.create_booking_with_contact('86200000-0000-0000-0000-000000000001','86100000-0000-0000-0000-000000000001',test.slot(40,'14:00'),'Pagination Customer','86400000-0000-0000-0000-000000000004','99123456');
select public.create_booking_with_contact('86200000-0000-0000-0000-000000000001','86100000-0000-0000-0000-000000000001',test.slot(40,'15:00'),'Pagination Customer','86400000-0000-0000-0000-000000000005','99123456');
set local request.jwt.claims='{"sub":"86000000-0000-0000-0000-000000000001","role":"authenticated"}';
select test.ok(jsonb_array_length(public.list_business_booking_alerts('86300000-0000-0000-0000-000000000001',1))=1,'history page size is honored');
select test.ok((public.list_business_booking_alerts('86300000-0000-0000-0000-000000000001',1)->0->>'salon_unread_count')::integer=2,'unread count spans all rows beyond the current page');
select (public.create_manual_booking('86300000-0000-0000-0000-000000000001','86200000-0000-0000-0000-000000000001','86100000-0000-0000-0000-000000000001',test.slot(40,'12:00'),'Phone Customer','86400000-0000-0000-0000-000000000003',null,'+35799000000',p_price_cents=>3500)).id as manual_booking \gset
select test.ok((select count(*) from public.business_booking_alerts where booking_id=:'manual_booking')=0,'offline appointments do not pretend to be new Eneres client bookings');
select test.ok((public.cancel_booking_with_note(:'manual_booking','Customer asked to reschedule')).cancellation_note='Customer asked to reschedule','calendar cancellation notes also support offline appointments');
rollback;
