\set ON_ERROR_STOP on
-- Local disposable PostgreSQL fixtures only. Never run tests on a hosted project.
begin;
create schema manual_test;
create function manual_test.create_entry(
 p_name text default 'Manual customer',p_phone text default '99123456',p_price integer default 3500,
 p_service uuid default '92000000-0000-0000-0000-000000000001',
 p_staff uuid default '91000000-0000-0000-0000-000000000001',
 p_start timestamptz default calendar_test.slot(60,'10:00')
) returns public.bookings language sql as $$
 select public.create_manual_booking('93000000-0000-0000-0000-000000000001',p_service,p_staff,p_start,p_name,
 gen_random_uuid(),null,p_phone,60,p_price)
$$;
create function manual_test.edit_entry(
 p_id uuid,p_name text default 'Edited customer',p_phone text default '99887766',p_price integer default 4000,
 p_service uuid default '92000000-0000-0000-0000-000000000001',
 p_staff uuid default '91000000-0000-0000-0000-000000000001',
 p_start timestamptz default calendar_test.slot(60,'10:00')
) returns public.bookings language sql as $$
 select public.edit_manual_booking(p_id,p_service,p_staff,p_start,p_name,null,p_phone,60,p_price)
$$;
grant usage on schema manual_test to authenticated;
grant execute on all functions in schema manual_test to authenticated;
set local role authenticated;
set local request.jwt.claims='{"sub":"90000000-0000-0000-0000-000000000001","role":"authenticated"}';
select calendar_test.fails($q$select manual_test.create_entry(p_name=>null)$q$,'23514','manual creation requires client name');
select calendar_test.fails($q$select manual_test.create_entry(p_name=>'  ')$q$,'23514','manual creation rejects blank client name');
select calendar_test.fails($q$select manual_test.create_entry(p_phone=>null)$q$,'23514','manual creation requires client phone');
select calendar_test.fails($q$select manual_test.create_entry(p_phone=>'  ( ) - ')$q$,'23514','manual creation rejects blank phone after formatting');
select calendar_test.fails($q$select manual_test.create_entry(p_phone=>'1234567')$q$,'23514','manual phone requires at least eight digits');
select calendar_test.fails($q$select manual_test.create_entry(p_phone=>'1234567890123456')$q$,'23514','manual phone permits at most fifteen digits');
select calendar_test.fails($q$select manual_test.create_entry(p_phone=>'+35799abc000')$q$,'23514','manual phone rejects letters');
select calendar_test.fails($q$select manual_test.create_entry(p_phone=>'++35799000000')$q$,'23514','manual phone permits one leading country-code plus');
select calendar_test.fails($q$select manual_test.create_entry(p_price=>null)$q$,'23514','manual creation requires explicit price rather than a catalogue fallback');
select calendar_test.fails($q$select manual_test.create_entry(p_price=>-1)$q$,'23514','manual price rejects negative amounts');
select calendar_test.fails($q$select manual_test.create_entry(p_price=>1000001)$q$,'23514','manual price rejects amounts beyond the supported limit');
select calendar_test.fails($q$select manual_test.create_entry(p_service=>null)$q$,'P0001','manual creation requires service');
select calendar_test.fails($q$select manual_test.create_entry(p_staff=>null)$q$,'P0001','manual creation requires professional');
select calendar_test.fails($q$select manual_test.create_entry(p_start=>null)$q$,'23514','manual creation requires appointment date and time');
select calendar_test.fails($q$select manual_test.create_entry(p_start=>calendar_test.slot(60,'10:00:01'))$q$,'23514','manual appointment time must have minute precision');
select calendar_test.fails($q$select manual_test.create_entry(p_start=>'infinity'::timestamptz)$q$,'23514','manual creation rejects infinite date');
select (manual_test.create_entry(p_phone=>' +357 (99) 123-456 ',p_price=>0)).id as mandatory_booking \gset
select calendar_test.ok((select customer_phone='+35799123456' and price_cents=0 and booking_source='offline' from public.bookings where id=:'mandatory_booking'),'manual creation normalizes formatted phone and permits an explicit zero price');
select calendar_test.fails(format('select manual_test.edit_entry(%L,p_name=>null)',:'mandatory_booking'),'23514','manual edit requires client name');
select calendar_test.fails(format('select manual_test.edit_entry(%L,p_phone=>null)',:'mandatory_booking'),'23514','manual edit requires client phone');
select calendar_test.fails(format('select manual_test.edit_entry(%L,p_price=>null)',:'mandatory_booking'),'23514','manual edit requires explicit price');
select calendar_test.fails(format('select manual_test.edit_entry(%L,p_service=>null)',:'mandatory_booking'),'P0001','manual edit requires service');
select calendar_test.fails(format('select manual_test.edit_entry(%L,p_staff=>null)',:'mandatory_booking'),'P0001','manual edit requires professional');
select calendar_test.fails(format('select manual_test.edit_entry(%L,p_start=>null)',:'mandatory_booking'),'23514','manual edit requires appointment date and time');
select calendar_test.ok((select customer_phone='+35799123456' and customer_name='Manual customer' and price_cents=0 from public.bookings where id=:'mandatory_booking'),'invalid edits preserve every original appointment field');
select calendar_test.ok((manual_test.edit_entry(:'mandatory_booking',p_phone=>'99 887-766')).customer_phone='99887766','valid edit accepts an eight-digit local mobile and ignores its own occupied interval');
select calendar_test.fails($q$select manual_test.create_entry(p_start=>calendar_test.slot(60,'10:30'))$q$,'P0001','manual booking rejects a partial overlap with another manual appointment');
select calendar_test.ok((manual_test.create_entry(p_start=>calendar_test.slot(60,'11:00'))).starts_at=calendar_test.slot(60,'11:00'),'adjacent manual appointments are permitted');
select calendar_test.ok((manual_test.create_entry(p_staff=>'91000000-0000-0000-0000-000000000002')).starts_at=calendar_test.slot(60,'10:00'),'different professionals may be booked at the same time');

set local request.jwt.claims='{"sub":"90000000-0000-0000-0000-000000000002","role":"authenticated"}';
select (public.create_booking('92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001',calendar_test.slot(61,'10:00'),'Online customer',gen_random_uuid())).id;
set local request.jwt.claims='{"sub":"90000000-0000-0000-0000-000000000001","role":"authenticated"}';
select calendar_test.fails($q$select manual_test.create_entry(p_start=>calendar_test.slot(61,'10:30'))$q$,'P0001','required-field upgrade retains overlap protection against online bookings');
select calendar_test.fails(format('select manual_test.edit_entry(%L,p_start=>calendar_test.slot(61,''10:30''))',:'mandatory_booking'),'P0001','manual edit cannot move into an online-reserved interval');
select calendar_test.ok((select starts_at=calendar_test.slot(60,'10:00') and customer_phone='99887766' from public.bookings where id=:'mandatory_booking'),'conflicting edit does not change appointment time or contacts');
reset role;
-- Model a pre-upgrade entry that had no phone. The migration must leave it intact,
-- while an owner who edits it must now provide every mandatory field.
insert into public.bookings(id,salon_id,service_id,staff_id,starts_at,ends_at,customer_name,customer_email,customer_phone,
 service_name,salon_name,staff_name,country,timezone,cancellation_hours,price_cents,status,payment_method,payment_status,
 idempotency_key,booking_source,created_by,notes,manual_request_hash)
select '96000000-0000-0000-0000-000000000001',salon_id,service_id,staff_id,starts_at+interval '3 days',ends_at+interval '3 days',
 'Legacy customer',null,null,service_name,salon_name,staff_name,country,timezone,cancellation_hours,price_cents,status,payment_method,payment_status,
 gen_random_uuid(),booking_source,created_by,'Keep this old entry unchanged',md5(gen_random_uuid()::text)
from public.bookings where id=:'mandatory_booking';
create table manual_test.before_upgrade as select to_jsonb(b) as booking from public.bookings b where id='96000000-0000-0000-0000-000000000001';
set local role authenticated;
select calendar_test.fails($q$select manual_test.edit_entry('96000000-0000-0000-0000-000000000001',p_phone=>null,p_start=>calendar_test.slot(63,'10:00'))$q$,'23514','editing a legacy entry requires adding its missing phone');
reset role;
select calendar_test.ok((select customer_phone is null from public.bookings where id='96000000-0000-0000-0000-000000000001'),'legacy entries remain readable without fabricated phone numbers');
commit;
