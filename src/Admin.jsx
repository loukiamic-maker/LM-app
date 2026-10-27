import { t, getLocale } from './i18n';
import LanguageSelector, { useLanguage } from './Language';
import { formatEuroCents } from './lib/currency';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, BarChart3, CalendarDays, CheckCircle2, Copy, CreditCard, Euro, FileCheck2, LoaderCircle, RefreshCw, ShieldCheck, Store, Users, Video, X } from 'lucide-react';
import Brand from './Brand';
import { AccountPanel, useAccount } from './Account';
import { createBusinessCharge, getAdminOverview, getAdminSalon, getAdminSalons, getPlatformBilling, managementError, refreshAdminAccess, reviewSalon, setBusinessSubscription, setChargeStatus, setPlatformBilling } from './lib/admin';
import './admin.css';
import { tutorialGuides, tutorialShareUrl } from './lib/tutorials';

const currency = cents => cents == null ? t("Δεν έχει οριστεί") : formatEuroCents(cents);
const number = value => value == null ? '—' : new Intl.NumberFormat(getLocale()).format(Number(value));
const displayDate = value => value ? new Date(String(value).length === 10 ? `${value}T12:00:00Z` : value).toLocaleDateString(getLocale(), { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const addDay = (value, amount) => { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10); };
const today = () => new Date().toISOString().slice(0, 10);
const priceInput = cents => cents == null ? '' : (Number(cents) / 100).toFixed(2);
const centsInput = value => String(value).trim() === '' ? null : Math.round(Number(String(value).replace(',', '.')) * 100);
const salonStatus = { draft: 'Πρόχειρη', pending: 'Σε έλεγχο', published: 'Δημοσιευμένη', rejected: 'Χρειάζεται αλλαγές', suspended: 'Σε αναστολή' };
const subscriptionStatus = { pending: 'Σε αναμονή', active: 'Ενεργή', past_due: 'Εκκρεμεί πληρωμή', cancelled: 'Ακυρωμένη' };
const chargeStatus = { pending: 'Σε εκκρεμότητα', paid: 'Εξοφλημένη', void: 'Ακυρωμένη' };
const weekdays = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];

function Busy({ children = t("Φόρτωση…") }) { return <span className="en-admin-busy" role="status"><LoaderCircle size={17} />{typeof children === 'string' ? t(children) : children}</span>; }
function Notice({ children, error = false }) { return children ? <p className={`en-admin-notice${error ? ' en-admin-error' : ''}`} role={error ? 'alert' : 'status'}>{typeof children === 'string' ? t(children) : children}</p> : null; }
function Field({ label, children }) { return <label className="en-admin-field"><span>{t(label)}</span>{children}</label>; }

function ReviewPanel({ detail, busy, onReview }) {
  const [note, setNote] = useState('');
  const [validation, setValidation] = useState('');
  const salon = detail.salon;
  const staffById = Object.fromEntries((detail.staff || []).map(person => [person.id, person.name]));
  function review(decision) {
    if (decision === 'rejected' && note.trim().length < 3) { setValidation(t("Γράψτε τι χρειάζεται να αλλάξει η επιχείρηση")); return; }
    setValidation(''); onReview(salon.id, decision, note);
  }
  return <section className="en-admin-card en-admin-review" aria-label={t("Έλεγχος {name}", { name: salon.name })}>
    <div className="en-admin-card-heading"><div><span className="en-admin-eyebrow">{t("ΣΤΟΙΧΕΙΑ ΕΠΙΧΕΙΡΗΣΗΣ")}</span><h2>{salon.name}</h2></div><span className={`en-admin-pill en-admin-pill-${salon.status}`}>{t(salonStatus[salon.status] || salon.status)}</span></div>
    <p className="en-admin-muted">{[salon.address, t(salon.city), t(salon.country)].filter(Boolean).join(', ')}</p>
    {salon.description && <p className="en-admin-description">{salon.description}</p>}
    <dl className="en-admin-info"><div><dt>{t("Ιδιοκτήτης")}</dt><dd>{detail.owner?.full_name || detail.owner?.name || t("Δεν έχει συμπληρωθεί")}</dd></div><div><dt>{t("Email ιδιοκτήτη")}</dt><dd>{detail.owner?.email || '—'}</dd></div><div><dt>{t("Επιβεβαίωση email")}</dt><dd>{detail.owner?.confirmed ? t("Επιβεβαιωμένο", "Verified") : t("Σε αναμονή")}</dd></div><div><dt>{t("Πολιτική ακύρωσης")}</dt><dd>{salon.cancellation_hours} {t("ώρες πριν")}</dd></div></dl>
    <h3>{t("Υπηρεσίες")}</h3>
    <ul className="en-admin-detail-list">{(detail.services || []).map(service => <li key={service.id}><span>{service.name}{service.active === false && <small>{t("Ανενεργή")}</small>}</span><span>{service.duration_minutes}′ · {currency(service.price_cents)}</span></li>)}</ul>
    {!detail.services?.length && <p className="en-admin-muted">{t("Δεν έχουν προστεθεί υπηρεσίες")}</p>}
    <h3>{t("Ομάδα και ωράριο")}</h3>
    <ul className="en-admin-detail-list">{(detail.staff || []).map(person => <li key={person.id}><span>{person.name}</span><span>{person.active ? t("Ενεργός επαγγελματίας") : t("Ανενεργός")}</span></li>)}</ul>
    <ul className="en-admin-hours">{(detail.hours || []).map((hours, index) => <li key={hours.id || index}>{staffById[hours.staff_id] || t("Επαγγελματίας")} · {t(weekdays[hours.weekday])} · {String(hours.opens_at).slice(0, 5)}–{String(hours.closes_at).slice(0, 5)}</li>)}</ul>
    {salon.status === 'pending' ? <><Field label={t("Σημείωση ελέγχου")}><textarea rows={3} value={note} maxLength={2000} onChange={event => setNote(event.target.value)} placeholder={t("Πληροφορίες για την έγκριση ή τις απαραίτητες αλλαγές")} /></Field><Notice error>{validation}</Notice><div className="en-admin-actions"><button className="en-admin-primary" disabled={busy} onClick={() => review('published')}><CheckCircle2 size={16} />{t("Έγκριση επιχείρησης")}</button><button className="en-admin-secondary" disabled={busy} onClick={() => review('rejected')}>{t("Απόρριψη αιτήματος")}</button></div></> : <p className="en-admin-muted">{t("Δεν υπάρχει εκκρεμές αίτημα για αυτή την επιχείρηση")}</p>}
    {!!detail.reviews?.length && <details className="en-admin-audit"><summary>{t("Ιστορικό ελέγχων")}</summary>{detail.reviews.map((entry, index) => <p key={entry.id || index}><strong>{t(salonStatus[entry.decision] || entry.decision)}</strong> · {displayDate(entry.created_at)}{entry.note && <span>{entry.note}</span>}</p>)}</details>}
  </section>;
}

function PlanForm({ plan, busy, onSave }) {
  const [price, setPrice] = useState(priceInput(plan?.monthly_price_cents));
  const [enabled, setEnabled] = useState(Boolean(plan?.enabled));
  const [validation, setValidation] = useState('');
  async function submit(event) {
    event.preventDefault();
    const amount = centsInput(price);
    if ((amount != null && (!Number.isInteger(amount) || amount < 1 || amount > 1000000)) || (enabled && amount == null)) { setValidation(t("Ορίστε έγκυρη μηνιαία τιμή για την ενεργή συνδρομή")); return; }
    setValidation(''); await onSave(amount, enabled);
  }
  return <form className="en-admin-card en-admin-form" onSubmit={submit}><div className="en-admin-card-heading"><div><span className="en-admin-eyebrow">{t("ΜΗΝΙΑΙΑ ΣΥΝΔΡΟΜΗ")}</span><h2>{t("Τιμή χρήσης της πλατφόρμας")}</h2></div><CreditCard size={22} /></div><Field label={t("Μηνιαία συνδρομή (€)")}><input type="number" min="0.01" max="10000" step="0.01" value={price} onChange={event => setPrice(event.target.value)} placeholder={t("Ορίστε την τιμή σας")} /></Field><label className="en-admin-checkbox"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />{t("Ενεργή μηνιαία συνδρομή")}</label><p className="en-admin-muted">{t("Η τιμή ορίζεται από εσάς και δεν δημιουργεί αυτόματα χρέωση ή πληρωμή")}</p><Notice error>{validation}</Notice><button className="en-admin-primary" disabled={busy} type="submit">{t("Αποθήκευση τιμής")}</button></form>;
}

function BusinessChargeForm({ detail, plan, busy, onSubscription, onCreateCharge }) {
  const current = detail.subscription;
  const stripeManaged = current?.payment_provider === 'stripe' && current?.status !== 'cancelled';
  const currentDate = today();
  const first = `${currentDate.slice(0, 7)}-01`;
  const nextMonth = new Date(`${first}T12:00:00Z`); nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const [subscriptionPrice, setSubscriptionPrice] = useState(priceInput(current?.monthly_price_cents));
  const [status, setStatus] = useState(current?.status || 'pending');
  const [start, setStart] = useState(first);
  const [end, setEnd] = useState(addDay(nextMonth.toISOString().slice(0, 10), -1));
  const [amount, setAmount] = useState(priceInput(current?.monthly_price_cents ?? plan?.monthly_price_cents));
  const [due, setDue] = useState(currentDate);
  const [validation, setValidation] = useState('');
  async function saveSubscription(event) {
    event.preventDefault(); const value = centsInput(subscriptionPrice);
    if (value != null && (!Number.isInteger(value) || value < 1 || value > 1000000)) { setValidation(t("Ελέγξτε τη μηνιαία τιμή")); return; }
    if (stripeManaged) return;
    setValidation(''); await onSubscription(detail.salon.id, value, status);
  }
  async function createCharge(event) {
    event.preventDefault(); const value = centsInput(amount);
    if (!start || !end || end < start || value == null || !Number.isInteger(value) || value < 1 || value > 1000000) { setValidation(t("Συμπληρώστε έγκυρη περίοδο και ποσό")); return; }
    if (stripeManaged) return;
    setValidation(''); await onCreateCharge({ salonId: detail.salon.id, periodStart: start, periodEnd: addDay(end, 1), amountCents: value, dueDate: due || null });
  }
  return <section className="en-admin-card"><div className="en-admin-card-heading"><div><h2>{detail.salon.name}</h2><p className="en-admin-muted">{[t(detail.salon.city), t(detail.salon.country)].join(', ')}</p></div><span className="en-admin-pill">{t(subscriptionStatus[current?.status] || "Χωρίς συνδρομή")}</span></div><form className="en-admin-form" onSubmit={saveSubscription}><h3>{t("Συνδρομή επιχείρησης")}</h3><div className="en-admin-form-grid"><Field label={t("Ειδική μηνιαία τιμή (€)")}><input type="number" disabled={stripeManaged} min="0.01" max="10000" step="0.01" value={subscriptionPrice} onChange={event => setSubscriptionPrice(event.target.value)} placeholder={t("Προεπιλεγμένη τιμή")} /></Field><Field label={t("Κατάσταση συνδρομής")}><select disabled={stripeManaged} value={status} onChange={event => setStatus(event.target.value)}>{Object.entries(subscriptionStatus).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></Field></div><button className="en-admin-secondary" disabled={busy || stripeManaged} type="submit">{t("Αποθήκευση συνδρομής")}</button>{stripeManaged && <p className="en-admin-muted">{t("Η συνδρομή με κάρτα ενημερώνεται αυτόματα από το περιβάλλον πληρωμών")}</p>}</form><form className="en-admin-form en-admin-charge-form" onSubmit={createCharge}><h3>{t("Νέα μηνιαία χρέωση")}</h3><div className="en-admin-form-grid"><Field label={t("Περίοδος από")}><input type="date" required value={start} onChange={event => setStart(event.target.value)} /></Field><Field label={t("Περίοδος έως")}><input type="date" required min={start} value={end} onChange={event => setEnd(event.target.value)} /></Field><Field label={t("Ποσό χρέωσης (€)")}><input type="number" min="0.01" max="10000" step="0.01" required value={amount} onChange={event => setAmount(event.target.value)} /></Field><Field label={t("Πληρωτέα έως")}><input type="date" value={due} onChange={event => setDue(event.target.value)} /></Field></div><p className="en-admin-muted">{t("Η καταχώριση δημιουργεί εκκρεμή χρέωση και δεν τραβά χρήματα από κάρτα")}</p><Notice error>{validation}</Notice><button type="submit" className="en-admin-primary" disabled={busy || stripeManaged}>{t("Δημιουργία μηνιαίας χρέωσης")}</button></form></section>;
}

function PaymentConfirmation({ charge, busy, onClose, onConfirm }) {
  const [reference, setReference] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement; const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; ref.current?.querySelector('input')?.focus();
    const key = event => {
      if (event.key === 'Escape' && !busy) onClose();
      if (event.key !== 'Tab') return;
      const controls = [...ref.current.querySelectorAll('button:not(:disabled),input:not(:disabled)')];
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = overflow; previous?.focus(); };
  }, [busy, onClose]);
  return <div className="en-admin-modal-backdrop"><section className="en-admin-card en-admin-modal" ref={ref} role="dialog" aria-modal="true" aria-labelledby="admin-payment-title"><button className="en-admin-modal-close" onClick={onClose} aria-label={t("Κλείσιμο εξόφλησης")} disabled={busy}><X size={20} /></button><h2 id="admin-payment-title">{t("Καταχώριση εξόφλησης")}</h2><p>{t("Επιβεβαιώνετε ότι έχει ήδη εισπραχθεί το ποσό")} {currency(charge.amount_cents)}</p><Field label={t("Αναφορά πληρωμής")}><input maxLength={200} value={reference} onChange={event => setReference(event.target.value)} placeholder={t("Προαιρετικός αριθμός κατάθεσης ή σημείωση")} /></Field><div className="en-admin-actions"><button className="en-admin-secondary" onClick={onClose} disabled={busy}>{t("Επιστροφή")}</button><button className="en-admin-primary" disabled={busy} onClick={() => onConfirm(charge.id, reference)}>{t("Επιβεβαίωση εξόφλησης")}</button></div></section></div>;
}

export default function Admin({ onBack }) {
  useLanguage();
  const account = useAccount();
  const allowed = Boolean(account.user?.email_confirmed_at && account.user?.app_metadata?.role === 'admin');
  const identity = useRef(''); identity.current = allowed ? account.user.id : '';
  const loadSequence = useRef(0), detailSequence = useRef(0);
  const [authOpen, setAuthOpen] = useState(false);
  const [tab, setTab] = useState('overview');
  const [copiedGuide, setCopiedGuide] = useState('');
  const [days, setDays] = useState(30);
  const [overview, setOverview] = useState(null), [salons, setSalons] = useState([]), [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [statusFilter, setStatusFilter] = useState('pending');
  const [selectedId, setSelectedId] = useState(''), [detail, setDetail] = useState(null), [detailLoading, setDetailLoading] = useState(false);
  const [paymentCharge, setPaymentCharge] = useState(null);

  const refresh = useCallback(async () => {
    if (!allowed) return;
    const owner = account.user.id, sequence = ++loadSequence.current;
    setLoading(true); setError('');
    try {
      const [stats, businesses, billing] = await Promise.all([getAdminOverview(days), getAdminSalons(), getPlatformBilling()]);
      if (identity.current !== owner || sequence !== loadSequence.current) return;
      setOverview(stats); setSalons(Array.isArray(businesses) ? businesses : []); setPlan(billing);
    } catch (failure) { if (identity.current === owner && sequence === loadSequence.current) setError(managementError(failure).userMessage); }
    finally { if (identity.current === owner && sequence === loadSequence.current) setLoading(false); }
  }, [allowed, account.user?.id, days]);

  const refreshDetail = useCallback(async () => {
    if (!allowed || !selectedId) { setDetail(null); setDetailLoading(false); return; }
    const owner = account.user.id, sequence = ++detailSequence.current;
    setDetail(null); setDetailLoading(true);
    try {
      const data = await getAdminSalon(selectedId);
      if (identity.current === owner && sequence === detailSequence.current) setDetail(data);
    } catch (failure) { if (identity.current === owner && sequence === detailSequence.current) setError(managementError(failure).userMessage); }
    finally { if (identity.current === owner && sequence === detailSequence.current) setDetailLoading(false); }
  }, [allowed, account.user?.id, selectedId]);

  useEffect(() => { refresh(); return () => { loadSequence.current++; }; }, [refresh]);
  useEffect(() => { refreshDetail(); return () => { detailSequence.current++; }; }, [refreshDetail]);
  useEffect(() => { setOverview(null); setSalons([]); setPlan(null); setSelectedId(''); setDetail(null); setPaymentCharge(null); setNotice(''); setError(''); setBusy(false); }, [account.user?.id, allowed]);

  async function mutate(work, message) {
    if (!allowed || busy) return;
    const owner = account.user.id; setBusy(true); setError(''); setNotice('');
    try {
      await work();
      if (identity.current !== owner) return;
      await Promise.all([refresh(), selectedId ? refreshDetail() : Promise.resolve()]);
      if (identity.current === owner) { setNotice(message); setPaymentCharge(null); }
    } catch (failure) { if (identity.current === owner) setError(managementError(failure).userMessage); }
    finally { if (identity.current === owner) setBusy(false); }
  }

  async function copyGuide(audience) {
    setError(''); setCopiedGuide('');
    try { await navigator.clipboard.writeText(tutorialShareUrl(audience)); setCopiedGuide(audience); }
    catch { setError(t("Η αντιγραφή δεν ήταν δυνατή. Επιλέξτε τον σύνδεσμο παρακάτω και αντιγράψτε τον")); }
  }

  const stats = overview?.stats || {};
  const filteredSalons = salons.filter(salon => !statusFilter || salon.status === statusFilter);
  const daily = overview?.daily || [];
  const dailyMax = Math.max(1, ...daily.map(day => Number(day.bookings || 0)));
  return <div className="en-admin">
    <header className="en-admin-header"><button className="en-admin-back" onClick={onBack}><ArrowLeft size={17} />{t("Ιστότοπος")}</button><Brand onClick={onBack} /><div className="en-admin-language-controls"><span><ShieldCheck size={16} />{t("Διαχείριση")}</span><LanguageSelector /></div></header>
    {!allowed ? <main className="en-admin-access en-admin-card"><ShieldCheck size={32} /><h1>{t("Διαχείριση Eneres")}</h1>{account.loading ? <Busy /> : !account.user ? <><p>{t("Συνδεθείτε με τον λογαριασμό διαχειριστή για να δείτε αιτήματα και συνδρομές")}</p><button className="en-admin-primary" onClick={() => setAuthOpen(true)}>{t("Σύνδεση διαχειριστή")}</button></> : !account.user.email_confirmed_at ? <><p>{t("Επιβεβαιώστε το email σας πριν ανοίξετε τη διαχείριση")}</p><button className="en-admin-primary" onClick={() => setAuthOpen(true)}>{t("Ο λογαριασμός μου")}</button></> : <><p>{t("Αυτός ο λογαριασμός δεν έχει πρόσβαση διαχείρισης")}</p><p className="en-admin-muted">{t("Η πρόσβαση πρέπει πρώτα να ενεργοποιηθεί για τον λογαριασμό σας")}</p><Notice error>{error}</Notice><div className="en-admin-actions"><button className="en-admin-primary" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await refreshAdminAccess(); } catch (failure) { setError(managementError(failure).userMessage); } finally { setBusy(false); } }}>{t("Ανανέωση πρόσβασης")}</button><button className="en-admin-secondary" onClick={() => setAuthOpen(true)}>{t("Ο λογαριασμός μου")}</button></div></>}</main> : <main className="en-admin-layout">
      <div className="en-admin-page-title"><div><span className="en-admin-eyebrow">ENERES BUSINESS</span><h1>{t("Διαχείριση Eneres")}</h1><p>{account.user.email}</p></div><button className="en-admin-secondary" disabled={loading || busy} onClick={() => { refresh(); if (selectedId) refreshDetail(); }}><RefreshCw size={15} />{t("Ανανέωση")}</button></div>
      <nav className="en-admin-tabs" aria-label={t("Ενότητες διαχείρισης")}>{[{ id: 'overview', label: t("Επισκόπηση"), Icon: BarChart3 }, { id: 'requests', label: t("Αιτήματα επιχειρήσεων"), Icon: FileCheck2 }, { id: 'billing', label: t("Μηνιαίες συνδρομές"), Icon: CreditCard }, { id: 'videos', label: t("Βίντεο οδηγιών"), Icon: Video }].map(({ id, label, Icon }) => <button className={tab === id ? 'is-active' : ''} key={id} onClick={() => { setTab(id); setError(''); setNotice(''); }}><Icon size={17} />{t(label)}{id === 'requests' && <span>{salons.filter(salon => salon.status === 'pending').length}</span>}</button>)}</nav>
      <Notice error>{error}</Notice><Notice>{notice}</Notice>
      {tab === 'videos' && <section className="en-admin-guide-grid">{Object.values(tutorialGuides).map(guide => <article key={guide.id} className="en-admin-card"><h2>{t(guide.title)}</h2><p className="en-admin-muted">{t(guide.description)}</p><label className="en-admin-field">{t("Σύνδεσμος βίντεο")}<input readOnly value={tutorialShareUrl(guide.id)} onFocus={event => event.target.select()} aria-label={guide.id === 'client' ? t("Σύνδεσμος οδηγού πελατών") : t("Σύνδεσμος οδηγού επιχειρήσεων")} /></label><div className="en-admin-actions"><button className="en-admin-primary" onClick={() => copyGuide(guide.id)}><Copy size={15} />{guide.id === 'client' ? t("Αντιγραφή συνδέσμου πελατών") : t("Αντιγραφή συνδέσμου επιχειρήσεων")}</button><a className="en-admin-secondary" href={tutorialShareUrl(guide.id)} target="_blank" rel="noreferrer"><Video size={15} />{t("Προβολή βίντεο")}</a></div>{copiedGuide === guide.id && <p className="en-admin-muted" role="status">{t("Ο σύνδεσμος αντιγράφηκε")}</p>}</article>)}</section>}
      {loading && !overview ? <Busy /> : <>
        {tab === 'overview' && <><div className="en-admin-section-heading"><h2>{t("Η εικόνα της πλατφόρμας")}</h2><Field label={t("Περίοδος στατιστικών")}><select value={days} onChange={event => setDays(Number(event.target.value))}><option value={7}>{t("Τελευταίες 7 ημέρες")}</option><option value={30}>{t("Τελευταίες 30 ημέρες")}</option><option value={90}>{t("Τελευταίες 90 ημέρες")}</option></select></Field></div><div className="en-admin-stats">{[
          [t("Επιχειρήσεις"), number(stats.salons), Store], [t("Αιτήματα σε έλεγχο"), number(stats.pending_salons), FileCheck2], [t("Δημοσιευμένοι χώροι"), number(stats.published_salons), CheckCircle2], [t("Ιδιοκτήτες"), number(stats.owners), Users],
          [t("Ραντεβού περιόδου"), number(stats.bookings), CalendarDays], [t("Ολοκληρωμένα ραντεβού"), number(stats.completed_bookings), CheckCircle2], [t("Επιβεβαιωμένα ραντεβού"), number(stats.confirmed_bookings), CalendarDays], [t("Ακυρωμένα ραντεβού"), number(stats.cancelled_bookings), X], [t("Εισπράξεις υπηρεσιών"), currency(stats.service_revenue_cents), Euro], [t("Ενεργές συνδρομές"), number(salons.filter(salon => salon.subscription?.status === 'active').length), CreditCard], [t("Εισπράξεις συνδρομών"), currency(stats.subscription_revenue_cents), Euro], [t("Εκκρεμείς χρεώσεις"), currency(stats.outstanding_charges_cents), CreditCard],
        ].map(([label, value, Icon]) => <section className="en-admin-stat" key={label}><Icon size={19} /><span>{t(label)}<strong>{value}</strong></span></section>)}</div><section className="en-admin-card"><h2>{t("Ραντεβού ανά ημέρα")}</h2>{daily.length ? <div className="en-admin-chart" role="list" aria-label={t("Ημερήσια στατιστικά ραντεβού")}>{daily.map(day => <div role="listitem" className="en-admin-chart-day" key={day.date} title={t("{date}: {count} ραντεβού", { date: displayDate(day.date), count: number(day.bookings) })}><strong>{number(day.bookings)}</strong><span className="en-admin-chart-track"><i style={{ height: `${Math.max(Number(day.bookings) ? 5 : 0, Number(day.bookings || 0) / dailyMax * 100)}%` }} /></span><small>{new Date(`${day.date}T12:00:00Z`).toLocaleDateString(getLocale(), { day: 'numeric', month: 'numeric' })}</small></div>)}</div> : <p className="en-admin-muted">{t("Δεν υπάρχουν ραντεβού στην επιλεγμένη περίοδο")}</p>}</section></>}
        {tab === 'requests' && <div className="en-admin-review-grid"><section className="en-admin-card"><div className="en-admin-card-heading"><h2>{t("Επιχειρήσεις")}</h2><Field label={t("Κατάσταση επιχειρήσεων")}><select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="pending">{t("Σε έλεγχο")}</option><option value="published">{t("Δημοσιευμένες")}</option><option value="rejected">{t("Χρειάζονται αλλαγές")}</option><option value="draft">{t("Πρόχειρες")}</option><option value="">{t("Όλες")}</option></select></Field></div><div className="en-admin-salon-list">{filteredSalons.map(salon => <button key={salon.id} className={selectedId === salon.id ? 'is-selected' : ''} aria-label={t("Έλεγχος {name}", { name: salon.name })} onClick={() => { setSelectedId(salon.id); setError(''); setNotice(''); }}><strong>{salon.name}</strong><span>{[t(salon.city), t(salon.country)].join(', ')}</span><small>{salon.owner_email}</small><span className={`en-admin-pill en-admin-pill-${salon.status}`}>{t(salonStatus[salon.status] || salon.status)}</span></button>)}</div>{!filteredSalons.length && <p className="en-admin-muted">{t("Δεν υπάρχουν επιχειρήσεις σε αυτή την κατηγορία")}</p>}</section>{detailLoading ? <section className="en-admin-card"><Busy /></section> : detail ? <ReviewPanel key={detail.salon.id} detail={detail} busy={busy} onReview={(id, decision, note) => mutate(() => reviewSalon(id, decision, note), decision === 'published' ? t("Η επιχείρηση εγκρίθηκε και εμφανίζεται στον ιστότοπο") : t("Το αίτημα ενημερώθηκε με τις απαραίτητες αλλαγές"))} /> : <section className="en-admin-card en-admin-selection"><FileCheck2 size={30} /><p>{t("Επιλέξτε μια επιχείρηση για να ελέγξετε το αίτημά της")}</p></section>}</div>}
        {tab === 'billing' && <><div className="en-admin-billing-grid"><PlanForm key={JSON.stringify(plan)} plan={plan} busy={busy} onSave={(price, enabled) => mutate(() => setPlatformBilling(price, enabled), t("Η μηνιαία τιμή ενημερώθηκε"))} /><section className="en-admin-card"><h2>{t("Χρεώσεις επιχειρήσεων")}</h2><p className="en-admin-muted">{t("Επιλέξτε επιχείρηση για τη συνδρομή και τις μηνιαίες χρεώσεις της")}</p><Field label={t("Επιχείρηση για χρέωση")}><select value={selectedId} onChange={event => { setSelectedId(event.target.value); setError(''); setNotice(''); }}><option value="">{t("Επιλέξτε επιχείρηση")}</option>{salons.map(salon => <option key={salon.id} value={salon.id}>{salon.name} · {t(salon.city)}</option>)}</select></Field><p className="en-admin-muted">{t("Οι πληρωμές των πελατών για υπηρεσίες γίνονται απευθείας στο κατάστημα και είναι ξεχωριστές από τη συνδρομή Eneres")}</p></section></div>{detailLoading ? <Busy /> : detail && <><BusinessChargeForm key={JSON.stringify([detail.salon.id, detail.subscription])} detail={detail} plan={plan} busy={busy} onSubscription={(id, price, status) => mutate(() => setBusinessSubscription(id, price, status), t("Η συνδρομή ενημερώθηκε"))} onCreateCharge={entry => mutate(() => createBusinessCharge(entry), t("Η μηνιαία χρέωση καταχωρίστηκε"))} /><section className="en-admin-card"><h2>{t("Ιστορικό χρεώσεων")}</h2><div className="en-admin-charges">{(detail.charges || []).map(charge => <article key={charge.id}><div><strong>{currency(charge.amount_cents)}</strong><span>{displayDate(charge.period_start)} – {displayDate(addDay(String(charge.period_end).slice(0, 10), -1))}</span><small>{t("Πληρωτέα έως")} {displayDate(charge.due_date)}</small>{charge.external_reference && <small>{charge.external_reference}</small>}</div><span className={`en-admin-pill en-admin-pill-${charge.status}`}>{t(chargeStatus[charge.status] || charge.status)}</span>{charge.status === 'pending' && charge.payment_provider !== 'stripe' && <div className="en-admin-actions"><button disabled={busy} className="en-admin-secondary" onClick={() => setPaymentCharge(charge)}>{t("Καταχώριση εξόφλησης")}</button><button disabled={busy} className="en-admin-text-button" onClick={() => mutate(() => setChargeStatus(charge.id, 'void'), t("Η χρέωση ακυρώθηκε"))}>{t("Ακύρωση χρέωσης")}</button></div>}</article>)}</div>{!detail.charges?.length && <p className="en-admin-muted">{t("Δεν έχουν καταχωριστεί χρεώσεις")}</p>}</section></>}</>}
      </>}
    </main>}
    {authOpen && <AccountPanel onClose={() => setAuthOpen(false)} />}
    {allowed && paymentCharge && <PaymentConfirmation charge={paymentCharge} busy={busy} onClose={() => setPaymentCharge(null)} onConfirm={(id, reference) => mutate(() => setChargeStatus(id, 'paid', reference), t("Η εξόφληση καταχωρίστηκε"))} />}
  </div>;
}
