#!/usr/bin/env bash
# Test-only helper. The caller owns the isolated PostgreSQL container and loads
# supabase/tests/owner_calendar.sql first. No hosted connections or credentials.
set -euo pipefail
container="${1:?Pass the disposable database test container name}"
if [[ "$container" != eneres-database-test-* && "$container" != eneres-calendar-test-* ]]; then
  echo 'Refusing a container outside the disposable database test naming scheme.' >&2
  exit 1
fi
run_dir="$(mktemp -d)"
trap 'rm -rf "$run_dir"' EXIT
psql_test(){ docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1 "$@"; }
# An explicit marker makes accidental use against a different local DB fail.
psql_test -c "select calendar_test.ok((select email='manual-owner@example.test' from auth.users where id='90000000-0000-0000-0000-000000000001'),'isolated manual-calendar fixtures are present');" >/dev/null </dev/null
cat > "$run_dir/manual.sql" <<'SQL'
begin;
set local role authenticated;
set local request.jwt.claims='{"sub":"90000000-0000-0000-0000-000000000001","role":"authenticated"}';
select(public.create_manual_booking('93000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001',calendar_test.slot(22,'10:00'),'Offline race','94000000-0000-0000-0000-000000000022')).id;
select pg_sleep(1);
commit;
SQL
cat > "$run_dir/online.sql" <<'SQL'
begin;
set local role authenticated;
set local request.jwt.claims='{"sub":"90000000-0000-0000-0000-000000000002","role":"authenticated"}';
select(public.create_booking('92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001',calendar_test.slot(22,'10:00'),'Online race','94000000-0000-0000-0000-000000000023')).id;
commit;
SQL
psql_test < "$run_dir/manual.sql" > "$run_dir/manual.log" 2>&1 & pid_manual=$!
sleep .2
psql_test < "$run_dir/online.sql" > "$run_dir/online.log" 2>&1 & pid_online=$!
manual_code=0; online_code=0
wait "$pid_manual" || manual_code=$?
wait "$pid_online" || online_code=$?
if ! { [[ "$manual_code" == 0 && "$online_code" != 0 ]] || [[ "$manual_code" != 0 && "$online_code" == 0 ]]; }; then
  cat "$run_dir/manual.log" "$run_dir/online.log"
  echo 'FAIL: exactly one online/offline request must commit.' >&2
  exit 1
fi
if ! rg -q 'SLOT_UNAVAILABLE|bookings_staff_no_overlap' "$run_dir/manual.log" "$run_dir/online.log"; then
  cat "$run_dir/manual.log" "$run_dir/online.log"
  echo 'FAIL: losing request must fail because the shared staff time is occupied.' >&2
  exit 1
fi
psql_test -c "select calendar_test.ok((select count(*) from public.bookings where staff_id='91000000-0000-0000-0000-000000000001' and starts_at=calendar_test.slot(22,'10:00') and status='confirmed')=1,'concurrent offline versus online requests accept exactly one appointment');" </dev/null
# Two simultaneous retries of one manual request must both return the same row.
sed "s/22,'10:00'/23,'10:00'/g; s/000000000022/000000000024/g" "$run_dir/manual.sql" > "$run_dir/retry.sql"
psql_test < "$run_dir/retry.sql" > "$run_dir/retry-one.log" 2>&1 & pid_one=$!
sleep .2
psql_test < "$run_dir/retry.sql" > "$run_dir/retry-two.log" 2>&1 & pid_two=$!
code_one=0; code_two=0
wait "$pid_one" || code_one=$?
wait "$pid_two" || code_two=$?
if [[ "$code_one" != 0 || "$code_two" != 0 ]]; then
  cat "$run_dir/retry-one.log" "$run_dir/retry-two.log"
  echo 'FAIL: both idempotent manual retries must return successfully.' >&2
  exit 1
fi
psql_test -c "select calendar_test.ok((select count(*) from public.bookings where booking_source='offline' and created_by='90000000-0000-0000-0000-000000000001' and idempotency_key='94000000-0000-0000-0000-000000000024')=1,'concurrent manual retries accept one row');" </dev/null
# Exercise the shared exclusion constraint independently of either RPC's checks.
psql_test <<'SQL'
select calendar_test.fails($q$
insert into public.bookings(salon_id,service_id,staff_id,customer_id,starts_at,ends_at,customer_name,customer_email,
  service_name,salon_name,staff_name,country,timezone,cancellation_hours,price_cents,idempotency_key,
  booking_source,created_by,manual_request_hash)
select salon_id,service_id,staff_id,null,starts_at+interval '15 minutes',ends_at+interval '15 minutes',customer_name,null,
  service_name,salon_name,staff_name,country,timezone,cancellation_hours,price_cents,gen_random_uuid(),
  'offline',created_by,md5(gen_random_uuid()::text)
from public.bookings where booking_source='offline' and idempotency_key='94000000-0000-0000-0000-000000000024'
$q$,'23P01','shared exclusion constraint independently rejects an overlapping offline row');
SQL
