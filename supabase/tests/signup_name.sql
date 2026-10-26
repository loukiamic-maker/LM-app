\set ON_ERROR_STOP on
-- Disposable local Auth fixtures only. Never run this test on a hosted project.
begin;
reset role;
set local request.jwt.claims='{}';
create schema signup_name_test;
create function signup_name_test.create_account(p_name jsonb) returns uuid language sql as $$
 insert into auth.users(id,email,raw_user_meta_data)
 values(gen_random_uuid(),gen_random_uuid()::text||'@example.test',
 jsonb_build_object('mobile_phone','+35799123456')||case when p_name is null then '{}'::jsonb else jsonb_build_object('full_name',p_name) end)
 returning id
$$;
select test.ok((select bool_and(prosecdef and proconfig@>array['search_path=""']) from pg_proc
 where oid in ('private.require_signup_mobile()'::regprocedure,'private.create_signup_profile()'::regprocedure)),
 'signup-name validation and profile creation use security definer with empty search paths');
select test.ok(not has_function_privilege('anon','private.require_signup_mobile()','execute')
 and not has_function_privilege('authenticated','private.require_signup_mobile()','execute')
 and not has_function_privilege('anon','private.create_signup_profile()','execute')
 and not has_function_privilege('authenticated','private.create_signup_profile()','execute'),
 'signup-name upgrade retains private trigger-helper permissions');
select test.fails($q$select signup_name_test.create_account(null)$q$,'23514','new signup requires full name even when mobile is valid');
select test.fails($q$select signup_name_test.create_account('null'::jsonb)$q$,'23514','new signup rejects a null full name');
select test.fails($q$select signup_name_test.create_account('""'::jsonb)$q$,'23514','new signup rejects an empty full name');
select test.fails($q$select signup_name_test.create_account(to_jsonb(E' \t\n '::text))$q$,'23514','new signup rejects whitespace-only full name');
select test.fails($q$select signup_name_test.create_account('"Α"'::jsonb)$q$,'23514','new signup requires at least two name characters');
select test.fails($q$select signup_name_test.create_account(to_jsonb(repeat('α',81)))$q$,'23514','new signup rejects names longer than eighty characters');
select test.fails($q$select signup_name_test.create_account('12'::jsonb)$q$,'23514','new signup rejects numeric name metadata');
select test.fails($q$select signup_name_test.create_account('["Άννα"]'::jsonb)$q$,'23514','new signup rejects array name metadata');
select signup_name_test.create_account(to_jsonb(E' \tΆννα Παπαδοπούλου\n '::text)) as greek_signup \gset
select test.ok((select raw_user_meta_data->>'full_name'='Άννα Παπαδοπούλου'
 and raw_user_meta_data->>'mobile_phone'='+35799123456' from auth.users where id=:'greek_signup'),
 'valid Greek signup name is trimmed in Auth metadata alongside its mobile');
select test.ok((select full_name='Άννα Παπαδοπούλου' and mobile_phone='+35799123456'
 from public.profiles where user_id=:'greek_signup'),'valid Greek signup saves the normalized name and mobile in its private profile');
select test.ok((select email_confirmed_at is null from auth.users where id=:'greek_signup'),
 'supplying a name and mobile does not fabricate verification');
select signup_name_test.create_account(to_jsonb(repeat('α',80))) as boundary_signup \gset
select test.ok(char_length((select raw_user_meta_data->>'full_name' from auth.users
 where id=:'boundary_signup'))=80,'signup accepts an eighty-character name at the supported boundary');

-- Email-less Auth identities only become email accounts after both fields validate.
insert into auth.users(id,email,raw_user_meta_data) values
 ('97000000-0000-0000-0000-000000000001',null,'{}'),
 ('97000000-0000-0000-0000-000000000002',null,'{"full_name":"Retained profile name","mobile_phone":"+35799777777"}'),
 ('97000000-0000-0000-0000-000000000003',null,'{"full_name":"   ","mobile_phone":"+35799777777"}');
select test.fails($q$update auth.users set email='first-email-name@example.test',
 raw_user_meta_data='{"mobile_phone":"+35799123456"}' where id='97000000-0000-0000-0000-000000000001'$q$,'23514',
 'first-email transition requires a name even with a valid mobile');
select test.ok((select email is null from auth.users where id='97000000-0000-0000-0000-000000000001'),
 'rejected first-email transition does not partially update Auth');
update auth.users set email='first-email-name@example.test',
 raw_user_meta_data='{"full_name":"  Ελένη Νικολάου  ","mobile_phone":"+35799123456"}'
 where id='97000000-0000-0000-0000-000000000001';
select test.ok((select full_name='Ελένη Νικολάου' and mobile_phone='+35799123456' from public.profiles
 where user_id='97000000-0000-0000-0000-000000000001'),'first-email transition fills a blank profile name from validated metadata');
update auth.users set email='retained-first-email-name@example.test',
 raw_user_meta_data='{"full_name":"New metadata name","mobile_phone":"+35799123456"}'
 where id='97000000-0000-0000-0000-000000000002';
select test.ok((select full_name='Retained profile name' and mobile_phone='+35799777777' from public.profiles
 where user_id='97000000-0000-0000-0000-000000000002'),'first-email transition preserves nonblank existing profile names and mobile numbers');

update auth.users set email='blank-profile-name@example.test',
 raw_user_meta_data='{"full_name":"Μαρία Γεωργίου","mobile_phone":"+35799123456"}'
 where id='97000000-0000-0000-0000-000000000003';
select test.ok((select full_name='Μαρία Γεωργίου' and mobile_phone='+35799777777' from public.profiles
 where user_id='97000000-0000-0000-0000-000000000003'),'first-email transition fills a whitespace-only profile name even when its mobile was already saved');

-- Model a grandfathered account. The new rules must not prevent normal email or
-- metadata updates on an existing email account, and reruns must not rewrite it.
insert into auth.users(id,email,email_confirmed_at) values
 ('97000000-0000-0000-0000-000000000010','legacy-nameless@example.test',now());
update auth.users set raw_user_meta_data='{}' where id='97000000-0000-0000-0000-000000000010';
update public.profiles set full_name='',mobile_phone=null where user_id='97000000-0000-0000-0000-000000000010';
update auth.users set email='legacy-retained@example.test' where id='97000000-0000-0000-0000-000000000010';
select test.ok((select u.email='legacy-retained@example.test' and u.raw_user_meta_data='{}'::jsonb
 and p.full_name='' and p.mobile_phone is null from auth.users u join public.profiles p on p.user_id=u.id
 where u.id='97000000-0000-0000-0000-000000000010'),'existing email accounts remain usable without inventing a name or mobile');
create table signup_name_test.before_upgrade as select to_jsonb(u) as account,to_jsonb(p) as profile
 from auth.users u join public.profiles p on p.user_id=u.id where u.id='97000000-0000-0000-0000-000000000010';
commit;
