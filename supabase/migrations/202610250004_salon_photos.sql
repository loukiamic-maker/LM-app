-- Device-uploaded salon photographs. Apply after the existing booking migrations.
-- Supabase manages storage.buckets/storage.objects; this migration never recreates them.
-- Public image URLs can be viewed without login, including an owner's draft photograph.
begin;

do $$
begin
  if to_regclass('public.salons') is null or to_regclass('auth.users') is null then
    raise exception 'Install the Eneres booking platform before the salon-photo upgrade';
  end if;
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise exception 'Supabase Storage is not available in this project; enable Storage before running this upgrade';
  end if;
  if not (select relrowsecurity from pg_class where oid='storage.objects'::regclass) then
    raise exception 'Supabase Storage object row security must be enabled before installing upload policies';
  end if;
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('salon-photos','salon-photos',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  name=excluded.name,
  public=excluded.public,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

-- Both directory and filename must be UUIDs. No nested folders, traversal, SVG,
-- HTML or arbitrary suffixes are accepted. The first UUID is the actual salon ID.
create or replace function private.can_manage_salon_photo(p_bucket text,p_object_name text)
returns boolean language sql stable security definer set search_path='' as $$
  select case
    when p_bucket='salon-photos'
      and p_object_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
    then exists (
      select 1 from public.salons s join auth.users u on u.id=s.owner_id
      where s.id=split_part(p_object_name,'/',1)::uuid
        and s.owner_id=auth.uid() and u.email is not null and u.email_confirmed_at is not null
    )
    else false
  end
$$;
revoke all on function private.can_manage_salon_photo(text,text) from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.can_manage_salon_photo(text,text) to authenticated;

-- Reading a public image by URL is handled by Storage's public bucket endpoint.
-- Bucket metadata/listing and all object mutations remain limited to its owner.
drop policy if exists eneres_salon_photos_owner_select on storage.objects;
create policy eneres_salon_photos_owner_select on storage.objects
  for select to authenticated
  using (private.can_manage_salon_photo(bucket_id,name));

drop policy if exists eneres_salon_photos_owner_insert on storage.objects;
create policy eneres_salon_photos_owner_insert on storage.objects
  for insert to authenticated
  with check (private.can_manage_salon_photo(bucket_id,name));

drop policy if exists eneres_salon_photos_owner_update on storage.objects;
create policy eneres_salon_photos_owner_update on storage.objects
  for update to authenticated
  using (private.can_manage_salon_photo(bucket_id,name))
  with check (private.can_manage_salon_photo(bucket_id,name));

drop policy if exists eneres_salon_photos_owner_delete on storage.objects;
create policy eneres_salon_photos_owner_delete on storage.objects
  for delete to authenticated
  using (private.can_manage_salon_photo(bucket_id,name));

-- Permissive Storage policies are OR-combined. These bucket-scoped restrictive
-- guards prevent any pre-existing broad policy from bypassing owner isolation.
-- For every other bucket they evaluate true and preserve its existing policies.
drop policy if exists eneres_salon_photos_guard_authenticated on storage.objects;
create policy eneres_salon_photos_guard_authenticated on storage.objects as restrictive
  for all to authenticated
  using (bucket_id<>'salon-photos' or private.can_manage_salon_photo(bucket_id,name))
  with check (bucket_id<>'salon-photos' or private.can_manage_salon_photo(bucket_id,name));

drop policy if exists eneres_salon_photos_guard_anonymous on storage.objects;
create policy eneres_salon_photos_guard_anonymous on storage.objects as restrictive
  for all to anon
  using (bucket_id<>'salon-photos')
  with check (bucket_id<>'salon-photos');

commit;
