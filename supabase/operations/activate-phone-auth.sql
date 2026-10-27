-- Run in the privileged Supabase SQL Editor AFTER configuring SMS and email.
-- This changes the login/booking policy; it cannot verify external delivery.
-- Existing appointments and existing non-contact calendar actions are preserved.
begin;
-- Synchronize contacts only from phone identities genuinely confirmed by Auth.
update public.profiles p set mobile_phone=private.canonical_auth_phone(u.phone)
from auth.users u where u.id=p.user_id and u.phone_confirmed_at is not null
  and private.canonical_auth_phone(u.phone) is not null
  and p.mobile_phone is distinct from private.canonical_auth_phone(u.phone);
update private.auth_settings set require_verified_booking_phone=true where singleton;
commit;
select public.get_auth_requirements();

-- ROLLBACK ONLY, if SMS/email delivery setup is not ready. Do not run with the
-- activation statements above. This returns to the earlier email sign-in policy.
-- update private.auth_settings set require_verified_booking_phone=false where singleton;
