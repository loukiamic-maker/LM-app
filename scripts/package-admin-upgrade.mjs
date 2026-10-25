// Reproducible copy/paste upgrade for an already installed Eneres project.
// This file packages only migrations 002 and 003, never the initial installer.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactDirectory = resolve(process.argv[2] || '/workspace/artifacts');
const administratorEmail = process.argv[3] || '';
// Keep the generated privileged SQL literal and dollar-quoted block safe.
if (!/^[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(administratorEmail)) {
  throw new Error('Usage: node scripts/package-admin-upgrade.mjs OUTPUT_DIRECTORY ADMIN_EMAIL');
}
const migrationNames = ['202610240002_owner_calendar.sql', '202610240003_admin_billing.sql'];
const migrations = migrationNames.map(name => {
  const original = readFileSync(resolve(root, 'supabase/migrations', name), 'utf8');
  if ((original.match(/^begin;$/gm) || []).length !== 1 || (original.match(/^commit;$/gm) || []).length !== 1) {
    throw new Error(`Unexpected transaction boundaries in ${name}`);
  }
  return `-- SOURCE: ${name}\n${original.replace(/^begin;\n/m, '').replace(/^commit;\n?$/m, '')}`;
});
const emailLiteral = administratorEmail.toLowerCase().replaceAll("'", "''");
const optionalActivation = `
-- The designated account must already exist and have a confirmed email.
-- Missing/unconfirmed accounts do not undo the database upgrade. Re-run this
-- upgrade after confirmation, or use the separate activate-admin.sql template.
do $admin$
declare
  target_email constant text := '${emailLiteral}';
  target_id uuid;
  confirmed_at timestamptz;
  matches integer;
begin
  select count(*) into matches from auth.users where lower(email) = target_email;
  if matches <> 1 then
    raise notice 'Database upgrade installed. Administrator not activated: create and confirm the designated website account, then run this upgrade again';
    return;
  end if;
  select id, email_confirmed_at into target_id, confirmed_at
    from auth.users where lower(email) = target_email for update;
  if confirmed_at is null then
    raise notice 'Database upgrade installed. Administrator not activated: confirm the designated account email, then run this upgrade again';
    return;
  end if;
  update auth.users
    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
    where id = target_id;
  raise notice 'Administrator activated. Sign in again or choose Refresh access on the administration page';
end
$admin$;

notify pgrst, 'reload schema';
commit;

-- Read-only feature checks. ACTION NEEDED for the account does not mean the
-- schema upgrade failed. Card payments need separate secure Stripe setup.
select check_name, status, details from (
  select 1 as sort_order, 'Manual booking functions'::text as check_name,
    case when to_regprocedure('public.create_manual_booking(uuid,uuid,uuid,timestamptz,text,uuid,text,text,integer,integer,text)') is not null
      and to_regprocedure('public.edit_manual_booking(uuid,uuid,uuid,timestamptz,text,text,text,integer,integer,text)') is not null then 'PASS' else 'CHECK NEEDED' end as status,
    'Owner-entered and online appointments share the protected booking calendar'::text as details
  union all select 2, 'Administrator functions',
    case when to_regprocedure('public.admin_overview(integer)') is not null and to_regprocedure('public.admin_review_salon(uuid,text,text)') is not null
      and to_regprocedure('public.admin_get_salon(uuid)') is not null then 'PASS' else 'CHECK NEEDED' end,
    'Business requests, review and real platform statistics'
  union all select 3, 'Monthly subscription functions',
    case when to_regprocedure('public.admin_set_platform_billing(integer,boolean)') is not null
      and to_regprocedure('public.get_business_billing(uuid)') is not null and to_regprocedure('public.admin_create_business_charge(uuid,date,date,integer,date)') is not null then 'PASS' else 'CHECK NEEDED' end,
    'The administrator chooses the monthly euro amount; no example price is installed'
  union all select 4, 'Billing row security',
    case when (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
      and c.relname in ('platform_billing_settings','business_subscriptions','business_charges','business_reviews') and c.relrowsecurity)=4 then 'PASS' else 'CHECK NEEDED' end,
    'Subscription records are protected by row-level security'
  union all select 5, 'Designated administrator account',
    case when (select count(*) from auth.users where lower(email)='${emailLiteral}' and email_confirmed_at is not null and raw_app_meta_data->>'role'='admin')=1 then 'PASS' else 'ACTION NEEDED' end,
    'Create and confirm the designated website account, then run this upgrade again if access is not yet enabled'
  union all select 6, 'Card subscription integration', 'SEPARATE SETUP',
    'Stripe account, private server settings, deployed functions and signed webhook tests are required before accepting card subscriptions'
) checks order by sort_order;
`;
const sql = `-- Eneres existing-project upgrade: manual calendar + administration + monthly business billing
-- Run in your existing project's privileged Supabase SQL Editor.
-- Requires the original booking platform installation. Safe to re-run.
-- Does not reset tables or create sample salons, accounts, bookings or card charges.
-- Administrator account: ${administratorEmail}
begin;
\n${migrations.join('\n')}\n${optionalActivation}`;
mkdirSync(artifactDirectory, { recursive: true });
const output = resolve(artifactDirectory, 'eneres-admin-calendar-upgrade.sql');
writeFileSync(output, sql);
process.stdout.write(`Created ${output}\n`);
