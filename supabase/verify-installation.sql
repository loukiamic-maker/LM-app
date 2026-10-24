-- Eneres read-only installation verification. No application functions are invoked.
-- Reads only PostgreSQL metadata; no customer/account/booking records are returned.
-- PASS means the listed installation checks match, not a live booking/email test.
with required_tables(name) as (
  values ('public.profiles'),('public.salons'),('public.staff'),('public.services'),
    ('public.staff_hours'),('public.staff_time_off'),('public.bookings'),('private.notification_outbox')
), required_functions(signature, access) as (
  values
    ('public.get_availability(uuid,date,uuid)','public'),
    ('public.create_booking(uuid,uuid,timestamptz,text,uuid)','authenticated'),
    ('public.cancel_booking(uuid)','authenticated'),
    ('public.reschedule_booking(uuid,uuid,timestamptz)','authenticated'),
    ('public.create_salon(text,text,text,text,text)','authenticated'),
    ('public.submit_salon(uuid)','authenticated'),
    ('public.complete_booking(uuid,boolean)','authenticated'),
    ('public.replace_staff_hours(uuid,jsonb)','authenticated'),
    ('public.claim_notifications(integer)','service_role'),
    ('public.ack_notification(uuid,boolean,text)','service_role'),
    ('public.enqueue_due_reminders()','service_role'),
    ('public.notification_is_current(uuid)','service_role')
), required_policies(name, table_name) as (
  values
    ('profiles_self_select','public.profiles'),
    ('profiles_self_insert','public.profiles'),
    ('profiles_self_update','public.profiles'),
    ('salons_public_or_owner','public.salons'),
    ('salons_owner_insert','public.salons'),
    ('salons_owner_update','public.salons'),
    ('salons_admin_update','public.salons'),
    ('salons_admin_select','public.salons'),
    ('staff_public_or_owner','public.staff'),
    ('staff_owner_insert','public.staff'),
    ('staff_owner_update','public.staff'),
    ('staff_owner_delete','public.staff'),
    ('services_public_or_owner','public.services'),
    ('services_owner_insert','public.services'),
    ('services_owner_update','public.services'),
    ('services_owner_delete','public.services'),
    ('hours_public_or_owner','public.staff_hours'),
    ('hours_owner_insert','public.staff_hours'),
    ('hours_owner_update','public.staff_hours'),
    ('hours_owner_delete','public.staff_hours'),
    ('timeoff_owner_select','public.staff_time_off'),
    ('timeoff_owner_insert','public.staff_time_off'),
    ('timeoff_owner_update','public.staff_time_off'),
    ('timeoff_owner_delete','public.staff_time_off'),
    ('bookings_customer_or_owner','public.bookings')
), required_triggers(name, table_name) as (
  values
    ('salons_guard','public.salons'),
    ('staff_hours_guard','public.staff_hours'),
    ('staff_time_off_guard','public.staff_time_off'),
    ('bookings_notify','public.bookings'),
    ('hours_preserve_bookings','public.staff_hours')
), table_checks as (
  select t.name, coalesce(c.relkind in ('r','p') and c.relrowsecurity,false) as ok
  from required_tables t left join pg_class c on c.oid=to_regclass(t.name)
), function_checks as (
  select f.signature,
    coalesce(p.prosecdef and p.proconfig @> array['search_path=""'],false) as definition_ok,
    case f.access
      when 'public' then coalesce(has_function_privilege('anon',p.oid,'EXECUTE')
        and has_function_privilege('authenticated',p.oid,'EXECUTE'),false)
      when 'authenticated' then coalesce(not has_function_privilege('anon',p.oid,'EXECUTE')
        and has_function_privilege('authenticated',p.oid,'EXECUTE'),false)
      else coalesce(not has_function_privilege('anon',p.oid,'EXECUTE')
        and not has_function_privilege('authenticated',p.oid,'EXECUTE')
        and has_function_privilege('service_role',p.oid,'EXECUTE'),false)
    end as access_ok
  from required_functions f left join pg_proc p on p.oid=to_regprocedure(f.signature)
), policy_checks as (
  select r.table_name||'.'||r.name as name, exists (
    select 1 from pg_policy p where p.polrelid=to_regclass(r.table_name) and p.polname=r.name
  ) as ok from required_policies r
), trigger_checks as (
  select r.table_name||'.'||r.name as name, exists (
    select 1 from pg_trigger t where t.tgrelid=to_regclass(r.table_name) and t.tgname=r.name
      and not t.tgisinternal and t.tgenabled in ('O','A')
  ) as ok from required_triggers r
), checks as (
  select 'Table row security' as check_name, bool_and(ok) as ok,
    coalesce(string_agg(name, ', ' order by name) filter(where not ok),'All 8 tables have row security enabled') as details
  from table_checks
  union all
  select 'Booking functions',bool_and(definition_ok),
    coalesce(string_agg(signature, ', ' order by signature) filter(where not definition_ok),'All 12 functions exist with SECURITY DEFINER and an empty search path')
  from function_checks
  union all
  select 'Function access',bool_and(access_ok),
    coalesce(string_agg(signature, ', ' order by signature) filter(where not access_ok),'Public, account-only and worker-only access match')
  from function_checks
  union all
  select 'Required policies',bool_and(ok),
    coalesce(string_agg(name, ', ' order by name) filter(where not ok),'All 25 named policies exist; this does not test their behavior')
  from policy_checks
  union all
  select 'Required triggers',bool_and(ok),
    coalesce(string_agg(name, ', ' order by name) filter(where not ok),'All 5 application triggers exist and are enabled')
  from trigger_checks
  union all
  select 'Double booking prevention',exists (
    select 1 from pg_constraint c join pg_index i on i.indexrelid=c.conindid
    where c.conrelid=to_regclass('public.bookings') and c.conname='bookings_staff_no_overlap'
      and c.contype='x' and c.convalidated and i.indisvalid and i.indisexclusion
  ),'Expected bookings_staff_no_overlap exclusion constraint and valid index'
  union all
  select 'Direct booking writes blocked',
    not coalesce(has_table_privilege('anon',to_regclass('public.bookings'),'INSERT,UPDATE,DELETE,TRUNCATE'),true)
    and not coalesce(has_table_privilege('authenticated',to_regclass('public.bookings'),'INSERT,UPDATE,DELETE,TRUNCATE'),true)
    and not coalesce(has_any_column_privilege('anon',to_regclass('public.bookings'),'INSERT,UPDATE'),true)
    and not coalesce(has_any_column_privilege('authenticated',to_regclass('public.bookings'),'INSERT,UPDATE'),true),
    'Browsers must use the server booking functions'
  union all
  select 'Notification queue private',
    not coalesce(has_table_privilege('anon',to_regclass('private.notification_outbox'),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),true)
    and not coalesce(has_table_privilege('authenticated',to_regclass('private.notification_outbox'),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),true)
    and not coalesce(has_any_column_privilege('anon',to_regclass('private.notification_outbox'),'SELECT,INSERT,UPDATE'),true)
    and not coalesce(has_any_column_privilege('authenticated',to_regclass('private.notification_outbox'),'SELECT,INSERT,UPDATE'),true),
    'Neither browser role can read or modify the private queue'
)
select check_name,case when ok then 'PASS' else 'CHECK NEEDED' end as status,details
from checks order by check_name;
