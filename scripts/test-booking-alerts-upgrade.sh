#!/usr/bin/env bash
# Test the exact additive owner-inbox upgrade on a populated initial installation.
# No hosted Supabase project, credentials or published database ports are used.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image='postgres:17-alpine@sha256:eee6c6e1b0894fa4fe0075eb054af9fd1cf39a35321c2d4110626cfe506411fb'
container="eneres-alerts-upgrade-test-${RANDOM}-$$"
run_dir="$(mktemp -d)"
cleanup(){ docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$run_dir"; }
trap cleanup EXIT
command -v docker >/dev/null || { echo 'Docker is required.' >&2; exit 1; }
docker info >/dev/null
if ! docker image inspect "$image" >/dev/null 2>&1; then docker pull "$image"; fi
docker run --name "$container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust -d "$image" >/dev/null
ready=false
for _ in {1..60}; do
  if docker logs "$container" 2>&1 | rg -q 'PostgreSQL init process complete' && docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 0.5
done
if [[ "$ready" != true ]]; then docker logs "$container"; exit 1; fi
psql_test(){ docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1 "$@"; }
psql_test < "$repo_root/supabase/tests/bootstrap.sql" > "$run_dir/bootstrap.log" 2>&1 || { cat "$run_dir/bootstrap.log"; exit 1; }
for migration in "$repo_root"/supabase/migrations/*.sql; do
  if [[ "$(basename "$migration")" == '202610250005_booking_alerts.sql' ]]; then continue; fi
  psql_test < "$migration" > "$run_dir/migration.log" 2>&1 || { cat "$run_dir/migration.log"; exit 1; }
done
psql_test < "$repo_root/supabase/tests/platform.sql" > "$run_dir/platform.log" 2>&1 || { cat "$run_dir/platform.log"; exit 1; }
psql_test <<'SQL'
-- Model existing accounts that predate the mandatory mobile requirement.
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('89900000-0000-0000-0000-000000000001','legacy-without-mobile@example.test',now(),'{}'),
 ('89900000-0000-0000-0000-000000000002','legacy-with-mobile@example.test',now(),'{"full_name":"Auth metadata name","mobile_phone":"+306912345678"}');
insert into public.profiles(user_id,full_name) values
 ('89900000-0000-0000-0000-000000000001','Retained legacy account'),
 ('89900000-0000-0000-0000-000000000002','Retained profile display name');
SQL
node "$repo_root/scripts/package-booking-alerts-upgrade.mjs" "$run_dir" >/dev/null
psql_test < "$run_dir/eneres-booking-alerts-setup.sql" > "$run_dir/upgrade.log" 2>&1 || { cat "$run_dir/upgrade.log"; exit 1; }
psql_test <<'SQL'
begin;
select test.ok((select mobile_phone is null and full_name='Retained legacy account' from public.profiles where user_id='89900000-0000-0000-0000-000000000001'),
 'first exact upgrade preserves legacy account with no invented mobile');
select test.ok((select mobile_phone='+306912345678' and full_name='Retained profile display name' from public.profiles where user_id='89900000-0000-0000-0000-000000000002'),
 'first exact upgrade backfills supplied mobile without replacing existing profile name');
update auth.users set raw_user_meta_data='{"full_name":"Changed Auth name","mobile_phone":"+35799876543"}' where id='89900000-0000-0000-0000-000000000002';
set local role authenticated;
set local request.jwt.claims='{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
select (public.create_booking('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',test.slot(50,'10:00'),'Upgrade preservation','87700000-0000-0000-0000-000000000001')).id as preserve_booking \gset
set local request.jwt.claims='{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
select id as preserve_alert from public.business_booking_alerts where booking_id=:'preserve_booking' \gset
select public.acknowledge_business_booking(:'preserve_alert');
reset role;
create table test.alert_upgrade_baseline as select
 (select count(*) from public.bookings) as bookings,
 (select count(*) from public.profiles) as profiles,
 (select count(*) from public.salons) as salons,
 (select count(*) from private.notification_outbox) as outbox,
 (select count(*) from public.business_booking_alerts) as alerts,
 :'preserve_alert'::uuid as alert_id,
 (select noted_at from public.business_booking_alerts where id=:'preserve_alert') as noted_at;
commit;
SQL
psql_test < "$run_dir/eneres-booking-alerts-setup.sql" > "$run_dir/reapply.log" 2>&1 || { cat "$run_dir/reapply.log"; exit 1; }
psql_test <<'SQL'
select test.ok((select bookings=(select count(*) from public.bookings) and profiles=(select count(*) from public.profiles)
 and salons=(select count(*) from public.salons) and outbox=(select count(*) from private.notification_outbox)
 and alerts=(select count(*) from public.business_booking_alerts) from test.alert_upgrade_baseline),'reapplying exact inbox upgrade preserves existing rows and outbox');
select test.ok((select a.status='noted' and a.noted_at=b.noted_at from public.business_booking_alerts a join test.alert_upgrade_baseline b on b.alert_id=a.id),'reapplying upgrade preserves owner acknowledgement and timestamp');
select test.ok((select count(*) from public.business_booking_alerts)=(select count(*) from public.bookings where booking_source='online'),'existing online bookings are backfilled exactly once');
select test.ok((select mobile_phone is null and full_name='Retained legacy account' from public.profiles where user_id='89900000-0000-0000-0000-000000000001'),
 'reapplying exact upgrade retains null legacy mobile and original name');
select test.ok((select mobile_phone='+306912345678' and full_name='Retained profile display name' from public.profiles where user_id='89900000-0000-0000-0000-000000000002'),
 'reapplying upgrade cannot overwrite existing mobile/name from stale Auth metadata');
SQL
psql_test < "$repo_root/supabase/tests/booking_alerts.sql" > "$run_dir/alerts.log" 2>&1 || { cat "$run_dir/alerts.log"; exit 1; }
rg 'NOTICE:  PASS:' "$run_dir/alerts.log"
psql_test < "$repo_root/supabase/tests/signup_phone.sql" > "$run_dir/signup-phone.log" 2>&1 || { cat "$run_dir/signup-phone.log"; exit 1; }
rg 'NOTICE:  PASS:' "$run_dir/signup-phone.log"
echo 'PASS: exact booking alerts upgrade and safe rerun verified against an existing populated database.'
