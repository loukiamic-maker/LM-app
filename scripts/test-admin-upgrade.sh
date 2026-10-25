#!/usr/bin/env bash
# Test an exact packaged upgrade against a populated original installation.
# Disposable local PostgreSQL only; no hosted account, email or charge is created.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
upgrade_file="${1:?Provide the generated upgrade SQL path}"
admin_email="${2:?Provide the designated email used to generate that file}"
image='postgres:17-alpine@sha256:eee6c6e1b0894fa4fe0075eb054af9fd1cf39a35321c2d4110626cfe506411fb'
container="eneres-upgrade-test-${RANDOM}-$$"
run_dir="$(mktemp -d)"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$run_dir"; }
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
psql_test() { docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1 -v administrator_email="$admin_email" "$@"; }
for sql_file in "$repo_root/supabase/tests/bootstrap.sql" "$repo_root/supabase/migrations/202610240001_booking_platform.sql" "$repo_root/supabase/tests/platform.sql"; do
  psql_test < "$sql_file" > "$run_dir/setup.log" 2>&1 || { cat "$run_dir/setup.log"; exit 1; }
done
psql_test <<'SQL'
create schema upgrade_test;
create table upgrade_test.preserved as select
  (select jsonb_agg(to_jsonb(s) order by s.id) from public.salons s) salons,
  (select jsonb_agg(to_jsonb(b) order by b.id) from public.bookings b) bookings,
  (select count(*) from private.notification_outbox) outbox_count;
SQL
apply_upgrade() {
  psql_test < "$upgrade_file" > "$run_dir/upgrade.log" 2>&1 || { cat "$run_dir/upgrade.log"; exit 1; }
  if ! rg -q 'Manual booking functions.*PASS|PASS.*Owner-entered' "$run_dir/upgrade.log"; then cat "$run_dir/upgrade.log"; exit 1; fi
}
# No designated account exists: schema must still commit.
apply_upgrade
psql_test <<'SQL'
select test.ok(to_regprocedure('public.admin_overview(integer)') is not null,'packaged upgrade commits when designated account is missing');
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data)
  values('96000000-0000-0000-0000-000000000001',:'administrator_email',null,'{"provider":"email","custom":"preserve"}');
SQL
# Unconfirmed account must not gain administrator rights.
apply_upgrade
psql_test <<'SQL'
select test.ok((select raw_app_meta_data->>'role' is null from auth.users where id='96000000-0000-0000-0000-000000000001'),'packaged upgrade does not grant admin to unverified account');
update auth.users set email_confirmed_at=now() where id='96000000-0000-0000-0000-000000000001';
SQL
# Confirmed designated account gets the trusted role; rerunning preserves data.
apply_upgrade
apply_upgrade
psql_test <<'SQL'
select test.ok((select raw_app_meta_data->>'role'='admin' and raw_app_meta_data->>'provider'='email' and raw_app_meta_data->>'custom'='preserve' from auth.users where id='96000000-0000-0000-0000-000000000001'),'packaged upgrade grants admin only after confirmation and preserves metadata');
select test.ok((select raw_app_meta_data->>'role' is null from auth.users where id='00000000-0000-0000-0000-000000000001'),'other salon owner is not promoted');
select test.ok((select salons from upgrade_test.preserved) is not distinct from (select jsonb_agg(to_jsonb(s) order by s.id) from public.salons s),'all pre-existing salon records survive repeated exact upgrade');
select test.ok((select bookings from upgrade_test.preserved) is not distinct from (select jsonb_agg(to_jsonb(b)-array['booking_source','customer_phone','notes','created_by','manual_request_hash'] order by b.id) from public.bookings b),'all pre-existing booking data survives repeated exact upgrade');
select test.ok((select outbox_count from upgrade_test.preserved)=(select count(*) from private.notification_outbox),'repeated upgrade does not create or remove notifications');
select test.ok((select count(*) from public.platform_billing_settings)=1 and (select monthly_price_cents is null and enabled=false and stripe_enabled=false from public.platform_billing_settings),'upgrade installs no invented monthly fee or activated payment provider');
SQL
for test_file in owner_calendar admin_billing; do
  psql_test < "$repo_root/supabase/tests/$test_file.sql" > "$run_dir/$test_file.log" 2>&1 || { cat "$run_dir/$test_file.log"; exit 1; }
  rg 'NOTICE:  PASS:' "$run_dir/$test_file.log" || cat "$run_dir/$test_file.log"
done
echo 'PASS: exact existing-project upgrade, repeated application, data preservation and verified-only admin activation'
