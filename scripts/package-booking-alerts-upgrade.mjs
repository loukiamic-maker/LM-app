// Produce the additive copy/paste upgrade for existing Eneres installations.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const directory=resolve(process.argv[2]||'/workspace/artifacts');
const migration=readFileSync(resolve(root,'supabase/migrations/202610250005_booking_alerts.sql'),'utf8');
const checks=`
-- Installation checks only. No example customer, booking or alert is created.
select check_name,status,details from (
  select 1 as sort_order,'Business booking inbox'::text as check_name,
    case when (select relrowsecurity from pg_class where oid=to_regclass('public.business_booking_alerts'))
      and not has_table_privilege('authenticated','public.business_booking_alerts','insert,update,delete')
      then 'PASS' else 'CHECK NEEDED' end as status,
    'Owner-only alert history; browsers cannot forge or remove inbox entries'::text as details
  union all select 2,'Inbox acknowledgement and cancellation',
    case when to_regprocedure('public.acknowledge_business_booking(uuid)') is not null
      and to_regprocedure('public.cancel_business_booking(uuid,text)') is not null
      and to_regprocedure('public.cancel_booking_with_note(uuid,text)') is not null then 'PASS' else 'CHECK NEEDED' end,
    'The verified owner can note a booking or cancel it with an explanation'
  union all select 3,'Customer mobile and appointment notes',
    case when to_regprocedure('public.create_booking_with_contact(uuid,uuid,timestamptz,text,uuid,text,text)') is not null
      and exists(select 1 from information_schema.columns where table_schema='public' and table_name='bookings' and column_name='cancellation_note')
      then 'PASS' else 'CHECK NEEDED' end,
    'New checkout saves the mobile number and notes with the actual shared booking'
  union all select 4,'Anonymous inbox access blocked',
    case when not has_function_privilege('anon','public.list_business_booking_alerts(uuid,integer,integer)','execute')
      and not has_table_privilege('anon','public.business_booking_alerts','select') then 'PASS' else 'CHECK NEEDED' end,
    'No customer contacts are exposed in the public directory'
  union all select 5,'Transactional booking alerts',
    case when exists(select 1 from pg_trigger where tgrelid='public.bookings'::regclass and tgname='bookings_business_alert' and tgenabled<>'D')
      then 'PASS' else 'CHECK NEEDED' end,
    'Online bookings and their alerts are saved in the same transaction; cancellations preserve history'
  union all select 6,'Signup mobile and private account contact',
    case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='mobile_phone')
      and (select count(*) from pg_trigger where tgrelid='auth.users'::regclass
        and tgname in ('eneres_signup_mobile_required','eneres_signup_profile') and tgenabled<>'D')=2
      then 'PASS' else 'CHECK NEEDED' end,
    'New email registrations require an international mobile; legacy accounts keep their existing data'
) checks order by sort_order;
`;
mkdirSync(directory,{recursive:true});
const output=resolve(directory,'eneres-booking-alerts-setup.sql');
writeFileSync(output,`-- Eneres - Booking notifications and customer contact setup\n-- Apply in the existing project's privileged SQL Editor. Safe to re-run.\n-- Requires the earlier shared-calendar upgrade; never rerun the initial installer.\n\n${migration}\n${checks}`);
console.log(`Created ${output}`);
