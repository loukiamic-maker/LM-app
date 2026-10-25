\set ON_ERROR_STOP on
-- Fixture preparation for the isolated script/test-photo-storage.sh container only.
begin;
insert into auth.users(id,email,email_confirmed_at) values ('95000000-0000-0000-0000-000000000101','photo-rerun@example.test',now());
insert into public.salons(id,owner_id,name,category,city,country,address,image_url) values
 ('95000000-0000-0000-0000-000000000001','95000000-0000-0000-0000-000000000101','Photo rerun preservation','hair','Αθήνα','Ελλάδα','Photo rerun street 1','https://example.test/previous-image.jpg');
insert into storage.buckets(id,name,public,file_size_limit) values('preserved-photo-test-bucket','preserved-photo-test-bucket',false,12345);
insert into storage.objects(bucket_id,name,metadata) values
 ('salon-photos','95000000-0000-0000-0000-000000000001/95000000-0000-0000-0000-000000000201.jpg','{"fixture":"preserve"}'),
 ('preserved-photo-test-bucket','unrelated-object.txt','{"fixture":"unrelated"}');
create policy photo_fixture_unrelated_select on storage.objects for select to authenticated using(bucket_id='preserved-photo-test-bucket');
commit;
