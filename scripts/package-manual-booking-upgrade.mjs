// Package the additive required-field upgrade for the Supabase SQL Editor.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(process.argv[2] || '/workspace/artifacts');
const migration = readFileSync(resolve(root, 'supabase/migrations/202610260006_manual_booking_requirements.sql'), 'utf8');
const checks = `
-- Read-only installation checks. These do not create appointments or change data.
select 'Required manual booking fields' as check_name,
 case when position('CUSTOMER_PHONE_REQUIRED' in pg_get_functiondef('private.prepare_manual_booking(uuid,uuid,uuid,timestamptz,text,text,text,integer,integer,text,uuid)'::regprocedure))>0
  and position('MANUAL_BOOKING_PRICE_REQUIRED' in pg_get_functiondef('private.prepare_manual_booking(uuid,uuid,uuid,timestamptz,text,text,text,integer,integer,text,uuid)'::regprocedure))>0
  then 'PASS' else 'CHECK NEEDED' end as status,
 'New and edited manual appointments require client name, phone, service, explicit price, professional and date/time' as details
union all
select 'Shared overlap protection',
 case when exists(select 1 from pg_constraint c join pg_index i on i.indexrelid=c.conindid
  where c.conrelid='public.bookings'::regclass and c.conname='bookings_staff_no_overlap' and c.contype='x' and c.convalidated and i.indisvalid)
 then 'PASS' else 'CHECK NEEDED' end,
 'Online and manual appointments share the protected calendar; simultaneous work by different professionals is allowed'
union all
select 'Private validation helper',
 case when not has_function_privilege('anon','private.prepare_manual_booking(uuid,uuid,uuid,timestamptz,text,text,text,integer,integer,text,uuid)','execute')
 and not has_function_privilege('authenticated','private.prepare_manual_booking(uuid,uuid,uuid,timestamptz,text,text,text,integer,integer,text,uuid)','execute')
 then 'PASS' else 'CHECK NEEDED' end,
 'Browsers cannot bypass the owner-only booking functions'
union all
select 'Existing appointments','PRESERVED','This upgrade only replaces validation logic and does not rewrite existing appointments';
`;
mkdirSync(directory, { recursive: true });
const output = resolve(directory, 'eneres-manual-booking-requirements.sql');
writeFileSync(output, `${migration}
${checks}`);
console.log(`Created ${output}`);
