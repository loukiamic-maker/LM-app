#!/usr/bin/env bash
# Isolated PostgreSQL policy/packaging check; never connects to a hosted project.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image='postgres:17-alpine@sha256:eee6c6e1b0894fa4fe0075eb054af9fd1cf39a35321c2d4110626cfe506411fb'
container="eneres-photo-storage-test-${RANDOM}-$$"
run_dir="$(mktemp -d)"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$run_dir"; }
trap cleanup EXIT
docker info >/dev/null
if ! docker image inspect "$image" >/dev/null 2>&1; then docker pull "$image"; fi
docker run --name "$container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust -d "$image" >/dev/null
ready=false
for _ in {1..60}; do
  if docker logs "$container" 2>&1 | rg -q 'PostgreSQL init process complete' && docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 0.5
done
if [[ "$ready" != true ]]; then docker logs "$container"; exit 1; fi
psql_test() { docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1 "$@"; }
psql_test < "$repo_root/supabase/tests/bootstrap.sql" > "$run_dir/bootstrap.log" 2>&1 || { cat "$run_dir/bootstrap.log"; exit 1; }
for migration in "$repo_root"/supabase/migrations/*.sql; do
  psql_test < "$migration" > "$run_dir/migration.log" 2>&1 || { cat "$run_dir/migration.log"; exit 1; }
done
psql_test < "$repo_root/supabase/tests/platform.sql" > "$run_dir/platform.log" 2>&1 || { cat "$run_dir/platform.log"; exit 1; }
psql_test < "$repo_root/supabase/tests/photo_storage.sql" > "$run_dir/photos.log" 2>&1 || { cat "$run_dir/photos.log"; exit 1; }
psql_test < "$repo_root/supabase/tests/photo_storage_rerun.sql" > "$run_dir/fixtures.log" 2>&1 || { cat "$run_dir/fixtures.log"; exit 1; }
node "$repo_root/scripts/package-photo-upgrade.mjs" "$run_dir" >/dev/null
for _ in 1 2; do
  psql_test < "$run_dir/eneres-photo-upload-setup.sql" > "$run_dir/upgrade.log" 2>&1 || { cat "$run_dir/upgrade.log"; exit 1; }
done
psql_test <<'SQL'
select test.ok((select image_url='https://example.test/previous-image.jpg' from public.salons where id='95000000-0000-0000-0000-000000000001'),'photo upgrade rerun preserves existing salon photo URL');
select test.ok((select metadata->>'fixture'='preserve' from storage.objects where name='95000000-0000-0000-0000-000000000001/95000000-0000-0000-0000-000000000201.jpg'),'photo upgrade rerun preserves uploaded object metadata');
select test.ok((select count(*)=1 from storage.objects where bucket_id='preserved-photo-test-bucket' and name='unrelated-object.txt'),'photo upgrade rerun preserves unrelated objects');
select test.ok((select not public and file_size_limit=12345 from storage.buckets where id='preserved-photo-test-bucket'),'photo upgrade rerun preserves unrelated bucket settings');
select test.ok(exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='photo_fixture_unrelated_select'),'photo upgrade rerun preserves unrelated policies');
SQL
rg 'NOTICE:  PASS:' "$run_dir/photos.log"
echo 'PASS: exact photo upgrade, owner isolation, invalid paths and repeated-install preservation completed.'
