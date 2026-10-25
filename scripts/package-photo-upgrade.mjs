// A copy/paste upgrade for existing Supabase projects. Never includes test bootstrap.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(process.argv[2] || '/workspace/artifacts');
const migration = readFileSync(resolve(root, 'supabase/migrations/202610250004_salon_photos.sql'), 'utf8');
const checks = `
-- Read-only installation checks. Bucket limits are enforced by Supabase Storage.
select check_name,status,details from (
  select 1 as sort_order,'Salon photo bucket'::text as check_name,
    case when exists(select 1 from storage.buckets where id='salon-photos' and public
      and file_size_limit=5242880 and allowed_mime_types=array['image/jpeg','image/png','image/webp'])
      then 'PASS' else 'CHECK NEEDED' end as status,
    'Public salon photographs; JPEG, PNG or WebP; up to 5 MiB'::text as details
  union all select 2,'Owner upload policies',
    case when (select count(*) from pg_policies where schemaname='storage' and tablename='objects'
      and policyname in ('eneres_salon_photos_owner_select','eneres_salon_photos_owner_insert','eneres_salon_photos_owner_update','eneres_salon_photos_owner_delete'))=4
      then 'PASS' else 'CHECK NEEDED' end,
    'Verified owners can manage only their own salon UUID directory'
  union all select 3,'Storage row security',
    case when (select relrowsecurity from pg_class where oid='storage.objects'::regclass) then 'PASS' else 'CHECK NEEDED' end,
    'Storage objects retain their existing row security'
  union all select 4,'Photo helper access',
    case when has_function_privilege('authenticated','private.can_manage_salon_photo(text,text)','execute')
      and not has_function_privilege('anon','private.can_manage_salon_photo(text,text)','execute')
      then 'PASS' else 'CHECK NEEDED' end,
    'Anonymous users cannot call the ownership helper or upload photos'
  union all select 5,'Bucket ownership guards',
    case when (select count(*) from pg_policies where schemaname='storage' and tablename='objects'
      and policyname in ('eneres_salon_photos_guard_authenticated','eneres_salon_photos_guard_anonymous')
      and permissive='RESTRICTIVE')=2 then 'PASS' else 'CHECK NEEDED' end,
    'Existing broad Storage permissions cannot bypass salon ownership; unrelated buckets retain their policies'
) checks order by sort_order;
`;
mkdirSync(outputDirectory, { recursive: true });
const output = resolve(outputDirectory, 'eneres-photo-upload-setup.sql');
writeFileSync(output, `-- Eneres 04 - Salon photo uploads\n-- Run in the existing project's privileged SQL Editor after the earlier upgrades.\n-- Safe to rerun; no accounts, salons, bookings or objects are deleted.\n\n${migration}\n${checks}`);
process.stdout.write(`Created ${output}\n`);
