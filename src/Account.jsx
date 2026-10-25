import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, LoaderCircle, LogOut, Mail, ShieldCheck, UserRound, X } from 'lucide-react';
import { authRedirectUrl, platformError, platformReady, supabase, updateProfile as saveProfile } from './lib/platform';
import Brand from './Brand';
import './account.css';

const AccountContext = createContext({ user: null, profile: null, loading: false });
export const useAccount = () => useContext(AccountContext);

export function AccountProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(platformReady);
  const [recovery, setRecovery] = useState(false);
  useEffect(() => {
    if (!supabase) return undefined;
    let alive = true;
    let revision = 0;
    const load = async session => {
      const current = ++revision;
      if (!alive) return;
      const account = session?.user || null;
      setUser(account);
      if (!account) { setProfile(null); setLoading(false); return; }
      const { data } = await supabase.from('profiles').select('full_name').eq('user_id', account.id).maybeSingle();
      if (alive && current === revision) {
        setProfile({ name: data?.full_name || account.user_metadata?.full_name || '', email: account.email || '' });
        setLoading(false);
      }
    };
    supabase.auth.getSession().then(({ data }) => load(data.session)).catch(() => { if (alive) setLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && alive) setRecovery(true);
      // Run database requests outside the Auth client's synchronous lock.
      setTimeout(() => { if (alive) load(session); }, 0);
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, []);
  const updateProfile = async data => { await saveProfile(data); setProfile(previous => ({ ...previous, name: data.name.trim() })); };
  const signOut = async () => { const { error } = await supabase.auth.signOut(); if (error) throw platformError(error); setUser(null); setProfile(null); };
  return <AccountContext.Provider value={{ user, profile, loading, recovery, setRecovery, signOut, updateProfile }}>{children}</AccountContext.Provider>;
}

export function AccountPanel({ onClose }) {
  const { user, profile, recovery, setRecovery, signOut, updateProfile } = useAccount();
  const [mode, setMode] = useState(recovery ? 'password' : 'login');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const panel = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.querySelector('button')?.focus();
    const keyboard = event => {
      if (event.key === 'Escape') close.current();
      if (event.key !== 'Tab') return;
      const elements = [...panel.current.querySelectorAll('button:not(:disabled),input:not(:disabled),a[href]')].filter(el => el.getClientRects().length);
      if (!elements.length) return;
      if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements.at(-1).focus(); }
      if (!event.shiftKey && document.activeElement === elements.at(-1)) { event.preventDefault(); elements[0].focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keyboard); if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => { if (recovery) setMode('password'); }, [recovery]);
  async function perform(work) {
    setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (failure) { setError(failure.userMessage || platformError(failure).userMessage); }
    finally { setBusy(false); }
  }
  async function submit(event) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const email = String(values.get('email') || '').trim();
    const password = String(values.get('password') || '');
    const name = String(values.get('name') || '').trim();
    if ((mode === 'signup' || (user && mode !== 'password')) && name.length < 2) { setError('Συμπληρώστε το όνομά σας με τουλάχιστον δύο χαρακτήρες'); return; }
    await perform(async () => {
      if (mode === 'password') {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setRecovery(false); setMode('login'); setNotice('Ο κωδικός σας ενημερώθηκε');
      } else if (user) {
        await updateProfile({ name }); setNotice('Το προφίλ σας ενημερώθηκε');
      } else if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: authRedirectUrl() });
        if (error) throw error;
        setNotice('Αν υπάρχει λογαριασμός με αυτό το email, θα λάβετε οδηγίες επαναφοράς');
      } else if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: authRedirectUrl(), data: { full_name: name } } });
        if (error) throw error;
        setNotice('Ελέγξτε το email σας για να επιβεβαιώσετε τον λογαριασμό Μετά την επιβεβαίωση, συνδεθείτε εδώ');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setNotice('Συνδεθήκατε Μπορείτε να συνεχίσετε την κράτηση');
      }
    });
  }
  const switchMode = next => { setMode(next); setError(''); setNotice(''); };
  const passwordMode = mode === 'password';
  return <div className="account-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><section className="account-panel" role="dialog" aria-modal="true" aria-labelledby="account-title" ref={panel}>
    <button className="account-close" onClick={onClose} aria-label="Κλείσιμο λογαριασμού"><X size={20} /></button>
    <Brand className="account-identity" />
    <h2 id="account-title">{passwordMode ? 'Ο νέος σας κωδικός' : user ? 'Το προφίλ σας' : mode === 'signup' ? 'Η φροντίδα ξεκινά εδώ' : mode === 'reset' ? 'Ξεχάσατε τον κωδικό;' : 'Καλώς ήρθατε'}</h2>
    {user && !passwordMode && <p className="account-email"><Mail size={15} />{user.email}</p>}
    {user && !user.email_confirmed_at && <div className="account-notice">Επιβεβαιώστε το email σας πριν κάνετε κράτηση<button disabled={busy} onClick={() => perform(async () => { const { error } = await supabase.auth.resend({ type: 'signup', email: user.email, options: { emailRedirectTo: authRedirectUrl() } }); if (error) throw error; setNotice('Στάλθηκε νέος σύνδεσμος επιβεβαίωσης'); })}>Νέος σύνδεσμος</button></div>}
    <form className="account-form" onSubmit={submit}>
      {(mode === 'signup' || (user && !passwordMode)) && <label>Όνομα<input name="name" defaultValue={profile?.name || ''} required minLength={2} maxLength={80} autoComplete="given-name" /></label>}
      {!user && <label>Email<input name="email" type="email" required maxLength={160} autoComplete="email" /></label>}
      {(passwordMode || (!user && mode !== 'reset')) && <label>Κωδικός πρόσβασης<div className="account-password"><input name="password" type={showPassword ? 'text' : 'password'} required minLength={mode === 'login' ? 1 : 10} maxLength={72} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Απόκρυψη κωδικού' : 'Εμφάνιση κωδικού'}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>{mode !== 'login' && <small>Τουλάχιστον 10 χαρακτήρες</small>}</label>}
      {error && <p className="account-error" role="alert">{error}</p>}
      {notice && <p className="account-notice" role="status"><CheckCircle2 size={16} />{notice}</p>}
      <button className="account-primary" disabled={busy}>{busy ? <LoaderCircle className="account-spin" size={18} /> : null}{passwordMode ? 'Αποθήκευση κωδικού' : user ? 'Αποθήκευση προφίλ' : mode === 'signup' ? 'Δημιουργία λογαριασμού' : mode === 'reset' ? 'Αποστολή οδηγιών' : 'Σύνδεση'}</button>
    </form>
    {user ? <div className="account-actions"><button className="account-secondary" onClick={onClose}>Συνέχεια</button><button disabled={busy} onClick={() => perform(signOut)}><LogOut size={16} />Αποσύνδεση</button></div> : <div className="account-switch"><button onClick={() => switchMode(mode === 'signup' ? 'login' : 'signup')}>{mode === 'signup' ? 'Έχω ήδη λογαριασμό' : 'Δημιουργία λογαριασμού'}</button><button onClick={() => switchMode(mode === 'reset' ? 'login' : 'reset')}>{mode === 'reset' ? 'Επιστροφή στη σύνδεση' : 'Ξέχασα τον κωδικό'}</button></div>}
    <p className="account-footer"><ShieldCheck size={13} />Πληρωμή μόνο στο κατάστημα Δεν ζητάμε στοιχεία κάρτας</p>
  </section></div>;
}
