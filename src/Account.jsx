import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, LoaderCircle, LogOut, Mail, Phone, ShieldCheck, X } from 'lucide-react';
import { authRedirectUrl, platformError, platformReady, supabase, updateProfile as saveProfile } from './lib/platform';
import Brand from './Brand';
import { lockBodyScroll } from './lib/bodyScrollLock';
import PhoneField from './PhoneField';
import { cleanPhone, isValidMobilePhone } from './lib/phone';
import { canonicalAuthPhone, fetchAuthRequirements } from './lib/authRequirements';
import { t } from './i18n';
import LanguageSelector, { useLanguage } from './Language';
import './account.css';

const AccountContext = createContext({ user: null, profile: null, loading: false, requiresPhoneVerification: false, phoneVerified: false, authRequirementsLoading: false, authRequirementsError: '' });
export const useAccount = () => useContext(AccountContext);

export function AccountProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(platformReady);
  const [recovery, setRecovery] = useState(false);
  const [requirements, setRequirements] = useState({ required: false, loading: platformReady, error: '' });
  const profileOwner = useRef(null);
  const loadAccount = useRef(null);
  const requirementRevision = useRef(0);
  const refreshAuthRequirements = useCallback(async () => {
    const revision = ++requirementRevision.current;
    setRequirements((previous) => ({ ...previous, loading: true, error: '' }));
    try {
      const next = await fetchAuthRequirements();
      if (revision === requirementRevision.current) setRequirements({ required: next.require_verified_phone, loading: false, error: '' });
    } catch {
      // A network failure must not silently turn off a server security rule.
      if (revision === requirementRevision.current) setRequirements({ required: true, loading: false, error: t("Δεν μπορέσαμε να ελέγξουμε τις ρυθμίσεις ασφαλούς σύνδεσης. Δοκιμάστε ξανά") });
    }
  }, []);
  useEffect(() => {
    if (!supabase) return undefined;
    refreshAuthRequirements();
    const refresh = () => {if (document.visibilityState !== 'hidden') refreshAuthRequirements();};
    window.addEventListener('focus', refresh);
    return () => {requirementRevision.current++;window.removeEventListener('focus', refresh);};
  }, [refreshAuthRequirements]);
  useEffect(() => {
    if (!supabase) return undefined;
    let alive = true;
    let revision = 0;
    const load = async (session) => {
      const current = ++revision;
      if (!alive) return;
      const account = session?.user || null;
      if (profileOwner.current !== (account?.id || null)) {
        profileOwner.current = account?.id || null;setProfile(null);setLoading(Boolean(account));
      }
      setUser(account);
      if (!account) {setProfile(null);setLoading(false);return;}
      let { data, error } = await supabase.from('profiles').select('full_name,mobile_phone').eq('user_id', account.id).maybeSingle();
      if (error && (error.code === '42703' || /mobile_phone.*does not exist/i.test(error.message || ''))) {
        const fallback = await supabase.from('profiles').select('full_name').eq('user_id', account.id).maybeSingle();
        data = fallback.data;
      }
      if (alive && current === revision && profileOwner.current === account.id) {
        setProfile({ name: data?.full_name || account.user_metadata?.full_name || '', email: account.email || '', mobilePhone: data?.mobile_phone || account.user_metadata?.mobile_phone || '' });
        setLoading(false);
      }
    };
    loadAccount.current = load;
    supabase.auth.getSession().then(({ data }) => load(data.session)).catch(() => {if (alive) setLoading(false);});
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && alive) setRecovery(true);
      // Run database requests outside the Auth client's synchronous lock.
      setTimeout(() => {if (alive) load(session);}, 0);
    });
    return () => {alive = false;loadAccount.current = null;subscription.unsubscribe();};
  }, []);
  const updateProfile = async (data) => {const owner = profileOwner.current;await saveProfile(data);if (owner === profileOwner.current) setProfile((previous) => ({ ...previous, name: data.name.trim(), ...(data.mobilePhone !== undefined ? { mobilePhone: data.mobilePhone } : {}) }));};
  const signOut = async () => {const { error } = await supabase.auth.signOut();if (error) throw platformError(error);profileOwner.current = null;setUser(null);setProfile(null);};
  const refreshAccount = async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    await loadAccount.current?.({ user: data.user });
    return data.user;
  };
  const phoneVerified = Boolean(user?.phone_confirmed_at && canonicalAuthPhone(user.phone) && canonicalAuthPhone(user.phone) === cleanPhone(profile?.mobilePhone || ''));
  return <AccountContext.Provider value={{ user, profile, loading, recovery, setRecovery, signOut, updateProfile, refreshAccount, requiresPhoneVerification: requirements.required, phoneVerified, authRequirementsLoading: requirements.loading, authRequirementsError: requirements.error, refreshAuthRequirements }}>{children}</AccountContext.Provider>;
}

const phoneAuthMessage = (failure) => {
  const message = `${failure?.code || ''} ${failure?.message || ''}`;
  if (/otp_expired|invalid.*token|token.*invalid|expired.*token|invalid.*otp/i.test(message)) return t("Ο κωδικός δεν είναι σωστός ή έχει λήξει. Ζητήστε νέο κωδικό");
  if (/phone_exists|phone.*already|already.*phone/i.test(message)) return t("Αυτό το κινητό χρησιμοποιείται ήδη από άλλον λογαριασμό");
  if (/sms_provider_disabled|phone_provider_disabled|(?:sms|phone).*provider.*disabled|sms.*not.*configured|unsupported.*provider/i.test(message)) return t("Η αποστολή SMS δεν είναι διαθέσιμη αυτή τη στιγμή. Δοκιμάστε ξανά αργότερα");
  return failure?.userMessage || platformError(failure).userMessage;
};

export function AccountPanel({ onClose }) {
  useLanguage();
  const { user, profile, loading: accountLoading, recovery, setRecovery, signOut, updateProfile, refreshAccount, requiresPhoneVerification, phoneVerified, authRequirementsLoading, authRequirementsError, refreshAuthRequirements } = useAccount();
  const [mode, setMode] = useState(recovery ? 'password' : 'login');
  const [loginMethod, setLoginMethod] = useState('phone');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [mobilePhone, setMobilePhone] = useState(profile?.mobilePhone || '');
  const [pendingCode, setPendingCode] = useState(null);
  const [code, setCode] = useState('');
  const [pendingEmail, setPendingEmail] = useState(user?.new_email || user?.email || '');
  const [emailLinkRequested, setEmailLinkRequested] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [resendSeconds, setResendSeconds] = useState(0);
  const phoneEdited = useRef(false);
  const panel = useRef(null);
  const close = useRef(onClose);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  close.current = onClose;
  const closeAccount = () => {if (!busyRef.current) close.current();};
  useEffect(() => {
    const previous = document.activeElement;
    const releaseScroll = lockBodyScroll();
    panel.current?.querySelector('button')?.focus();
    const keyboard = (event) => {
      if (event.key === 'Escape') {if (!busyRef.current) close.current();return;}
      if (event.key !== 'Tab') return;
      const elements = [...(panel.current?.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]') || [])].filter((el) => el.getClientRects().length);
      if (!elements.length) return;
      if (event.shiftKey && document.activeElement === elements[0]) {event.preventDefault();elements.at(-1).focus();}
      if (!event.shiftKey && document.activeElement === elements.at(-1)) {event.preventDefault();elements[0].focus();}
    };
    document.addEventListener('keydown', keyboard);
    return () => {releaseScroll();document.removeEventListener('keydown', keyboard);if (previous?.isConnected) previous.focus();};
  }, []);
  useEffect(() => {if (recovery) setMode('password');}, [recovery]);
  useEffect(() => {if (!phoneEdited.current) setMobilePhone(profile?.mobilePhone || '');}, [profile?.mobilePhone]);
  useEffect(() => {phoneEdited.current = false;setMobilePhone(profile?.mobilePhone || '');setPendingEmail(user?.new_email || user?.email || '');setEmailLinkRequested(false);setPendingCode(null);setCode('');setError('');setNotice('');}, [user?.id]);
  useEffect(() => {
    if (!pendingCode) return undefined;
    const update = () => setResendSeconds(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
    update();const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [pendingCode, resendAt]);
  async function perform(work) {
    setBusy(true);setError('');setNotice('');
    try {await work();} catch (failure) {setError(phoneAuthMessage(failure));} finally
    {setBusy(false);}
  }
  function showCode(next) {
    setPendingCode(next);setCode('');setResendAt(Date.now() + 60000);
    setNotice(t("Στείλαμε κωδικό επιβεβαίωσης στο κινητό σας"));
  }
  async function submit(event) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const email = String(values.get('email') || '').trim();
    const password = String(values.get('password') || '');
    const name = String(values.get('name') || '').trim();
    const needsName = mode === 'signup' || user && mode !== 'password';
    const usingPhone = requiresPhoneVerification && !user && loginMethod === 'phone' && ['login', 'signup'].includes(mode);
    if (needsName && (name.length < 2 || name.length > 80)) {setError(t("Συμπληρώστε το όνομά σας με τουλάχιστον δύο χαρακτήρες"));return;}
    if ((needsName || usingPhone) && !isValidMobilePhone(mobilePhone)) {setError(t("Επιλέξτε τον σωστό κωδικό χώρας και συμπληρώστε έγκυρο αριθμό κινητού"));return;}
    if (accountLoading || authRequirementsLoading || authRequirementsError) return;
    await perform(async () => {
      if (mode === 'password') {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setRecovery(false);setMode('login');setNotice(t("Ο κωδικός σας ενημερώθηκε"));
      } else if (user) {
        const phone = cleanPhone(mobilePhone);
        if (requiresPhoneVerification && (!phoneVerified || phone !== canonicalAuthPhone(user.phone))) {
          const { error } = await supabase.auth.updateUser({ phone, data: { full_name: name } });
          if (error) throw error;
          showCode({ phone, type: 'phone_change', name });
          return;
        }
        await updateProfile({ name, mobilePhone: phone });setNotice(t("Το προφίλ σας ενημερώθηκε"));
      } else if (usingPhone) {
        const phone = cleanPhone(mobilePhone);
        const options = { shouldCreateUser: mode === 'signup', ...(mode === 'signup' ? { data: { full_name: name, mobile_phone: phone } } : {}) };
        const { error } = await supabase.auth.signInWithOtp({ phone, options });
        if (error) throw error;
        showCode({ phone, type: 'sms', options });
      } else if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: authRedirectUrl() });
        if (error) throw error;
        setNotice(t("Αν υπάρχει λογαριασμός με αυτό το email, θα λάβετε οδηγίες επαναφοράς"));
      } else if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: authRedirectUrl(), data: { full_name: name, mobile_phone: cleanPhone(mobilePhone) } } });
        if (error) throw error;
        setNotice(t("Ελέγξτε το email σας για να επιβεβαιώσετε τον λογαριασμό. Μετά την επιβεβαίωση, συνδεθείτε εδώ"));
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setNotice(t("Συνδεθήκατε. Μπορείτε να συνεχίσετε την κράτηση"));
      }
    });
  }
  async function verifyCode(event) {
    event.preventDefault();
    if (!pendingCode || !/^[0-9]{6}$/.test(code)) {setError(t("Γράψτε τον εξαψήφιο κωδικό που λάβατε με SMS"));return;}
    const pending = pendingCode;
    await perform(async () => {
      const { error } = await supabase.auth.verifyOtp({ phone: pending.phone, token: code, type: pending.type });
      if (error) throw error;
      const current = await refreshAccount();
      if (pending.type === 'phone_change') await updateProfile({ name: pending.name });
      phoneEdited.current = false;
      setPendingCode(null);setCode('');setMobilePhone(pending.phone);
      setNotice(pending.type === 'phone_change' ? t("Το κινητό σας επιβεβαιώθηκε και ενημερώθηκε στο προφίλ") : current?.email_confirmed_at ? t("Συνδεθήκατε με ασφάλεια. Μπορείτε να συνεχίσετε την κράτηση") : t("Το κινητό σας επιβεβαιώθηκε. Επιβεβαιώστε και το email σας πριν από την πρώτη κράτηση"));
    });
  }
  async function resendCode() {
    if (!pendingCode || resendSeconds > 0) return;
    await perform(async () => {
      const { error } = pendingCode.type === 'phone_change' ?
      await supabase.auth.resend({ type: 'phone_change', phone: pendingCode.phone }) :
      await supabase.auth.signInWithOtp({ phone: pendingCode.phone, options: pendingCode.options });
      if (error) throw error;
      setResendAt(Date.now() + 60000);setNotice(t("Στείλαμε νέο κωδικό στο κινητό σας"));
    });
  }
  async function sendEmail(event) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get('verificationEmail') || '').trim();
    await perform(async () => {
      const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: authRedirectUrl() });
      if (error) throw error;
      setPendingEmail(email);setEmailLinkRequested(true);setNotice(t("Στείλαμε σύνδεσμο επιβεβαίωσης στο email σας. Ανοίξτε τον για να ενεργοποιήσετε τις κρατήσεις"));
      await refreshAccount();
    });
  }
  async function resendEmail() {
    const email = pendingEmail || user?.new_email || user?.email;
    if (!email) return;
    await perform(async () => {
      const type = emailLinkRequested || user?.new_email || user?.email_change_sent_at || !user?.email ? 'email_change' : 'signup';
      const { error } = await supabase.auth.resend({ type, email, options: { emailRedirectTo: authRedirectUrl() } });
      if (error) throw error;
      setNotice(t("Στάλθηκε νέος σύνδεσμος επιβεβαίωσης"));
    });
  }
  const switchMode = (next) => {setMode(next);setPendingCode(null);setCode('');setError('');setNotice('');if (next === 'signup') setLoginMethod('phone');};
  const passwordMode = mode === 'password';
  const phoneMode = requiresPhoneVerification && !user && loginMethod === 'phone' && ['login', 'signup'].includes(mode);
  const draftPhoneVerified = phoneVerified && cleanPhone(mobilePhone) === canonicalAuthPhone(user?.phone);
  const disabled = busy || accountLoading || authRequirementsLoading || Boolean(authRequirementsError);
  const statusMessages = <>{error && <p className="account-error" role="alert">{t(error)}</p>}{notice && <p className="account-notice" role="status"><CheckCircle2 size={16} />{t(notice)}</p>}</>;
  return <div className="account-overlay" onMouseDown={(event) => {if (event.target === event.currentTarget) closeAccount();}}><section className="account-panel" role="dialog" aria-modal="true" aria-labelledby="account-title" ref={panel}>
    <button className="account-close" disabled={busy || accountLoading} onClick={closeAccount} aria-label={t("Κλείσιμο λογαριασμού")}><X size={20} /></button>
    <div className="account-language"><LanguageSelector /></div>
    <Brand className="account-identity" />
    <h2 id="account-title">{pendingCode ? t("Επιβεβαίωση κινητού") : passwordMode ? t("Ο νέος σας κωδικός") : user ? t("Το προφίλ σας") : mode === 'signup' ? t("Η φροντίδα ξεκινά εδώ") : mode === 'reset' ? t("Ξεχάσατε τον κωδικό;") : t("Καλώς ήρθατε")}</h2>
    {authRequirementsLoading && <p className="account-security-status"><LoaderCircle size={16} className="account-spin" />{t("Έλεγχος ασφαλούς σύνδεσης…")}</p>}
    {authRequirementsError && <div className="account-error" role="alert">{t(authRequirementsError)}<button type="button" onClick={refreshAuthRequirements}>{t("Δοκιμή ξανά")}</button></div>}
    {pendingCode ? <>
      <p className="account-sms-description">{t("Γράψτε τον κωδικό που στάλθηκε στο")}{" "}<strong>{pendingCode.phone}</strong></p>
      <form className="account-form" onSubmit={verifyCode}>
        <label htmlFor="eneres-sms-code">{t("Κωδικός SMS")}<input id="eneres-sms-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required autoFocus disabled={busy || accountLoading} /></label>
        {statusMessages}
        <button type="submit" className="account-primary" disabled={disabled}>{busy && <LoaderCircle className="account-spin" size={18} />}{t("Επιβεβαίωση κωδικού")}</button>
      </form>
      <div className="account-code-actions"><button type="button" disabled={disabled || resendSeconds > 0} onClick={resendCode}>{resendSeconds > 0 ? t('Νέος κωδικός σε {seconds}″', { seconds: resendSeconds }) : t("Αποστολή νέου κωδικού")}</button><button type="button" disabled={busy || accountLoading} onClick={() => {setPendingCode(null);setCode('');setError('');setNotice('');}}>{t("Αλλαγή αριθμού")}</button></div>
    </> : <>
      {user && !passwordMode && user.email && <p className="account-email"><Mail size={15} />{user.email}{user.email_confirmed_at && <CheckCircle2 size={15} aria-label={t("Επιβεβαιωμένο email")} />}</p>}
      {user && requiresPhoneVerification && !passwordMode && <p className={`account-verification ${draftPhoneVerified ? 'account-verification-confirmed' : ''}`}><Phone size={16} />{draftPhoneVerified ? t("Το κινητό σας έχει επιβεβαιωθεί με SMS") : t("Επιβεβαιώστε το κινητό σας με SMS για να κάνετε κράτηση")}</p>}
      {user && !user.email_confirmed_at && !passwordMode && <div className="account-email-verification">
        <p>{t("Επιβεβαιώστε το email σας πριν κάνετε κράτηση. Εκεί θα λαμβάνετε τις επιβεβαιώσεις και τις ακυρώσεις ραντεβού")}</p>
        {requiresPhoneVerification ? <form className="account-form account-email-form" onSubmit={sendEmail}><label htmlFor="eneres-verification-email">Email<input id="eneres-verification-email" name="verificationEmail" type="email" required maxLength={160} defaultValue={pendingEmail} autoComplete="email" disabled={busy || accountLoading} /></label><button type="submit" className="account-secondary" disabled={disabled || !phoneVerified}>{t("Αποστολή επιβεβαίωσης email")}</button></form> : null}
        {(user.email || pendingEmail) && <button type="button" disabled={disabled} onClick={resendEmail}>{t("Νέος σύνδεσμος επιβεβαίωσης email")}</button>}
        {requiresPhoneVerification && <button type="button" disabled={disabled} onClick={() => perform(async () => {const current = await refreshAccount();setNotice(current?.email_confirmed_at ? t("Το email σας έχει επιβεβαιωθεί") : t("Το email δεν έχει επιβεβαιωθεί ακόμη. Ανοίξτε τον σύνδεσμο που λάβατε"));})}>{t("Έχω επιβεβαιώσει το email")}</button>}
      </div>}
      <form className="account-form" onSubmit={submit}>
        {(mode === 'signup' || user && !passwordMode) && <label>{t("Όνομα")}<input name="name" defaultValue={profile?.name || ''} required minLength={2} maxLength={80} autoComplete="given-name" disabled={busy || accountLoading} /></label>}
        {!user && !phoneMode && <label>Email<input name="email" type="email" required maxLength={160} autoComplete="email" disabled={busy || accountLoading} /></label>}
        {(phoneMode || mode === 'signup' || user && !passwordMode) && <PhoneField value={mobilePhone} onChange={(value) => {phoneEdited.current = true;setMobilePhone(value);}} disabled={busy || accountLoading} />}
        {(passwordMode || !user && mode !== 'reset' && !phoneMode) && <label>{t("Κωδικός πρόσβασης")}<div className="account-password"><input name="password" type={showPassword ? 'text' : 'password'} required minLength={mode === 'login' ? 1 : 10} maxLength={72} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} disabled={busy || accountLoading} /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? t("Απόκρυψη κωδικού") : t("Εμφάνιση κωδικού")}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>{mode !== 'login' && <small>{t("Τουλάχιστον 10 χαρακτήρες")}</small>}</label>}
        {statusMessages}
        <button className="account-primary" disabled={disabled}>{busy ? <LoaderCircle className="account-spin" size={18} /> : null}{passwordMode ? t("Αποθήκευση κωδικού") : user ? requiresPhoneVerification && (!phoneVerified || cleanPhone(mobilePhone) !== canonicalAuthPhone(user.phone)) ? t("Επιβεβαίωση κινητού με SMS") : t("Αποθήκευση προφίλ") : phoneMode ? t("Αποστολή κωδικού SMS") : mode === 'signup' ? t("Δημιουργία λογαριασμού") : mode === 'reset' ? t("Αποστολή οδηγιών") : t("Σύνδεση")}</button>
      </form>
      {user ? <div className="account-actions"><button className="account-secondary" disabled={busy || accountLoading} onClick={closeAccount}>{t("Συνέχεια")}</button><button disabled={busy || accountLoading} onClick={() => perform(signOut)}><LogOut size={16} />{t("Αποσύνδεση")}</button></div> : <div className="account-switch"><button type="button" onClick={() => switchMode(mode === 'signup' ? 'login' : 'signup')}>{mode === 'signup' ? t("Έχω ήδη λογαριασμό") : requiresPhoneVerification && loginMethod === 'email' ? t("Δημιουργία λογαριασμού με κινητό") : t("Δημιουργία λογαριασμού")}</button>{!phoneMode && <button type="button" onClick={() => switchMode(mode === 'reset' ? 'login' : 'reset')}>{mode === 'reset' ? t("Επιστροφή στη σύνδεση") : t("Ξέχασα τον κωδικό")}</button>}</div>}
      {requiresPhoneVerification && !user && !passwordMode && <button className="account-login-method" type="button" onClick={() => {setLoginMethod(loginMethod === 'phone' ? 'email' : 'phone');setMode('login');setError('');setNotice('');}}>{loginMethod === 'phone' ? t("Σύνδεση με email για υπάρχοντα λογαριασμό") : t("Σύνδεση με κινητό και SMS")}</button>}
    </>}
    <p className="account-footer"><ShieldCheck size={13} />{t("Πληρωμή μόνο στο κατάστημα. Δεν ζητάμε στοιχεία κάρτας")}</p>
  </section></div>;
}
