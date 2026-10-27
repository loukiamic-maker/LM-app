\set ON_ERROR_STOP on
-- Isolated PostgreSQL Auth fixtures only; no real SMS/email or hosted writes.
begin;
select test.ok((public.get_auth_requirements()->>'require_verified_phone')::boolean=false,'phone-auth rollout is disabled until providers are configured');
select test.ok((select relrowsecurity from pg_class where oid='private.auth_settings'::regclass),'phone-auth activation settings have row security');
select test.ok((select bool_and(prosecdef and proconfig@>array['search_path=""']) from pg_proc where oid in (
 'public.get_auth_requirements()'::regprocedure,'private.guard_online_booking_contact()'::regprocedure,
 'private.guard_profile_verified_phone()'::regprocedure,'private.sync_auth_verified_phone()'::regprocedure,
 'private.require_signup_mobile()'::regprocedure)),'phone-auth helpers use SECURITY DEFINER and an empty search path');
select test.ok(not has_function_privilege('authenticated','private.guard_online_booking_contact()','execute')
 and not has_function_privilege('anon','private.sync_auth_verified_phone()','execute'),'browsers cannot directly call verification helpers');
set local role anon;
select test.ok((public.get_auth_requirements()->>'require_verified_phone')::boolean=false,'anonymous may read only safe authentication requirements');
select test.fails('select * from private.auth_settings','42501','anonymous cannot inspect private rollout table');
reset role;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('98000000-0000-0000-0000-000000000001','phone-owner@example.test',now(),'{"full_name":"Phone Owner","mobile_phone":"+35799000001"}'),
 ('98000000-0000-0000-0000-000000000002','phone-customer@example.test',now(),'{"full_name":"Phone Customer","mobile_phone":"+35799000002"}'),
 ('98000000-0000-0000-0000-000000000003','phone-unconfirmed@example.test',null,'{"full_name":"Unconfirmed Customer","mobile_phone":"+35799000003"}');
insert into public.salons(id,owner_id,name,category,city,country,address,timezone,status) values
 ('98300000-0000-0000-0000-000000000001','98000000-0000-0000-0000-000000000001','Phone Salon','hair','Αθήνα','Ελλάδα','Test address','Europe/Athens','published');
insert into public.staff(id,salon_id,name) values ('98100000-0000-0000-0000-000000000001','98300000-0000-0000-0000-000000000001','Phone Staff');
insert into public.services(id,salon_id,name,duration_minutes,price_cents) values ('98200000-0000-0000-0000-000000000001','98300000-0000-0000-0000-000000000001','Phone Service',60,3500);
insert into public.staff_hours(staff_id,weekday,opens_at,closes_at) select '98100000-0000-0000-0000-000000000001',d,'08:00','19:00' from generate_series(0,6)d;
set local role authenticated;
set local request.jwt.claims='{"sub":"98000000-0000-0000-0000-000000000002","role":"authenticated"}';
select (public.create_booking_with_contact('98200000-0000-0000-0000-000000000001','98100000-0000-0000-0000-000000000001',test.slot(65,'09:00'),'Legacy phone customer',gen_random_uuid(),'+35799000002')).id as legacy_booking \gset
select test.ok((select customer_phone='+35799000002' from public.bookings where id=:'legacy_booking'),'staged rollout preserves existing email-login booking behavior');
select test.fails('update private.auth_settings set require_verified_booking_phone=true','42501','browser cannot enable or disable phone verification');
reset role;
update private.auth_settings set require_verified_booking_phone=true where singleton;
select test.ok((public.get_auth_requirements()->>'require_verified_phone')::boolean=true,'privileged activation exposes verified-phone requirement');
select test.fails($q$insert into auth.users(id,phone,raw_user_meta_data) values('98000000-0000-0000-0000-000000000010','35799000010','{}')$q$,'23514','phone-only signup requires a client name');
select test.fails($q$insert into auth.users(id,phone,raw_user_meta_data) values('98000000-0000-0000-0000-000000000010','35799000010','{"full_name":" "}')$q$,'23514','phone-only signup rejects blank names');
insert into auth.users(id,phone,raw_user_meta_data) values
 ('98000000-0000-0000-0000-000000000010','35799000010','{"full_name":"  Νέος Πελάτης  ","mobile_phone":"+35799999999"}');
select test.ok((select full_name='Νέος Πελάτης' and mobile_phone='+35799000010' from public.profiles where user_id='98000000-0000-0000-0000-000000000010'),'pending phone-first signup normalizes name and uses the Auth phone instead of editable metadata');
select test.ok((select raw_user_meta_data->>'mobile_phone'='+35799000010' from auth.users where id='98000000-0000-0000-0000-000000000010'),'phone-first signup canonicalizes its metadata without claiming SMS verification');
set local role authenticated;
set local request.jwt.claims='{"sub":"98000000-0000-0000-0000-000000000002","role":"authenticated"}';
select test.fails($q$select public.create_booking_with_contact('98200000-0000-0000-0000-000000000001','98100000-0000-0000-0000-000000000001',test.slot(65,'10:00'),'Phone customer',gen_random_uuid(),'+35799000002')$q$,'42501','email-confirmed account still needs real SMS verification');
select test.fails($q$update public.profiles set mobile_phone='+35799000999' where user_id=auth.uid()$q$,'23514','profile cannot switch to an unverified number while phone auth is active');
select test.fails($q$update auth.users set phone='35799000002',phone_confirmed_at=now() where id=auth.uid()$q$,'42501','browser cannot forge trusted Auth phone confirmation columns');
-- Profile name updates with unchanged legacy phone remain possible.
insert into public.profiles(user_id,full_name) values(auth.uid(),'Legacy name-only upsert') on conflict(user_id) do update set full_name=excluded.full_name;
select test.ok((select full_name='Legacy name-only upsert' and mobile_phone='+35799000002' from public.profiles where user_id=auth.uid()),'name-only profile upserts preserve an existing unverified legacy phone');
update public.profiles set full_name='Updated Phone Customer' where user_id=auth.uid();
select test.ok((select full_name='Updated Phone Customer' from public.profiles where user_id=auth.uid()),'requiring SMS does not block unrelated profile settings');
reset role;
update auth.users set raw_user_meta_data=raw_user_meta_data||'{"phone_confirmed_at":"now","phone_verified":true}'::jsonb where id='98000000-0000-0000-0000-000000000002';
select test.ok((select phone_confirmed_at is null from auth.users where id='98000000-0000-0000-0000-000000000002'),'editable metadata never establishes phone verification');
update auth.users set phone='35799000002',phone_confirmed_at=now() where id='98000000-0000-0000-0000-000000000002';
select test.ok((select mobile_phone='+35799000002' and full_name='Updated Phone Customer' from public.profiles where user_id='98000000-0000-0000-0000-000000000002'),'genuine verified Auth phone sync preserves the existing profile name');
set local role authenticated;
set local request.jwt.claims='{"sub":"98000000-0000-0000-0000-000000000002","role":"authenticated"}';
insert into public.profiles(user_id,full_name) values(auth.uid(),'Updated Phone Customer') on conflict(user_id) do update set full_name=excluded.full_name;
select test.ok((select full_name='Updated Phone Customer' and mobile_phone='+35799000002' from public.profiles where user_id=auth.uid()),'name-only profile upserts succeed after SMS verification without clearing the verified phone');
reset role;
update auth.users set phone='35799000003',phone_confirmed_at=now() where id='98000000-0000-0000-0000-000000000003';
set local role authenticated;
set local request.jwt.claims='{"sub":"98000000-0000-0000-0000-000000000003","role":"authenticated"}';
select test.fails($q$select public.create_booking_with_contact('98200000-0000-0000-0000-000000000001','98100000-0000-0000-0000-000000000001',test.slot(65,'10:00'),'Unconfirmed email',gen_random_uuid(),'+35799000003')$q$,'42501','SMS-confirmed account still needs email confirmation');
set local request.jwt.claims='{"sub":"98000000-0000-0000-0000-000000000002","role":"authenticated"}';
select test.fails($q$select public.create_booking_with_contact('98200000-0000-0000-0000-000000000001','98100000-0000-0000-0000-000000000001',test.slot(65,'10:00'),'Phone customer',gen_random_uuid(),'+35799000999')$q$,'23514','booking cannot replace the verified account phone with a different contact');
select (public.create_booking_with_contact('98200000-0000-0000-0000-000000000001','98100000-0000-0000-0000-000000000001',test.slot(65,'10:00'),'Phone customer','98400000-0000-0000-0000-000000000001','+35799000002','Test note')).id as verified_booking \gset
select test.ok((select customer_phone='+35799000002' and customer_email='phone-customer@example.test' from public.bookings where id=:'verified_booking'),'both verified identities create an account-backed booking snapshot');
select test.ok((public.create_booking_with_contact('98200000-0000-0000-0000-000000000001','98100000-0000-0000-0000-000000000001',test.slot(65,'10:00'),'Phone customer','98400000-0000-0000-0000-000000000001','+35799000002','Test note')).id=:'verified_booking'::uuid,'verified contact retries remain idempotent');
select (public.create_booking('98200000-0000-0000-0000-000000000001','98100000-0000-0000-0000-000000000001',test.slot(65,'13:00'),'Legacy RPC verified customer',gen_random_uuid())).id as legacy_verified_booking \gset
select test.ok((select customer_phone='+35799000002' from public.bookings where id=:'legacy_verified_booking'),'original booking RPC derives the verified account phone automatically');
reset role;
select test.ok((select count(*)=1 from private.notification_outbox where booking_id=:'verified_booking' and event_type='booking_confirmed' and recipient_email='phone-customer@example.test'),'successful verified booking enqueues one email confirmation to the confirmed email');
select test.ok((select payload->>'customer_phone'='+35799000002' from private.notification_outbox where booking_id=:'verified_booking' and event_type='booking_confirmed'),'confirmation email payload carries the committed verified account phone');
-- Genuine subsequent SMS verification changes future contacts, not old bookings.
update auth.users set phone='+35799000022',phone_confirmed_at=now() where id='98000000-0000-0000-0000-000000000002';
select test.ok((select mobile_phone='+35799000022' from public.profiles where user_id='98000000-0000-0000-0000-000000000002'),'verified phone change synchronizes saved profile number automatically');
select test.ok((select customer_phone='+35799000002' from public.bookings where id=:'verified_booking'),'phone changes do not rewrite historical appointment contact snapshots');
set local role authenticated;
set local request.jwt.claims='{"sub":"98000000-0000-0000-0000-000000000002","role":"authenticated"}';
select test.ok((public.reschedule_booking(:'verified_booking','98100000-0000-0000-0000-000000000001',test.slot(65,'11:00'))).starts_at=test.slot(65,'11:00'),'changing an old booking time works after an account phone change');
reset role;
-- Owner cancellation must work even if the customer's verification later lapses.
update auth.users set phone_confirmed_at=null where id='98000000-0000-0000-0000-000000000002';
set local role authenticated;
set local request.jwt.claims='{"sub":"98000000-0000-0000-0000-000000000001","role":"authenticated"}';
select test.ok((public.cancel_booking_with_note(:'verified_booking','Owner unavailable')).status='cancelled','owner can cancel an existing booking without reauthenticating its customer');
select (public.create_manual_booking('98300000-0000-0000-0000-000000000001','98200000-0000-0000-0000-000000000001','98100000-0000-0000-0000-000000000001',test.slot(65,'12:00'),'Offline customer',gen_random_uuid(),p_customer_phone=>'99123456',p_price_cents=>3500)).id as manual_booking \gset
select test.ok((select booking_source='offline' and customer_phone='99123456' from public.bookings where id=:'manual_booking'),'owner manual entries remain exempt from online SMS account requirements');
reset role;
select test.ok((select count(*)=1 from private.notification_outbox where booking_id=:'verified_booking' and event_type='booking_cancelled' and recipient_email='phone-customer@example.test' and payload->>'cancellation_note'='Owner unavailable'),'business cancellation enqueues the customer email with cancellation explanation');
select test.ok(not exists(select 1 from private.notification_outbox where booking_id=:'manual_booking'),'manual booking does not pretend to be an online email-confirmed customer event');
-- A phone-first user may verify SMS, add and then confirm an email afterwards.
update auth.users set phone_confirmed_at=now() where id='98000000-0000-0000-0000-000000000010';
update auth.users set email='phone-first@example.test' where id='98000000-0000-0000-0000-000000000010';
select test.ok((select full_name='Νέος Πελάτης' and mobile_phone='+35799000010' from public.profiles where user_id='98000000-0000-0000-0000-000000000010'),'first-email transition preserves validated phone-first profile details');
select test.ok((select email_confirmed_at is null from auth.users where id='98000000-0000-0000-0000-000000000010'),'adding email to a phone-first account never fabricates email confirmation');
rollback;
