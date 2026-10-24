#!/usr/bin/env bash
# Disposable, isolated PostgreSQL 17. No Supabase project, host psql, or credentials.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image='postgres:17-alpine@sha256:eee6c6e1b0894fa4fe0075eb054af9fd1cf39a35321c2d4110626cfe506411fb'
container="eneres-database-test-${RANDOM}-$$"
run_dir="$(mktemp -d)"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$run_dir"
}
trap cleanup EXIT
command -v docker >/dev/null || { echo 'Docker is required.' >&2; exit 1; }
docker info >/dev/null
if ! docker image inspect "$image" >/dev/null 2>&1; then docker pull "$image"; fi
# No published port or network: trust authentication exists only in this test container.
docker run --name "$container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust -d "$image" >/dev/null
ready=false
for _ in {1..60}; do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 0.5
done
if [[ "$ready" != true ]]; then docker logs "$container"; exit 1; fi
psql_test() { docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1 "$@"; }
psql_test < "$repo_root/supabase/tests/bootstrap.sql" > "$run_dir/bootstrap.log" 2>&1 || { cat "$run_dir/bootstrap.log"; exit 1; }
for migration in "$repo_root"/supabase/migrations/*.sql; do
  psql_test < "$migration" > "$run_dir/migration.log" 2>&1 || { cat "$run_dir/migration.log"; exit 1; }
done
psql_test < "$repo_root/supabase/tests/platform.sql" > "$run_dir/platform.log" 2>&1 || { cat "$run_dir/platform.log"; exit 1; }
# Show substantive outcomes without fixture PII or SQL chatter.
rg 'NOTICE:  PASS:' "$run_dir/platform.log" || cat "$run_dir/platform.log"

# Two independent sessions race for the same slot. Hold the winning transaction open
# so the other session genuinely contends instead of issuing a sequential request.
make_race_sql() {
  local customer="$1" key="$2" day="$3" delay="$4"
  cat <<SQL
begin;
set local role authenticated;
set local request.jwt.claims='{"sub":"$customer","role":"authenticated"}';
select (public.create_booking('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',test.slot($day,'10:00'),'Concurrent Test','$key')).id;
select pg_sleep($delay);
commit;
SQL
}
make_race_sql '00000000-0000-0000-0000-000000000002' '50000000-0000-0000-0000-000000000001' 10 2 > "$run_dir/race-one.sql"
make_race_sql '00000000-0000-0000-0000-000000000003' '50000000-0000-0000-0000-000000000002' 10 0 > "$run_dir/race-two.sql"
psql_test < "$run_dir/race-one.sql" > "$run_dir/race-one.log" 2>&1 &
pid_one=$!
sleep 0.25
psql_test < "$run_dir/race-two.sql" > "$run_dir/race-two.log" 2>&1 &
pid_two=$!
code_one=0; code_two=0
wait "$pid_one" || code_one=$?
wait "$pid_two" || code_two=$?
if ! { [[ "$code_one" == 0 && "$code_two" != 0 ]] || [[ "$code_one" != 0 && "$code_two" == 0 ]]; }; then
  cat "$run_dir/race-one.log" "$run_dir/race-two.log"
  echo 'FAIL: exactly one concurrent booking must commit.' >&2; exit 1
fi
if ! rg -q 'SLOT_UNAVAILABLE|bookings_staff_no_overlap' "$run_dir"/race-*.log; then
  cat "$run_dir/race-one.log" "$run_dir/race-two.log"; exit 1
fi
psql_test -c "select test.ok((select count(*) from public.bookings where staff_id='10000000-0000-0000-0000-000000000002' and starts_at=test.slot(10,'10:00') and status='confirmed')=1,'concurrent slot requests commit exactly one booking');"

# Same request/key in two independent sessions must both succeed with one row/email.
make_race_sql '00000000-0000-0000-0000-000000000002' '50000000-0000-0000-0000-000000000003' 11 2 > "$run_dir/retry-one.sql"
make_race_sql '00000000-0000-0000-0000-000000000002' '50000000-0000-0000-0000-000000000003' 11 0 > "$run_dir/retry-two.sql"
psql_test < "$run_dir/retry-one.sql" > "$run_dir/retry-one.log" 2>&1 &
pid_one=$!
sleep 0.25
psql_test < "$run_dir/retry-two.sql" > "$run_dir/retry-two.log" 2>&1 &
pid_two=$!
code_one=0; code_two=0
wait "$pid_one" || code_one=$?
wait "$pid_two" || code_two=$?
if [[ "$code_one" != 0 || "$code_two" != 0 ]]; then cat "$run_dir/retry-one.log" "$run_dir/retry-two.log"; exit 1; fi
psql_test -c "select test.ok((select count(*) from public.bookings where customer_id='00000000-0000-0000-0000-000000000002' and idempotency_key='50000000-0000-0000-0000-000000000003')=1,'concurrent idempotent requests produce one row'); select test.ok((select count(*) from private.notification_outbox n join public.bookings b on b.id=n.booking_id where b.idempotency_key='50000000-0000-0000-0000-000000000003' and n.event_type='booking_confirmed')=1,'concurrent idempotent requests enqueue one confirmation');"

# Bypass the RPC only as privileged test fixture code to independently exercise GiST.
# This must fail even if a future code path forgets to query availability first.
psql_test <<'SQL'
select test.fails($q$insert into public.bookings(salon_id,service_id,staff_id,customer_id,starts_at,ends_at,customer_name,customer_email,service_name,salon_name,staff_name,country,timezone,cancellation_hours,price_cents,idempotency_key)
select salon_id,service_id,staff_id,customer_id,starts_at+interval '15 minutes',ends_at+interval '15 minutes',customer_name,customer_email,service_name,salon_name,staff_name,country,timezone,cancellation_hours,price_cents,gen_random_uuid()
from public.bookings where idempotency_key='50000000-0000-0000-0000-000000000003'$q$,'23P01','database exclusion constraint independently rejects overlap');
SQL
echo 'PASS: exact migration, RLS/booking assertions, concurrent conflicts and retries completed.'
