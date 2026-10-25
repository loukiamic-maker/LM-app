-- Eneres platform administration and monthly business subscriptions
-- Additive upgrade: no salon, customer or booking data is deleted or seeded
begin;

create table if not exists public.platform_billing_settings (
  singleton boolean primary key default true check (singleton),
  monthly_price_cents integer check (monthly_price_cents between 1 and 1000000),
  currency text not null default 'EUR' check (currency = 'EUR'),
  enabled boolean not null default false,
  stripe_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
insert into public.platform_billing_settings(singleton) values(true) on conflict do nothing;

create table if not exists public.business_subscriptions (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null unique references public.salons(id),
  status text not null default 'pending' check (status in ('pending','active','past_due','cancelled')),
  payment_provider text not null default 'manual' check (payment_provider in ('manual','stripe')),
  monthly_price_cents integer check (monthly_price_cents between 1 and 1000000),
  currency text not null default 'EUR' check (currency = 'EUR'),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_checkout_id text,
  checkout_url text check (checkout_url is null or (char_length(checkout_url) <= 2048 and checkout_url ~ '^https://checkout[.]stripe[.]com/')),
  last_stripe_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_period_start is null or current_period_end is null or current_period_start < current_period_end)
);
alter table public.business_subscriptions add column if not exists last_stripe_event_at timestamptz;
create unique index if not exists business_subscriptions_stripe_id on public.business_subscriptions(stripe_subscription_id) where stripe_subscription_id is not null;

create table if not exists public.business_charges (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id),
  subscription_id uuid references public.business_subscriptions(id),
  amount_cents integer not null check (amount_cents between 0 and 1000000),
  currency text not null default 'EUR' check (currency = 'EUR'),
  period_start date not null,
  period_end date not null,
  due_date date,
  status text not null default 'pending' check (status in ('pending','paid','void')),
  payment_provider text not null default 'manual' check (payment_provider in ('manual','stripe')),
  paid_at timestamptz,
  external_reference text not null default '' check (char_length(external_reference) <= 300),
  stripe_invoice_id text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (period_start < period_end and period_end <= period_start + 366),
  check ((status = 'paid') = (paid_at is not null))
);
create unique index if not exists business_charges_manual_period on public.business_charges(salon_id,period_start,period_end) where payment_provider='manual' and status<>'void';
create unique index if not exists business_charges_stripe_invoice on public.business_charges(stripe_invoice_id) where stripe_invoice_id is not null;
create index if not exists business_charges_salon_created on public.business_charges(salon_id,created_at desc);

create table if not exists public.business_reviews (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id),
  admin_id uuid references auth.users(id),
  decision text not null check (decision in ('published','rejected')),
  note text not null default '' check (char_length(note) <= 2000),
  created_at timestamptz not null default now()
);

create table if not exists private.billing_checkout_requests (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id),
  user_id uuid not null references auth.users(id),
  request_id uuid not null,
  stripe_checkout_id text not null unique,
  checkout_url text not null check (checkout_url ~ '^https://checkout[.]stripe[.]com/' and char_length(checkout_url)<=2048),
  stripe_customer_id text,
  stripe_subscription_id text,
  amount_cents integer not null check (amount_cents between 1 and 1000000),
  currency text not null default 'EUR' check (currency='EUR'),
  created_at timestamptz not null default now(),
  unique(user_id,request_id)
);
create index if not exists billing_checkout_subscription on private.billing_checkout_requests(stripe_subscription_id) where stripe_subscription_id is not null;
create table if not exists private.billing_checkout_reservations (
  salon_id uuid primary key references public.salons(id),
  user_id uuid not null references auth.users(id),
  request_id uuid not null,
  amount_cents integer not null check (amount_cents between 1 and 1000000),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '15 minutes'
);
create table if not exists private.billing_provider_events (
  event_id text primary key check (char_length(event_id) between 1 and 200),
  event_type text not null check (char_length(event_type) between 1 and 100),
  salon_id uuid references public.salons(id),
  result text not null,
  created_at timestamptz not null default now()
);

alter table public.platform_billing_settings enable row level security;
alter table public.business_subscriptions enable row level security;
alter table public.business_charges enable row level security;
alter table public.business_reviews enable row level security;
alter table private.billing_checkout_requests enable row level security;
alter table private.billing_checkout_reservations enable row level security;
alter table private.billing_provider_events enable row level security;

drop policy if exists platform_billing_admin_read on public.platform_billing_settings;
create policy platform_billing_admin_read on public.platform_billing_settings for select to authenticated using (private.is_admin());
drop policy if exists subscriptions_owner_or_admin_read on public.business_subscriptions;
create policy subscriptions_owner_or_admin_read on public.business_subscriptions for select to authenticated using (private.owns_salon(salon_id) or private.is_admin());
drop policy if exists charges_owner_or_admin_read on public.business_charges;
create policy charges_owner_or_admin_read on public.business_charges for select to authenticated using (private.owns_salon(salon_id) or private.is_admin());
drop policy if exists reviews_owner_or_admin_read on public.business_reviews;
create policy reviews_owner_or_admin_read on public.business_reviews for select to authenticated using (private.owns_salon(salon_id) or private.is_admin());
revoke all on public.platform_billing_settings,public.business_subscriptions,public.business_charges,public.business_reviews from public,anon,authenticated;
grant select on public.platform_billing_settings,public.business_subscriptions,public.business_charges,public.business_reviews to authenticated;
revoke all on private.billing_checkout_requests,private.billing_checkout_reservations,private.billing_provider_events from public,anon,authenticated;

create or replace function private.require_platform_admin() returns void
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_admin() then raise exception 'PLATFORM_ADMIN_REQUIRED' using errcode='42501'; end if;
  if auth.uid() is not null and not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then
    raise exception 'EMAIL_CONFIRMATION_REQUIRED' using errcode='42501';
  end if;
end $$;
revoke execute on function private.require_platform_admin() from public,anon,authenticated;

create or replace function public.get_platform_billing() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v jsonb;
begin
  perform private.require_platform_admin();
  select to_jsonb(b)-'singleton'-'updated_by' into v from public.platform_billing_settings b where singleton;
  return v;
end $$;

create or replace function public.admin_set_platform_billing(p_monthly_price_cents integer,p_enabled boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_platform_admin();
  if p_enabled is null or (p_monthly_price_cents is not null and p_monthly_price_cents not between 1 and 1000000)
    or (p_enabled and p_monthly_price_cents is null) then raise exception 'BILLING_PRICE_REQUIRED' using errcode='23514'; end if;
  update public.platform_billing_settings set monthly_price_cents=p_monthly_price_cents,enabled=p_enabled,updated_at=now(),updated_by=auth.uid() where singleton;
  return public.get_platform_billing();
end $$;

create or replace function public.admin_list_salons(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v jsonb;
begin
  perform private.require_platform_admin();
  if p_status is not null and p_status not in ('draft','pending','published','rejected') then raise exception 'SALON_STATUS_INVALID' using errcode='23514'; end if;
  select coalesce(jsonb_agg(x.data order by x.created_at desc),'[]'::jsonb) into v from (
    select s.created_at,to_jsonb(s)||jsonb_build_object(
      'owner_email',u.email,'owner_name',coalesce(p.full_name,''),
      'subscription',(select to_jsonb(b) from public.business_subscriptions b where b.salon_id=s.id),
      'booking_count',(select count(*) from public.bookings b where b.salon_id=s.id)) as data
    from public.salons s join auth.users u on u.id=s.owner_id left join public.profiles p on p.user_id=s.owner_id
    where p_status is null or s.status=p_status
  ) x;
  return v;
end $$;

create or replace function public.admin_get_salon(p_salon_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_salon public.salons; v_owner jsonb;
begin
  perform private.require_platform_admin();
  select * into v_salon from public.salons where id=p_salon_id;
  if not found then raise exception 'SALON_NOT_FOUND' using errcode='P0002'; end if;
  select jsonb_build_object('id',u.id,'email',u.email,'full_name',coalesce(p.full_name,''),'name',coalesce(p.full_name,''),'confirmed',u.email_confirmed_at is not null)
    into v_owner from auth.users u left join public.profiles p on p.user_id=u.id where u.id=v_salon.owner_id;
  return jsonb_build_object('salon',to_jsonb(v_salon),'owner',v_owner,
    'staff',coalesce((select jsonb_agg(to_jsonb(t) order by t.name) from public.staff t where t.salon_id=p_salon_id),'[]'::jsonb),
    'services',coalesce((select jsonb_agg(to_jsonb(v) order by v.name) from public.services v where v.salon_id=p_salon_id),'[]'::jsonb),
    'hours',coalesce((select jsonb_agg(to_jsonb(h) order by h.staff_id,h.weekday,h.opens_at) from public.staff_hours h join public.staff t on t.id=h.staff_id where t.salon_id=p_salon_id),'[]'::jsonb),
    'reviews',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from public.business_reviews r where r.salon_id=p_salon_id),'[]'::jsonb),
    'subscription',(select to_jsonb(b) from public.business_subscriptions b where b.salon_id=p_salon_id),
    'charges',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at desc) from public.business_charges c where c.salon_id=p_salon_id),'[]'::jsonb));
end $$;

create or replace function public.admin_review_salon(p_salon_id uuid,p_decision text,p_note text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_salon public.salons;
begin
  perform private.require_platform_admin();
  if p_decision is null or p_decision not in ('published','rejected') or p_note is null or char_length(p_note)>2000 then raise exception 'REVIEW_INVALID' using errcode='23514'; end if;
  select * into v_salon from public.salons where id=p_salon_id for update;
  if not found then raise exception 'SALON_NOT_FOUND' using errcode='P0002'; end if;
  if v_salon.status not in ('pending','published','rejected') then raise exception 'SALON_NOT_SUBMITTED' using errcode='23514'; end if;
  if p_decision='published' and (not exists(select 1 from public.services where salon_id=p_salon_id and active)
    or not exists(select 1 from public.staff t join public.staff_hours h on h.staff_id=t.id where t.salon_id=p_salon_id and t.active)
    or not exists(select 1 from auth.users where id=v_salon.owner_id and email_confirmed_at is not null)) then
    raise exception 'SALON_SETUP_INCOMPLETE' using errcode='23514';
  end if;
  update public.salons set status=p_decision where id=p_salon_id returning * into v_salon;
  insert into public.business_reviews(salon_id,admin_id,decision,note) values(p_salon_id,auth.uid(),p_decision,btrim(p_note));
  return to_jsonb(v_salon);
end $$;

create or replace function public.admin_overview(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_days integer := least(greatest(coalesce(p_days,30),1),366); v_today date := (now() at time zone 'Europe/Athens')::date; v_start date; v_stats jsonb; v_daily jsonb;
begin
  perform private.require_platform_admin();
  v_start := v_today-v_days+1;
  select jsonb_build_object(
    'salons',(select count(*) from public.salons),'pending_salons',(select count(*) from public.salons where status='pending'),
    'published_salons',(select count(*) from public.salons where status='published'),'owners',(select count(distinct owner_id) from public.salons),
    'bookings',count(*),'confirmed_bookings',count(*) filter(where status='confirmed'),'completed_bookings',count(*) filter(where status='completed'),
    'cancelled_bookings',count(*) filter(where status='cancelled'),
    'service_revenue_cents',coalesce(sum(price_cents) filter(where status='completed' and payment_status='paid'),0),
    'subscription_revenue_cents',(select coalesce(sum(amount_cents),0) from public.business_charges where status='paid' and (paid_at at time zone 'Europe/Athens')::date between v_start and v_today),
    'outstanding_charges_cents',(select coalesce(sum(amount_cents),0) from public.business_charges where status='pending'))
  into v_stats from public.bookings where (starts_at at time zone timezone)::date between v_start and v_today;
  select coalesce(jsonb_agg(jsonb_build_object('date',d.day,'bookings',d.bookings,'service_revenue_cents',d.venue,'venue_revenue_cents',d.venue,'platform_revenue_cents',d.platform) order by d.day),'[]'::jsonb)
  into v_daily from (
    select day::date as day,
      (select count(*) from public.bookings b where (b.starts_at at time zone b.timezone)::date=day::date) as bookings,
      (select coalesce(sum(b.price_cents),0) from public.bookings b where (b.starts_at at time zone b.timezone)::date=day::date and b.status='completed' and b.payment_status='paid') as venue,
      (select coalesce(sum(c.amount_cents),0) from public.business_charges c where (c.paid_at at time zone 'Europe/Athens')::date=day::date and c.status='paid') as platform
    from generate_series(v_start::timestamp,v_today::timestamp,interval '1 day') day
  ) d;
  return jsonb_build_object('days',v_days,'stats',v_stats,'counts',jsonb_build_object(
    'salons',v_stats->'salons','pending',v_stats->'pending_salons','published',v_stats->'published_salons','owners',v_stats->'owners',
    'bookings',v_stats->'bookings','confirmed',v_stats->'confirmed_bookings','completed',v_stats->'completed_bookings','cancelled',v_stats->'cancelled_bookings'),
    'revenue',jsonb_build_object('bookings_cents',v_stats->'service_revenue_cents','subscriptions_cents',v_stats->'subscription_revenue_cents','outstanding_cents',v_stats->'outstanding_charges_cents'),
    'daily',v_daily,'billing',public.get_platform_billing());
end $$;

create or replace function public.admin_set_business_subscription(p_salon_id uuid,p_monthly_price_cents integer,p_status text,p_provider text default 'manual') returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.business_subscriptions; v_price integer;
begin
  perform private.require_platform_admin();
  if p_status is null or p_status not in ('pending','active','past_due','cancelled') or p_provider is distinct from 'manual'
    or (p_monthly_price_cents is not null and p_monthly_price_cents not between 1 and 1000000) then raise exception 'SUBSCRIPTION_INVALID' using errcode='23514'; end if;
  perform 1 from public.salons where id=p_salon_id for update;
  if not found then raise exception 'SALON_NOT_FOUND' using errcode='P0002'; end if;
  select * into v from public.business_subscriptions where salon_id=p_salon_id for update;
  if found and v.payment_provider='stripe' and v.status in ('pending','active','past_due') then raise exception 'STRIPE_SUBSCRIPTION_MANAGED_BY_PROVIDER' using errcode='23514'; end if;
  v_price := coalesce(p_monthly_price_cents,(select monthly_price_cents from public.platform_billing_settings where singleton));
  if p_status='active' and v_price is null then raise exception 'BILLING_PRICE_REQUIRED' using errcode='23514'; end if;
  insert into public.business_subscriptions(salon_id,monthly_price_cents,status,payment_provider)
    values(p_salon_id,v_price,p_status,'manual') on conflict(salon_id) do update
      set monthly_price_cents=excluded.monthly_price_cents,status=excluded.status,payment_provider='manual',stripe_subscription_id=null,stripe_checkout_id=null,checkout_url=null,last_stripe_event_at=null,cancel_at_period_end=false,updated_at=now()
      returning * into v;
  return to_jsonb(v);
end $$;

create or replace function public.admin_create_business_charge(p_salon_id uuid,p_period_start date,p_period_end date,p_amount_cents integer default null,p_due_date date default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_sub public.business_subscriptions; v_charge public.business_charges; v_amount integer;
begin
  perform private.require_platform_admin();
  if p_period_start is null or p_period_end is null or p_period_end<=p_period_start or p_period_end>p_period_start+62 then raise exception 'BILLING_PERIOD_INVALID' using errcode='23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended('business-charge:'||p_salon_id::text,0));
  perform 1 from public.salons where id=p_salon_id;
  if not found then raise exception 'SALON_NOT_FOUND' using errcode='P0002'; end if;
  select * into v_sub from public.business_subscriptions where salon_id=p_salon_id for update;
  if found and v_sub.payment_provider='stripe' and v_sub.status in ('pending','active','past_due') then raise exception 'STRIPE_SUBSCRIPTION_MANAGED_BY_PROVIDER' using errcode='23514'; end if;
  v_amount:=coalesce(p_amount_cents,v_sub.monthly_price_cents,(select monthly_price_cents from public.platform_billing_settings where singleton));
  if v_amount is null or v_amount not between 1 and 1000000 then raise exception 'BILLING_PRICE_REQUIRED' using errcode='23514'; end if;
  if v_sub.id is null then
    insert into public.business_subscriptions(salon_id,monthly_price_cents) values(p_salon_id,v_amount) returning * into v_sub;
  end if;
  select * into v_charge from public.business_charges where salon_id=p_salon_id and period_start=p_period_start and period_end=p_period_end and payment_provider='manual' and status<>'void';
  if found then
    if v_charge.amount_cents<>v_amount then raise exception 'BILLING_PERIOD_ALREADY_EXISTS' using errcode='23514'; end if;
    return to_jsonb(v_charge);
  end if;
  insert into public.business_charges(salon_id,subscription_id,amount_cents,period_start,period_end,due_date,created_by)
    values(p_salon_id,v_sub.id,v_amount,p_period_start,p_period_end,coalesce(p_due_date,p_period_start),auth.uid()) returning * into v_charge;
  return to_jsonb(v_charge);
end $$;

create or replace function public.admin_set_charge_status(p_charge_id uuid,p_status text,p_reference text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.business_charges;
begin
  perform private.require_platform_admin();
  if p_status is null or p_status not in ('paid','void') or p_reference is null or char_length(p_reference)>300 then raise exception 'CHARGE_STATUS_INVALID' using errcode='23514'; end if;
  select * into v from public.business_charges where id=p_charge_id for update;
  if not found then raise exception 'CHARGE_NOT_FOUND' using errcode='P0002'; end if;
  if v.payment_provider<>'manual' then raise exception 'STRIPE_CHARGE_MANAGED_BY_PROVIDER' using errcode='23514'; end if;
  if v.status=p_status then return to_jsonb(v); end if;
  if v.status<>'pending' then raise exception 'CHARGE_ALREADY_FINAL' using errcode='23514'; end if;
  update public.business_charges set status=p_status,paid_at=case when p_status='paid' then now() else null end,external_reference=btrim(p_reference)
    where id=p_charge_id returning * into v;
  if p_status='paid' then update public.business_subscriptions set status='active',current_period_start=v.period_start::timestamp at time zone 'Europe/Athens',
      current_period_end=v.period_end::timestamp at time zone 'Europe/Athens',updated_at=now() where id=v.subscription_id and payment_provider='manual'; end if;
  return to_jsonb(v);
end $$;

create or replace function public.get_business_billing(p_salon_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_plan jsonb;
begin
  if auth.uid() is null or not (private.owns_salon(p_salon_id) or private.is_admin()) then raise exception 'SALON_OWNER_REQUIRED' using errcode='42501'; end if;
  select jsonb_build_object('enabled',enabled,'monthly_price_cents',monthly_price_cents,'currency',currency,'stripe_enabled',stripe_enabled,'updated_at',updated_at)
    into v_plan from public.platform_billing_settings where singleton;
  return jsonb_build_object('plan',v_plan,
    'online_checkout_available',coalesce((v_plan->>'enabled')::boolean and (v_plan->>'stripe_enabled')::boolean and (v_plan->>'monthly_price_cents')::integer>0,false),
    'subscription',(select to_jsonb(s) from public.business_subscriptions s where salon_id=p_salon_id),
    'charges',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at desc) from public.business_charges c where c.salon_id=p_salon_id),'[]'::jsonb),
    'reviews',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from public.business_reviews r where r.salon_id=p_salon_id),'[]'::jsonb));
end $$;

-- These three endpoints are for trusted server functions only, never browsers.
create or replace function public.billing_enable_stripe(p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_enabled is null then raise exception 'BILLING_PROVIDER_INVALID' using errcode='23514'; end if;
  update public.platform_billing_settings set stripe_enabled=p_enabled,updated_at=now() where singleton;
end $$;

create or replace function public.billing_checkout_context(p_user_id uuid,p_salon_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_user auth.users; v_salon public.salons; v_sub public.business_subscriptions; v_settings public.platform_billing_settings; v_amount integer;
begin
  select * into v_user from auth.users where id=p_user_id and email_confirmed_at is not null;
  if not found then raise exception 'EMAIL_CONFIRMATION_REQUIRED' using errcode='42501'; end if;
  select * into v_salon from public.salons where id=p_salon_id;
  if not found then raise exception 'SALON_NOT_FOUND' using errcode='P0002'; end if;
  if v_salon.owner_id<>p_user_id and coalesce(v_user.raw_app_meta_data->>'role','')<>'admin' then raise exception 'SALON_OWNER_REQUIRED' using errcode='42501'; end if;
  select * into v_settings from public.platform_billing_settings where singleton;
  select * into v_sub from public.business_subscriptions where salon_id=p_salon_id;
  v_amount:=coalesce(v_sub.monthly_price_cents,v_settings.monthly_price_cents);
  return jsonb_build_object('salon_id',v_salon.id,'salon_name',v_salon.name,'owner_id',v_salon.owner_id,
    'owner_email',(select email from auth.users where id=v_salon.owner_id),'user_email',v_user.email,
    'amount_cents',v_amount,'currency','EUR','enabled',v_settings.enabled,'online_checkout_available',coalesce(v_settings.enabled and v_settings.stripe_enabled and v_amount>0,false),
    'stripe_customer_id',v_sub.stripe_customer_id,'stripe_subscription_id',v_sub.stripe_subscription_id,
    'subscription_status',v_sub.status,'payment_provider',v_sub.payment_provider,'current_period_end',v_sub.current_period_end,'checkout_url',v_sub.checkout_url,'stripe_checkout_id',v_sub.stripe_checkout_id);
end $$;

create or replace function public.billing_reserve_checkout(p_user_id uuid,p_salon_id uuid,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_context jsonb; v_reservation private.billing_checkout_reservations; v_sub public.business_subscriptions;
begin
  if p_request_id is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode='23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended('billing-checkout:'||p_salon_id::text,0));
  v_context:=public.billing_checkout_context(p_user_id,p_salon_id);
  if not coalesce((v_context->>'online_checkout_available')::boolean,false) then raise exception 'BILLING_NOT_CONFIGURED' using errcode='23514'; end if;
  select * into v_sub from public.business_subscriptions where salon_id=p_salon_id for update;
  if found and v_sub.payment_provider='stripe' and v_sub.stripe_subscription_id is not null and v_sub.status in ('active','past_due') then
    raise exception 'BILLING_ALREADY_ACTIVE' using errcode='23514';
  end if;
  if found and v_sub.payment_provider='manual' and v_sub.status='active' and v_sub.current_period_end>now() then
    raise exception 'BILLING_PERIOD_ALREADY_PAID' using errcode='23514';
  end if;
  if found and v_sub.payment_provider='stripe' and v_sub.status='pending' and v_sub.checkout_url is not null then
    return v_context||jsonb_build_object('reuse_checkout',true,'checkout_url',v_sub.checkout_url);
  end if;
  select * into v_reservation from private.billing_checkout_reservations where salon_id=p_salon_id for update;
  if found and v_reservation.expires_at>now() then
    if v_reservation.user_id<>p_user_id or v_reservation.request_id<>p_request_id then
      raise exception 'BILLING_CHECKOUT_IN_PROGRESS' using errcode='55P03';
    end if;
    return v_context||jsonb_build_object('reuse_checkout',false,'amount_cents',v_reservation.amount_cents,'request_id',p_request_id);
  end if;
  insert into private.billing_checkout_reservations(salon_id,user_id,request_id,amount_cents)
    values(p_salon_id,p_user_id,p_request_id,(v_context->>'amount_cents')::integer)
    on conflict(salon_id) do update set user_id=excluded.user_id,request_id=excluded.request_id,amount_cents=excluded.amount_cents,created_at=now(),expires_at=now()+interval '15 minutes';
  return v_context||jsonb_build_object('reuse_checkout',false,'request_id',p_request_id);
end $$;

create or replace function public.billing_record_checkout(p_salon_id uuid,p_user_id uuid,p_request_id uuid,p_session_id text,p_checkout_url text,p_customer_id text default null,p_subscription_id text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_context jsonb; v_request private.billing_checkout_requests; v_sub public.business_subscriptions; v_reservation private.billing_checkout_reservations;
begin
  if p_request_id is null or p_session_id is null or p_session_id !~ '^cs_' or char_length(p_session_id)>300
    or p_checkout_url is null or p_checkout_url !~ '^https://checkout[.]stripe[.]com/' or char_length(p_checkout_url)>2048
    or (p_customer_id is not null and (p_customer_id !~ '^cus_' or char_length(p_customer_id)>300))
    or (p_subscription_id is not null and (p_subscription_id !~ '^sub_' or char_length(p_subscription_id)>300)) then raise exception 'BILLING_CHECKOUT_INVALID' using errcode='23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended('billing-checkout:'||p_salon_id::text,0));
  select * into v_request from private.billing_checkout_requests where user_id=p_user_id and request_id=p_request_id;
  if found then
    if v_request.salon_id<>p_salon_id or v_request.stripe_checkout_id<>p_session_id then raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='23514'; end if;
    select * into v_sub from public.business_subscriptions where salon_id=p_salon_id;
    return to_jsonb(v_sub);
  end if;
  v_context:=public.billing_checkout_context(p_user_id,p_salon_id);
  select * into v_reservation from private.billing_checkout_reservations where salon_id=p_salon_id and user_id=p_user_id and request_id=p_request_id for update;
  if not found or v_reservation.expires_at<=now() then raise exception 'BILLING_RESERVATION_REQUIRED' using errcode='23514'; end if;
  v_context:=v_context||jsonb_build_object('amount_cents',v_reservation.amount_cents);
  select * into v_sub from public.business_subscriptions where salon_id=p_salon_id for update;
  if found and v_sub.payment_provider='stripe' and v_sub.stripe_subscription_id is not null and v_sub.status in ('active','past_due') then raise exception 'BILLING_ALREADY_ACTIVE' using errcode='23514'; end if;
  insert into private.billing_checkout_requests(salon_id,user_id,request_id,stripe_checkout_id,checkout_url,stripe_customer_id,stripe_subscription_id,amount_cents)
    values(p_salon_id,p_user_id,p_request_id,p_session_id,p_checkout_url,p_customer_id,p_subscription_id,(v_context->>'amount_cents')::integer);
  insert into public.business_subscriptions(salon_id,status,payment_provider,monthly_price_cents,stripe_customer_id,stripe_subscription_id,stripe_checkout_id,checkout_url)
    values(p_salon_id,'pending','stripe',(v_context->>'amount_cents')::integer,p_customer_id,p_subscription_id,p_session_id,p_checkout_url)
    on conflict(salon_id) do update set status='pending',payment_provider='stripe',monthly_price_cents=excluded.monthly_price_cents,
      stripe_customer_id=coalesce(excluded.stripe_customer_id,public.business_subscriptions.stripe_customer_id),stripe_subscription_id=excluded.stripe_subscription_id,
      stripe_checkout_id=excluded.stripe_checkout_id,checkout_url=excluded.checkout_url,cancel_at_period_end=false,last_stripe_event_at=null,updated_at=now()
    returning * into v_sub;
  delete from private.billing_checkout_reservations where salon_id=p_salon_id and user_id=p_user_id and request_id=p_request_id;
  return to_jsonb(v_sub);
end $$;

create or replace function public.apply_stripe_billing_event(p_event_id text,p_event_type text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_sub public.business_subscriptions; v_request private.billing_checkout_requests; v_salon uuid; v_subscription_id text; v_checkout_id text;
  v_customer_id text; v_invoice_id text; v_status text; v_amount integer; v_start timestamptz; v_end timestamptz; v_paid timestamptz; v_current boolean; v_event_at timestamptz; v_timezone text;
begin
  if p_event_id is null or char_length(p_event_id) not between 1 and 200 or p_event_type is null or char_length(p_event_type) not between 1 and 100
    or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'BILLING_EVENT_INVALID' using errcode='23514'; end if;
  if exists(select 1 from private.billing_provider_events where event_id=p_event_id) then return jsonb_build_object('processed',true,'duplicate',true); end if;
  if p_event_type not in ('checkout.session.completed','checkout.session.expired','invoice.paid','invoice.payment_failed','customer.subscription.updated','customer.subscription.deleted') then
    insert into private.billing_provider_events(event_id,event_type,result) values(p_event_id,p_event_type,'ignored_type') on conflict do nothing;
    return jsonb_build_object('processed',false,'ignored',true);
  end if;
  v_subscription_id:=nullif(p_payload->>'stripe_subscription_id',''); v_checkout_id:=nullif(p_payload->>'stripe_checkout_id','');
  v_customer_id:=nullif(p_payload->>'stripe_customer_id',''); v_invoice_id:=nullif(p_payload->>'stripe_invoice_id','');
  if v_checkout_id is not null then select * into v_request from private.billing_checkout_requests where stripe_checkout_id=v_checkout_id; end if;
  if v_request.id is null and v_subscription_id is not null then select * into v_request from private.billing_checkout_requests where stripe_subscription_id=v_subscription_id order by created_at desc limit 1; end if;
  if v_request.id is null and v_subscription_id is not null then
    select * into v_sub from public.business_subscriptions where stripe_subscription_id=v_subscription_id;
    if found then select * into v_request from private.billing_checkout_requests where salon_id=v_sub.salon_id and stripe_checkout_id=v_sub.stripe_checkout_id; end if;
  end if;
  if v_request.id is null then
    if nullif(p_payload->>'salon_id','') is not null then
      begin v_salon:=(p_payload->>'salon_id')::uuid; exception when invalid_text_representation then v_salon:=null; end;
      if exists(select 1 from public.business_subscriptions where salon_id=v_salon and payment_provider='stripe' and status='pending' and stripe_checkout_id is not null) then
        raise exception 'BILLING_CHECKOUT_NOT_LINKED' using errcode='P0001';
      end if;
    end if;
    insert into private.billing_provider_events(event_id,event_type,result) values(p_event_id,p_event_type,'ignored_unrelated') on conflict do nothing;
    return jsonb_build_object('processed',false,'ignored',true);
  end if;
  v_salon:=v_request.salon_id;
  if nullif(p_payload->>'salon_id','') is not null and p_payload->>'salon_id'<>v_salon::text then raise exception 'BILLING_SALON_MISMATCH' using errcode='23514'; end if;
  if v_request.stripe_subscription_id is not null and v_subscription_id is not null and v_request.stripe_subscription_id<>v_subscription_id then raise exception 'BILLING_SUBSCRIPTION_MISMATCH' using errcode='23514'; end if;
  if v_request.stripe_customer_id is not null and v_customer_id is not null and v_request.stripe_customer_id<>v_customer_id then raise exception 'BILLING_CUSTOMER_MISMATCH' using errcode='23514'; end if;
  select * into v_sub from public.business_subscriptions where salon_id=v_salon for update;
  v_event_at:=coalesce(nullif(p_payload->>'event_created_at','')::timestamptz,now());
  if not isfinite(v_event_at) then raise exception 'BILLING_EVENT_INVALID' using errcode='23514'; end if;
  v_current:=v_sub.payment_provider='stripe' and v_sub.stripe_checkout_id=v_request.stripe_checkout_id
    and (v_sub.last_stripe_event_at is null or v_event_at>=v_sub.last_stripe_event_at);
  insert into private.billing_provider_events(event_id,event_type,salon_id,result) values(p_event_id,p_event_type,v_salon,'processed') on conflict do nothing;
  if not found then return jsonb_build_object('processed',true,'duplicate',true,'salon_id',v_salon); end if;
  update private.billing_checkout_requests set stripe_subscription_id=coalesce(stripe_subscription_id,v_subscription_id),stripe_customer_id=coalesce(stripe_customer_id,v_customer_id) where id=v_request.id;
  v_status:=p_payload->>'status';
  if v_status is not null and v_status not in ('active','past_due','cancelled','pending') then raise exception 'BILLING_STATUS_INVALID' using errcode='23514'; end if;
  if nullif(p_payload->>'period_start','') is not null then v_start:=(p_payload->>'period_start')::timestamptz; end if;
  if nullif(p_payload->>'period_end','') is not null then v_end:=(p_payload->>'period_end')::timestamptz; end if;
  if (v_start is not null and not isfinite(v_start)) or (v_end is not null and not isfinite(v_end)) or (v_start is not null and v_end is not null and v_start>=v_end) then raise exception 'BILLING_PERIOD_INVALID' using errcode='23514'; end if;
  if p_event_type in ('invoice.paid','invoice.payment_failed') then
    if v_invoice_id is null or v_invoice_id !~ '^in_' or char_length(v_invoice_id)>300 or upper(coalesce(p_payload->>'currency',''))<>'EUR'
      or nullif(p_payload->>'amount_cents','') is null then raise exception 'BILLING_INVOICE_INVALID' using errcode='23514'; end if;
    v_amount:=(p_payload->>'amount_cents')::integer;
    if v_amount not between 0 and 1000000 or v_start is null or v_end is null then raise exception 'BILLING_INVOICE_INVALID' using errcode='23514'; end if;
    if exists(select 1 from public.business_charges where stripe_invoice_id=v_invoice_id and salon_id<>v_salon) then raise exception 'BILLING_INVOICE_MISMATCH' using errcode='23514'; end if;
    v_paid:=case when p_event_type='invoice.paid' then coalesce(nullif(p_payload->>'paid_at','')::timestamptz,now()) else null end;
    if v_paid is not null and not isfinite(v_paid) then raise exception 'BILLING_INVOICE_INVALID' using errcode='23514'; end if;
    select timezone into v_timezone from public.salons where id=v_salon;
    -- The date-only ledger covers every salon-local day touched by [start,end).
    -- A midday renewal includes that day's partial coverage; a midnight renewal
    -- excludes that day. Exact provider timestamps remain on the subscription.
    insert into public.business_charges(salon_id,subscription_id,amount_cents,currency,period_start,period_end,due_date,status,payment_provider,paid_at,stripe_invoice_id,external_reference)
      values(v_salon,v_sub.id,v_amount,'EUR',(v_start at time zone v_timezone)::date,((v_end-interval '1 microsecond') at time zone v_timezone)::date+1,
        (v_start at time zone v_timezone)::date,case when p_event_type='invoice.paid' then 'paid' else 'pending' end,'stripe',v_paid,v_invoice_id,v_invoice_id)
      on conflict(stripe_invoice_id) where stripe_invoice_id is not null do update set
        status=case when excluded.status='paid' then 'paid' else public.business_charges.status end,
        paid_at=coalesce(public.business_charges.paid_at,excluded.paid_at),
        amount_cents=case when public.business_charges.status='paid' then public.business_charges.amount_cents else excluded.amount_cents end;
  end if;
  if v_current then
    update public.business_subscriptions set
      stripe_customer_id=coalesce(stripe_customer_id,v_customer_id),stripe_subscription_id=coalesce(stripe_subscription_id,v_subscription_id),
      status=case
        when status='cancelled' then 'cancelled'
        when p_event_type='invoice.paid' then 'active'
        when p_event_type='invoice.payment_failed' then case when exists(select 1 from public.business_charges c where c.stripe_invoice_id=v_invoice_id and c.status='paid') then status else 'past_due' end
        when p_event_type='checkout.session.completed' then case when p_payload->>'payment_status'='paid' then 'active' else status end
        when p_event_type='checkout.session.expired' then case when status='pending' and stripe_subscription_id is null then 'cancelled' else status end
        when p_event_type='customer.subscription.deleted' then 'cancelled'
        else coalesce(v_status,status) end,
      current_period_start=greatest(v_start,current_period_start),current_period_end=greatest(v_end,current_period_end),
      last_stripe_event_at=greatest(v_event_at,last_stripe_event_at),
      cancel_at_period_end=case when p_payload ? 'cancel_at_period_end' then (p_payload->>'cancel_at_period_end')::boolean else cancel_at_period_end end,
      checkout_url=case when p_event_type in ('checkout.session.completed','checkout.session.expired') then null else checkout_url end,updated_at=now()
    where id=v_sub.id;
  end if;
  return jsonb_build_object('processed',true,'duplicate',false,'salon_id',v_salon,'status',(select status from public.business_subscriptions where id=v_sub.id));
end $$;

revoke execute on function public.get_platform_billing(),public.admin_set_platform_billing(integer,boolean),public.admin_list_salons(text),public.admin_get_salon(uuid),public.admin_review_salon(uuid,text,text),public.admin_overview(integer),public.admin_set_business_subscription(uuid,integer,text,text),public.admin_create_business_charge(uuid,date,date,integer,date),public.admin_set_charge_status(uuid,text,text),public.get_business_billing(uuid) from public,anon,authenticated;
grant execute on function public.get_platform_billing(),public.admin_set_platform_billing(integer,boolean),public.admin_list_salons(text),public.admin_get_salon(uuid),public.admin_review_salon(uuid,text,text),public.admin_overview(integer),public.admin_set_business_subscription(uuid,integer,text,text),public.admin_create_business_charge(uuid,date,date,integer,date),public.admin_set_charge_status(uuid,text,text),public.get_business_billing(uuid) to authenticated;
revoke execute on function public.billing_enable_stripe(boolean),public.billing_checkout_context(uuid,uuid),public.billing_reserve_checkout(uuid,uuid,uuid),public.billing_record_checkout(uuid,uuid,uuid,text,text,text,text),public.apply_stripe_billing_event(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.billing_enable_stripe(boolean),public.billing_checkout_context(uuid,uuid),public.billing_reserve_checkout(uuid,uuid,uuid),public.billing_record_checkout(uuid,uuid,uuid,text,text,text,text),public.apply_stripe_billing_event(text,text,jsonb) to service_role;

notify pgrst,'reload schema';
commit;
