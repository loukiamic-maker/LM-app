\set ON_ERROR_STOP on
-- Local fixtures only. The transaction rolls back every user, salon and object.
begin;

select test.ok((select public and file_size_limit=5242880
  and allowed_mime_types=array['image/jpeg','image/png','image/webp']
  from storage.buckets where id='salon-photos'),'photo bucket is public with a 5 MiB limit and JPEG/PNG/WebP only');
select test.ok((select relrowsecurity from pg_class where oid='storage.objects'::regclass),'photo objects retain row security');
select test.ok(not has_function_privilege('anon','private.can_manage_salon_photo(text,text)','execute'),'anonymous cannot call photo ownership helper');
select test.ok(has_function_privilege('authenticated','private.can_manage_salon_photo(text,text)','execute'),'authenticated sessions can use photo ownership helper');
select test.ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='private.can_manage_salon_photo(text,text)'::regprocedure),'photo ownership helper has trusted definer and empty search path');
select test.ok((select count(*)=4 from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'eneres_salon_photos_owner_%'),'all four named photo policies are installed');
select test.ok((select count(*)=2 from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'eneres_salon_photos_guard_%' and permissive='RESTRICTIVE'),'restrictive guards protect the salon bucket against broad existing permissions');

insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
 ('94000000-0000-0000-0000-000000000101','photo-owner@example.test',now(),'{}'),
 ('94000000-0000-0000-0000-000000000102','other-photo-owner@example.test',now(),'{}'),
 ('94000000-0000-0000-0000-000000000103','unconfirmed-photo-owner@example.test',null,'{}'),
 ('94000000-0000-0000-0000-000000000104','photo-admin@example.test',now(),'{"role":"admin"}');
insert into public.salons(id,owner_id,name,category,city,country,address) values
 ('94000000-0000-0000-0000-000000000001','94000000-0000-0000-0000-000000000101','Photo Owner Salon','hair','Αθήνα','Ελλάδα','Photo test street 1'),
 ('94000000-0000-0000-0000-000000000002','94000000-0000-0000-0000-000000000102','Other Photo Salon','nails','Λευκωσία','Κύπρος','Photo test street 2'),
 ('94000000-0000-0000-0000-000000000003','94000000-0000-0000-0000-000000000103','Unconfirmed Photo Salon','hair','Αθήνα','Ελλάδα','Photo test street 3');
insert into storage.buckets(id,name) values('photo-unrelated-fixture','photo-unrelated-fixture');
insert into storage.objects(bucket_id,name) values
 ('salon-photos','94000000-0000-0000-0000-000000000002/94000000-0000-0000-0000-000000000202.jpg'),
 ('salon-photos','94000000-0000-0000-0000-000000000003/94000000-0000-0000-0000-000000000203.jpg');

set local role authenticated;
set local request.jwt.claims='{"sub":"94000000-0000-0000-0000-000000000101","role":"authenticated"}';
select test.ok(private.can_manage_salon_photo('salon-photos','94000000-0000-0000-0000-000000000001/94000000-0000-0000-0000-000000000201.jpg'),'verified owner may manage their salon photo path');
insert into storage.objects(bucket_id,name,metadata) values
 ('salon-photos','94000000-0000-0000-0000-000000000001/94000000-0000-0000-0000-000000000201.jpg','{"mimetype":"image/jpeg","size":1200}');
select test.ok((select count(*)=1 from storage.objects where bucket_id='salon-photos'),'owner can list only their own object metadata');
select test.fails($q$insert into storage.objects(bucket_id,name) values('salon-photos','94000000-0000-0000-0000-000000000002/94000000-0000-0000-0000-000000000204.jpg')$q$,'42501','owner cannot upload into another salon directory');
select test.fails($q$insert into storage.objects(bucket_id,name) values('salon-photos','not-a-uuid/94000000-0000-0000-0000-000000000204.jpg')$q$,'42501','malformed salon directory is denied without unsafe UUID casting');
select test.fails($q$insert into storage.objects(bucket_id,name) values('salon-photos','94000000-0000-0000-0000-000000000001/../94000000-0000-0000-0000-000000000204.jpg')$q$,'42501','nested or traversal photo paths are denied');
select test.fails($q$insert into storage.objects(bucket_id,name) values('salon-photos','94000000-0000-0000-0000-000000000001/94000000-0000-0000-0000-000000000204.svg')$q$,'42501','SVG object paths are denied');
select test.fails($q$insert into storage.objects(bucket_id,name) values('salon-photos','94000000-0000-0000-0000-000000000001/94000000-0000-0000-0000-000000000204.gif')$q$,'42501','unsupported image suffix is denied');
select test.fails($q$insert into storage.objects(bucket_id,name) values('salon-photos','94000000-0000-0000-0000-000000000001/photo.jpg')$q$,'42501','non-UUID photo filename is denied');
select test.fails($q$insert into storage.objects(bucket_id,name) values('photo-unrelated-fixture','94000000-0000-0000-0000-000000000001/94000000-0000-0000-0000-000000000204.jpg')$q$,'42501','photo upload permissions do not grant access to another bucket');
select test.fails($q$update storage.objects set name='94000000-0000-0000-0000-000000000002/94000000-0000-0000-0000-000000000201.jpg' where name='94000000-0000-0000-0000-000000000001/94000000-0000-0000-0000-000000000201.jpg'$q$,'42501','owner cannot move an object into another salon directory');
update storage.objects set metadata='{"mimetype":"image/jpeg","size":1300}' where name='94000000-0000-0000-0000-000000000001/94000000-0000-0000-0000-000000000201.jpg';
select test.ok((select (metadata->>'size')::integer=1300 from storage.objects where name='94000000-0000-0000-0000-000000000001/94000000-0000-0000-0000-000000000201.jpg'),'verified owner can update their object metadata');

set local request.jwt.claims='{"sub":"94000000-0000-0000-0000-000000000102","role":"authenticated"}';
select test.ok((select count(*)=0 from storage.objects where name='94000000-0000-0000-0000-000000000001/94000000-0000-0000-0000-000000000201.jpg'),'another owner cannot read private object metadata');
with removed as (delete from storage.objects where name='94000000-0000-0000-0000-000000000001/94000000-0000-0000-0000-000000000201.jpg' returning id)
select test.ok((select count(*)=0 from removed),'another owner cannot remove another salon photograph');
with changed as (update storage.objects set metadata='{}' where name='94000000-0000-0000-0000-000000000001/94000000-0000-0000-0000-000000000201.jpg' returning id)
select test.ok((select count(*)=0 from changed),'another owner cannot replace another salon photograph');

set local request.jwt.claims='{"sub":"94000000-0000-0000-0000-000000000103","role":"authenticated"}';
select test.ok(not private.can_manage_salon_photo('salon-photos','94000000-0000-0000-0000-000000000003/94000000-0000-0000-0000-000000000203.jpg'),'unverified owner cannot manage photographs');
select test.fails($q$insert into storage.objects(bucket_id,name) values('salon-photos','94000000-0000-0000-0000-000000000003/94000000-0000-0000-0000-000000000204.jpg')$q$,'42501','unverified owner cannot upload');
select test.ok((select count(*)=0 from storage.objects),'unverified owner cannot list storage metadata');

set local request.jwt.claims='{"sub":"94000000-0000-0000-0000-000000000104","role":"authenticated"}';
select test.fails($q$insert into storage.objects(bucket_id,name) values('salon-photos','94000000-0000-0000-0000-000000000001/94000000-0000-0000-0000-000000000204.jpg')$q$,'42501','administrator browser role cannot upload on behalf of an unrelated owner');

set local role anon;
set local request.jwt.claims='{"role":"anon"}';
select test.ok((select count(*)=0 from storage.objects),'anonymous cannot list salon storage metadata');
select test.fails($q$insert into storage.objects(bucket_id,name) values('salon-photos','94000000-0000-0000-0000-000000000001/94000000-0000-0000-0000-000000000204.jpg')$q$,'42501','anonymous cannot upload photographs');
with removed as (delete from storage.objects returning id)
select test.ok((select count(*)=0 from removed),'anonymous cannot delete photographs');

set local role authenticated;
set local request.jwt.claims='{"sub":"94000000-0000-0000-0000-000000000101","role":"authenticated"}';
with removed as (delete from storage.objects where name='94000000-0000-0000-0000-000000000001/94000000-0000-0000-0000-000000000201.jpg' returning id)
select test.ok((select count(*)=1 from removed),'verified owner can remove their own photograph');
reset role;
select test.ok((select count(*)=2 from storage.objects where bucket_id='salon-photos' and name like '94000000-%'),'protected photographs of other owners remain unchanged');

-- An existing project's unrelated global policy must not OR-bypass owner checks.
create policy photo_fixture_global_access on storage.objects for all to anon,authenticated using(true) with check(true);
set local role authenticated;
set local request.jwt.claims='{"sub":"94000000-0000-0000-0000-000000000101","role":"authenticated"}';
select test.ok((select count(*)=0 from storage.objects where bucket_id='salon-photos'),'broad existing read policy cannot reveal other salon metadata');
select test.fails($q$insert into storage.objects(bucket_id,name) values('salon-photos','94000000-0000-0000-0000-000000000002/94000000-0000-0000-0000-000000000204.jpg')$q$,'42501','broad existing insert policy cannot bypass another salon ownership');
with changed as (update storage.objects set metadata='{}' where bucket_id='salon-photos' returning id)
select test.ok((select count(*)=0 from changed),'broad existing update policy cannot replace another salon photograph');
with removed as (delete from storage.objects where bucket_id='salon-photos' returning id)
select test.ok((select count(*)=0 from removed),'broad existing delete policy cannot remove another salon photograph');
insert into storage.objects(bucket_id,name) values('photo-unrelated-fixture','preserve-other-bucket-permission.txt');
select test.ok((select count(*)=1 from storage.objects where bucket_id='photo-unrelated-fixture'),'restrictive guards retain existing permissions for unrelated buckets');
set local role anon;
set local request.jwt.claims='{"role":"anon"}';
select test.fails($q$insert into storage.objects(bucket_id,name) values('salon-photos','94000000-0000-0000-0000-000000000001/94000000-0000-0000-0000-000000000204.jpg')$q$,'42501','broad existing policy cannot allow anonymous photo upload');
select test.ok((select count(*)=0 from storage.objects where bucket_id='salon-photos'),'broad existing policy cannot allow anonymous metadata listing');
select test.ok((select count(*)=1 from storage.objects where bucket_id='photo-unrelated-fixture'),'anonymous permissions for unrelated buckets are preserved');

rollback;
