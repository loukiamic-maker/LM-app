-- Test-only approximation of Supabase's roles/Auth interface, never deploy this file.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb not null default '{}'
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub','')::uuid
$$;
grant usage on schema public,auth to anon,authenticated,service_role;
grant execute on function auth.uid() to public;

-- Test-only Storage table interface. Real Supabase supplies these managed tables
-- and enforces bucket MIME/size settings in its Storage API, not in PostgREST.
create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id),
  name text not null,
  owner_id text,
  metadata jsonb,
  unique(bucket_id,name)
);
alter table storage.objects enable row level security;
grant usage on schema storage to anon,authenticated,service_role;
grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
grant select on storage.buckets to anon,authenticated,service_role;
