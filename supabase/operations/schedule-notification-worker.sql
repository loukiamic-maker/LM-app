-- Run in the privileged Supabase SQL Editor after deploying process-notifications,
-- configuring Resend, and placing the SAME worker secret in Supabase Vault as
-- eneres_notification_worker_secret. This starts real queued email delivery.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$
begin
  if not exists(select 1 from vault.decrypted_secrets
    where name='eneres_notification_worker_secret' and char_length(decrypted_secret)>=32) then
    raise exception 'Add the worker secret to Supabase Vault before scheduling delivery';
  end if;
end $$;
-- Replace only this application's previous schedule; retain unrelated Cron jobs.
select cron.unschedule(jobid) from cron.job where jobname='eneres-notification-worker';
select cron.schedule('eneres-notification-worker','* * * * *',$job$
  select net.http_post(
    url:='https://zpwczfixndjvlrhrhbop.supabase.co/functions/v1/process-notifications',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(
      select decrypted_secret from vault.decrypted_secrets
      where name='eneres_notification_worker_secret' order by created_at desc limit 1)),
    body:='{}'::jsonb,
    timeout_milliseconds:=55000
  );
$job$);
commit;
select jobname,schedule,active from cron.job where jobname='eneres-notification-worker';
