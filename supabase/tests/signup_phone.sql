\set ON_ERROR_STOP on
-- Isolated signup/mobile fixtures; never execute this file on a hosted project.
begin;
reset role;
set local request.jwt.claims='{}';

select test.ok((select bool_and(prosecdef and proconfig@>array['search_path=""']) from pg_proc where oid in (
 'private.require_signup_mobile()'::regprocedure,'private.create_signup_profile()'::regprocedure)),
 'signup trigger functions use security definer and empty search path');
select test.ok(not has_function_privilege('anon','private.require_signup_mobile()','execute')
 and not has_function_privilege('authenticated','private.create_signup_profile()','execute'),
 'browsers cannot directly call signup trigger functions');
select test.ok((select count(*) from pg_trigger where tgrelid='auth.users'::regclass
 and tgname in ('eneres_signup_mobile_required','eneres_signup_profile') and tgenabled<>'D')=2,
 'both signup phone/profile triggers are enabled');

select test.fails($q$insert into auth.users(id,email,raw_user_meta_data)
 values('89000000-0000-0000-0000-000000000001','missing-phone@example.test','{}')$q$,'23514',
 'new email registration requires mobile metadata');
select test.fails($q$insert into auth.users(id,email,raw_user_meta_data)
 values('89000000-0000-0000-0000-000000000002','null-phone@example.test',null)$q$,'23514',
 'null metadata cannot bypass signup phone requirement');
select test.fails($q$insert into auth.users(id,email,raw_user_meta_data)
 values('89000000-0000-0000-0000-000000000003','letters-phone@example.test','{"mobile_phone":"call me"}')$q$,'23514',
 'phone letters rejected during registration');
select test.fails($q$insert into auth.users(id,email,raw_user_meta_data)
 values('89000000-0000-0000-0000-000000000004','local-phone@example.test','{"mobile_phone":"99123456"}')$q$,'23514',
 'registration phone requires international country code');
select test.fails($q$insert into auth.users(id,email,raw_user_meta_data)
 values('89000000-0000-0000-0000-000000000005','zero-phone@example.test','{"mobile_phone":"+000000000"}')$q$,'23514',
 'invalid zero country prefix rejected');
select test.fails($q$insert into auth.users(id,email,raw_user_meta_data)
 values('89000000-0000-0000-0000-000000000006','short-phone@example.test','{"mobile_phone":"+35799"}')$q$,'23514',
 'too-short international phone rejected');
select test.fails($q$insert into auth.users(id,email,raw_user_meta_data)
 values('89000000-0000-0000-0000-000000000007','long-phone@example.test','{"mobile_phone":"+357991234567890123"}')$q$,'23514',
 'overlong international phone rejected');
select test.ok(not exists(select 1 from auth.users where id between '89000000-0000-0000-0000-000000000001'::uuid
 and '89000000-0000-0000-0000-000000000007'::uuid),'failed registration leaves no Auth accounts');

insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('89000000-0000-0000-0000-000000000011','cyprus-phone@example.test',null,
 '{"full_name":"Cyprus Client","mobile_phone":"+35799123456","role":"admin"}'),
 ('89000000-0000-0000-0000-000000000012','greece-phone@example.test',now(),
 '{"full_name":"Greece Client","mobile_phone":"+306912345678"}');
select test.ok((select full_name='Cyprus Client' and mobile_phone='+35799123456' from public.profiles
 where user_id='89000000-0000-0000-0000-000000000011'),'Cyprus registration saves name and international mobile');
select test.ok((select full_name='Greece Client' and mobile_phone='+306912345678' from public.profiles
 where user_id='89000000-0000-0000-0000-000000000012'),'Greece registration saves name and international mobile');
select test.ok((select email_confirmed_at is null from auth.users where id='89000000-0000-0000-0000-000000000011'),
 'providing a mobile never fabricates email or SMS verification');
select test.ok((select raw_app_meta_data->>'role' is distinct from 'admin' from auth.users
 where id='89000000-0000-0000-0000-000000000011'),'editable signup metadata never grants administrator role');
select test.ok((select count(*) from public.profiles where user_id in ('89000000-0000-0000-0000-000000000011','89000000-0000-0000-0000-000000000012'))=2,
 'registration creates exactly one profile for each new account');

-- Simulate a retained legacy profile with no previously supplied mobile.
update public.profiles set full_name='Retained legacy name',mobile_phone=null
 where user_id='00000000-0000-0000-0000-000000000001';
select test.ok((select full_name='Retained legacy name' and mobile_phone is null from public.profiles
 where user_id='00000000-0000-0000-0000-000000000001'),'legacy profile remains valid without an invented phone');

-- An email-less account cannot bypass signup requirements by adding email later.
insert into auth.users(id,email,raw_user_meta_data) values
 ('89000000-0000-0000-0000-000000000013',null,'{}');
select test.fails($q$update auth.users set email='transition-phone@example.test'
 where id='89000000-0000-0000-0000-000000000013'$q$,'23514',
 'adding the first email to an email-less account still requires mobile');
update auth.users set email='transition-phone@example.test',raw_user_meta_data='{"full_name":"Transition Client","mobile_phone":"+35799876543"}'
 where id='89000000-0000-0000-0000-000000000013';
select test.ok((select mobile_phone='+35799876543' from public.profiles
 where user_id='89000000-0000-0000-0000-000000000013'),'first-email transition copies the validated phone into the profile');
update auth.users set raw_user_meta_data='{}' where id='00000000-0000-0000-0000-000000000001';
update auth.users set email='retained-legacy-email@example.test' where id='00000000-0000-0000-0000-000000000001';
select test.ok((select mobile_phone is null and full_name='Retained legacy name' from public.profiles
 where user_id='00000000-0000-0000-0000-000000000001'),'legacy email changes retain existing profile without inventing a phone');

set local role anon;
set local request.jwt.claims='{"role":"anon"}';
select test.fails('select mobile_phone from public.profiles','42501','anonymous cannot inspect private profile mobiles');
set local role authenticated;
set local request.jwt.claims='{"sub":"89000000-0000-0000-0000-000000000012","role":"authenticated"}';
select test.ok((select mobile_phone from public.profiles where user_id=auth.uid())='+306912345678',
 'account can read its own saved mobile');
select test.ok((select count(*) from public.profiles where user_id='89000000-0000-0000-0000-000000000011')=0,
 'another account cannot read private profile mobile');
select test.fails($q$update public.profiles set mobile_phone='not a phone' where user_id=auth.uid()$q$,'23514',
 'profile update enforces canonical international phone format');
select test.fails($q$insert into public.profiles(user_id,full_name,mobile_phone)
 values('89000000-0000-0000-0000-000000000011','Intrusion','+35799123456') on conflict(user_id)
 do update set mobile_phone=excluded.mobile_phone$q$,'42501','account cannot overwrite another profile mobile');
update public.profiles set mobile_phone='+306998765432' where user_id=auth.uid();
select test.ok((select mobile_phone from public.profiles where user_id=auth.uid())='+306998765432',
 'account can update its own mobile without altering other contacts');
set local request.jwt.claims='{"sub":"89000000-0000-0000-0000-000000000011","role":"authenticated"}';
select test.ok(not private.is_admin(),'role in editable signup metadata cannot grant administrator access');
set local request.jwt.claims='{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
select test.ok(private.owns_salon('30000000-0000-0000-0000-000000000001'),
 'legacy owner without phone retains existing account access');
rollback;
