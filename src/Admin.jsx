import { formatEuroCents } from './lib/currency';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, BarChart3, CalendarDays, CheckCircle2, Copy, CreditCard, Euro, FileCheck2, LoaderCircle, RefreshCw, ShieldCheck, Store, Users, Video, X } from 'lucide-react';
import Brand from './Brand';
import { AccountPanel, useAccount } from './Account';
import { createBusinessCharge, getAdminOverview, getAdminSalon, getAdminSalons, getPlatformBilling, managementError, refreshAdminAccess, reviewSalon, setBusinessSubscription, setChargeStatus, setPlatformBilling } from './lib/admin';
import './admin.css';
import { tutorialGuides, tutorialShareUrl } from './lib/tutorials';

const currency = cents => cents == null ? 'Δεν έχει οριστεί' : formatEuroCents(cents);
const number = value => value == null ? '—' : new Intl.NumberFormat('el-GR').format(Number(value));
const displayDate = value => value ? new Date(String(value).length === 10 ? `${value}T12:00:00Z` : value).toLocaleDateString('el-GR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const addDay = (value, amount) => { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10); };
const today = () => new Date().toISOString().slice(0, 10);
const priceInput = cents => cents == null ? '' : (Number(cents) / 100).toFixed(2);
const centsInput = value => String(value).trim() === '' ? null : Math.round(Number(String(value).replace(',', '.')) * 100);
const salonStatus = { draft: 'Πρόχειρη', pending: 'Σε έλεγχο', published: 'Δημοσιευμένη', rejected: 'Χρειάζεται αλλαγές', suspended: 'Σε αναστολή' };
const subscriptionStatus = { pending: 'Σε αναμονή', active: 'Ενεργή', past_due: 'Εκκρεμεί πληρωμή', cancelled: 'Ακυρωμένη' };
const chargeStatus = { pending: 'Σε εκκρεμότητα', paid: 'Εξοφλημένη', void: 'Ακυρωμένη' };
const weekdays = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];

function Busy({ children = 'Φόρτωση…' }) { return <span className="en-admin-busy" role="status"><LoaderCircle size={17} />{children}</span>; }
function Notice({ children, error = false }) { return children ? <p className={`en-admin-notice${error ? ' en-admin-error' : ''}`} role={error ? 'alert' : 'status'}>{children}</p> : null; }
function Field({ label, children }) { return <label className="en-admin-field"><span>{label}</span>{children}</label>; }

function ReviewPanel({ detail, busy, onReview }) {
  const [note, setNote] = useState('');
  const [validation, setValidation] = useState('');
  const salon = detail.salon;
  const staffById = Object.fromEntries((detail.staff || []).map(person => [person.id, person.name]));
  function review(decision) {
    if (decision === 'rejected' && note.trim().length < 3) { setValidation('Γράψτε τι χρειάζεται να αλλάξει η επιχείρηση'); return; }
    setValidation(''); onReview(salon.id, decision, note);
  }
  return <section className="en-admin-card en-admin-review" aria-label={`Έλεγχος ${salon.name}`}>
    <div className="en-admin-card-heading"><div><span className="en-admin-eyebrow">ΣΤΟΙΧΕΙΑ ΕΠΙΧΕΙΡΗΣΗΣ</span><h2>{salon.name}</h2></div><span className={`en-admin-pill en-admin-pill-${salon.status}`}>{salonStatus[salon.status] || salon.status}</span></div>
    <p className="en-admin-muted">{[salon.address, salon.city, salon.country].filter(Boolean).join(', ')}</p>
    {salon.description && <p className="en-admin-description">{salon.description}</p>}
    <dl className="en-admin-info"><div><dt>Ιδιοκτήτης</dt><dd>{detail.owner?.full_name || detail.owner?.name || 'Δεν έχει συμπληρωθεί'}</dd></div><div><dt>Email ιδιοκτήτη</dt><dd>{detail.owner?.email || '—'}</dd></div><div><dt>Επιβεβαίωση email</dt><dd>{detail.owner?.confirmed ? 'Επιβεβαιωμένο' : 'Σε αναμονή'}</dd></div><div><dt>Πολιτική ακύρωσης</dt><dd>{salon.cancellation_hours} ώρες πριν</dd></div></dl>
    <h3>Υπηρεσίες</h3>
    <ul className="en-admin-detail-list">{(detail.services || []).map(service => <li key={service.id}><span>{service.name}{service.active === false && <small>Ανενεργή</small>}</span><span>{service.duration_minutes}′ · {currency(service.price_cents)}</span></li>)}</ul>
    {!detail.services?.length && <p className="en-admin-muted">Δεν έχουν προστεθεί υπηρεσίες</p>}
    <h3>Ομάδα και ωράριο</h3>
    <ul className="en-admin-detail-list">{(detail.staff || []).map(person => <li key={person.id}><span>{person.name}</span><span>{person.active ? 'Ενεργός επαγγελματίας' : 'Ανενεργός'}</span></li>)}</ul>
    <ul className="en-admin-hours">{(detail.hours || []).map((hours, index) => <li key={hours.id || index}>{staffById[hours.staff_id] || 'Επαγγελματίας'} · {weekdays[hours.weekday]} · {String(hours.opens_at).slice(0, 5)}–{String(hours.closes_at).slice(0, 5)}</li>)}</ul>
    {salon.status === 'pending' ? <><Field label="Σημείωση ελέγχου"><textarea rows={3} value={note} maxLength={2000} onChange={event => setNote(event.target.value)} placeholder="Πληροφορίες για την έγκριση ή τις απαραίτητες αλλαγές" /></Field><Notice error>{validation}</Notice><div className="en-admin-actions"><button className="en-admin-primary" disabled={busy} onClick={() => review('published')}><CheckCircle2 size={16} />Έγκριση επιχείρησης</button><button className="en-admin-secondary" disabled={busy} onClick={() => review('rejected')}>Απόρριψη αιτήματος</button></div></> : <p className="en-admin-muted">Δεν υπάρχει εκκρεμές αίτημα για αυτή την επιχείρηση</p>}
    {!!detail.reviews?.length && <details className="en-admin-audit"><summary>Ιστορικό ελέγχων</summary>{detail.reviews.map((entry, index) => <p key={entry.id || index}><strong>{salonStatus[entry.decision] || entry.decision}</strong> · {displayDate(entry.created_at)}{entry.note && <span>{entry.note}</span>}</p>)}</details>}
  </section>;
}

function PlanForm({ plan, busy, onSave }) {
  const [price, setPrice] = useState(priceInput(plan?.monthly_price_cents));
  const [enabled, setEnabled] = useState(Boolean(plan?.enabled));
  const [validation, setValidation] = useState('');
  async function submit(event) {
    event.preventDefault();
    const amount = centsInput(price);
    if ((amount != null && (!Number.isInteger(amount) || amount < 1 || amount > 1000000)) || (enabled && amount == null)) { setValidation('Ορίστε έγκυρη μηνιαία τιμή για την ενεργή συνδρομή'); return; }
    setValidation(''); await onSave(amount, enabled);
  }
  return <form className="en-admin-card en-admin-form" onSubmit={submit}><div className="en-admin-card-heading"><div><span className="en-admin-eyebrow">ΜΗΝΙΑΙΑ ΣΥΝΔΡΟΜΗ</span><h2>Τιμή χρήσης της πλατφόρμας</h2></div><CreditCard size={22} /></div><Field label="Μηνιαία συνδρομή (€)"><input type="number" min="0.01" max="10000" step="0.01" value={price} onChange={event => setPrice(event.target.value)} placeholder="Ορίστε την τιμή σας" /></Field><label className="en-admin-checkbox"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />Ενεργή μηνιαία συνδρομή</label><p className="en-admin-muted">Η τιμή ορίζεται από εσάς και δεν δημιουργεί αυτόματα χρέωση ή πληρωμή</p><Notice error>{validation}</Notice><button className="en-admin-primary" disabled={busy} type="submit">Αποθήκευση τιμής</button></form>;
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
    if (value != null && (!Number.isInteger(value) || value < 1 || value > 1000000)) { setValidation('Ελέγξτε τη μηνιαία τιμή'); return; }
    if (stripeManaged) return;
    setValidation(''); await onSubscription(detail.salon.id, value, status);
  }
  async function createCharge(event) {
    event.preventDefault(); const value = centsInput(amount);
    if (!start || !end || end < start || value == null || !Number.isInteger(value) || value < 1 || value > 1000000) { setValidation('Συμπληρώστε έγκυρη περίοδο και ποσό'); return; }
    if (stripeManaged) return;
    setValidation(''); await onCreateCharge({ salonId: detail.salon.id, periodStart: start, periodEnd: addDay(end, 1), amountCents: value, dueDate: due || null });
  }
  return <section className="en-admin-card"><div className="en-admin-card-heading"><div><h2>{detail.salon.name}</h2><p className="en-admin-muted">{[detail.salon.city, detail.salon.country].join(', ')}</p></div><span className="en-admin-pill">{subscriptionStatus[current?.status] || 'Χωρίς συνδρομή'}</span></div><form className="en-admin-form" onSubmit={saveSubscription}><h3>Συνδρομή επιχείρησης</h3><div className="en-admin-form-grid"><Field label="Ειδική μηνιαία τιμή (€)"><input type="number" disabled={stripeManaged} min="0.01" max="10000" step="0.01" value={subscriptionPrice} onChange={event => setSubscriptionPrice(event.target.value)} placeholder="Προεπιλεγμένη τιμή" /></Field><Field label="Κατάσταση συνδρομής"><select disabled={stripeManaged} value={status} onChange={event => setStatus(event.target.value)}>{Object.entries(subscriptionStatus).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field></div><button className="en-admin-secondary" disabled={busy || stripeManaged} type="submit">Αποθήκευση συνδρομής</button>{stripeManaged && <p className="en-admin-muted">Η συνδρομή με κάρτα ενημερώνεται αυτόματα από το περιβάλλον πληρωμών</p>}</form><form className="en-admin-form en-admin-charge-form" onSubmit={createCharge}><h3>Νέα μηνιαία χρέωση</h3><div className="en-admin-form-grid"><Field label="Περίοδος από"><input type="date" required value={start} onChange={event => setStart(event.target.value)} /></Field><Field label="Περίοδος έως"><input type="date" required min={start} value={end} onChange={event => setEnd(event.target.value)} /></Field><Field label="Ποσό χρέωσης (€)"><input type="number" min="0.01" max="10000" step="0.01" required value={amount} onChange={event => setAmount(event.target.value)} /></Field><Field label="Πληρωτέα έως"><input type="date" value={due} onChange={event => setDue(event.target.value)} /></Field></div><p className="en-admin-muted">Η καταχώριση δημιουργεί εκκρεμή χρέωση και δεν τραβά χρήματα από κάρτα</p><Notice error>{validation}</Notice><button type="submit" className="en-admin-primary" disabled={busy || stripeManaged}>Δημιουργία μηνιαίας χρέωσης</button></form></section>;
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
  return <div className="en-admin-modal-backdrop"><section className="en-admin-card en-admin-modal" ref={ref} role="dialog" aria-modal="true" aria-labelledby="admin-payment-title"><button className="en-admin-modal-close" onClick={onClose} aria-label="Κλείσιμο εξόφλησης" disabled={busy}><X size={20} /></button><h2 id="admin-payment-title">Καταχώριση εξόφλησης</h2><p>Επιβεβαιώνετε ότι έχει ήδη εισπραχθεί το ποσό {currency(charge.amount_cents)}</p><Field label="Αναφορά πληρωμής"><input maxLength={200} value={reference} onChange={event => setReference(event.target.value)} placeholder="Προαιρετικός αριθμός κατάθεσης ή σημείωση" /></Field><div className="en-admin-actions"><button className="en-admin-secondary" onClick={onClose} disabled={busy}>Επιστροφή</button><button className="en-admin-primary" disabled={busy} onClick={() => onConfirm(charge.id, reference)}>Επιβεβαίωση εξόφλησης</button></div></section></div>;
}

export default function Admin({ onBack }) {
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
    catch { setError('Η αντιγραφή δεν ήταν δυνατή. Επιλέξτε τον σύνδεσμο παρακάτω και αντιγράψτε τον'); }
  }

  const stats = overview?.stats || {};
  const filteredSalons = salons.filter(salon => !statusFilter || salon.status === statusFilter);
  const daily = overview?.daily || [];
  const dailyMax = Math.max(1, ...daily.map(day => Number(day.bookings || 0)));
  return <div className="en-admin">
    <header className="en-admin-header"><button className="en-admin-back" onClick={onBack}><ArrowLeft size={17} />Ιστότοπος</button><Brand onClick={onBack} /><span><ShieldCheck size={16} />Διαχείριση</span></header>
    {!allowed ? <main className="en-admin-access en-admin-card"><ShieldCheck size={32} /><h1>Διαχείριση Eneres</h1>{account.loading ? <Busy /> : !account.user ? <><p>Συνδεθείτε με τον λογαριασμό διαχειριστή για να δείτε αιτήματα και συνδρομές</p><button className="en-admin-primary" onClick={() => setAuthOpen(true)}>Σύνδεση διαχειριστή</button></> : !account.user.email_confirmed_at ? <><p>Επιβεβαιώστε το email σας πριν ανοίξετε τη διαχείριση</p><button className="en-admin-primary" onClick={() => setAuthOpen(true)}>Ο λογαριασμός μου</button></> : <><p>Αυτός ο λογαριασμός δεν έχει πρόσβαση διαχείρισης</p><p className="en-admin-muted">Η πρόσβαση πρέπει πρώτα να ενεργοποιηθεί για τον λογαριασμό σας</p><Notice error>{error}</Notice><div className="en-admin-actions"><button className="en-admin-primary" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await refreshAdminAccess(); } catch (failure) { setError(managementError(failure).userMessage); } finally { setBusy(false); } }}>Ανανέωση πρόσβασης</button><button className="en-admin-secondary" onClick={() => setAuthOpen(true)}>Ο λογαριασμός μου</button></div></>}</main> : <main className="en-admin-layout">
      <div className="en-admin-page-title"><div><span className="en-admin-eyebrow">ENERES BUSINESS</span><h1>Διαχείριση Eneres</h1><p>{account.user.email}</p></div><button className="en-admin-secondary" disabled={loading || busy} onClick={() => { refresh(); if (selectedId) refreshDetail(); }}><RefreshCw size={15} />Ανανέωση</button></div>
      <nav className="en-admin-tabs" aria-label="Ενότητες διαχείρισης">{[{ id: 'overview', label: 'Επισκόπηση', Icon: BarChart3 }, { id: 'requests', label: 'Αιτήματα επιχειρήσεων', Icon: FileCheck2 }, { id: 'billing', label: 'Μηνιαίες συνδρομές', Icon: CreditCard }, { id: 'videos', label: 'Βίντεο οδηγιών', Icon: Video }].map(({ id, label, Icon }) => <button className={tab === id ? 'is-active' : ''} key={id} onClick={() => { setTab(id); setError(''); setNotice(''); }}><Icon size={17} />{label}{id === 'requests' && <span>{salons.filter(salon => salon.status === 'pending').length}</span>}</button>)}</nav>
      <Notice error>{error}</Notice><Notice>{notice}</Notice>
      {tab === 'videos' && <section className="en-admin-guide-grid">{Object.values(tutorialGuides).map(guide => <article key={guide.id} className="en-admin-card"><h2>{guide.title}</h2><p className="en-admin-muted">{guide.description}</p><label className="en-admin-field">Σύνδεσμος βίντεο<input readOnly value={tutorialShareUrl(guide.id)} onFocus={event => event.target.select()} aria-label={guide.id === 'client' ? 'Σύνδεσμος οδηγού πελατών' : 'Σύνδεσμος οδηγού επιχειρήσεων'} /></label><div className="en-admin-actions"><button className="en-admin-primary" onClick={() => copyGuide(guide.id)}><Copy size={15} />{guide.id === 'client' ? 'Αντιγραφή συνδέσμου πελατών' : 'Αντιγραφή συνδέσμου επιχειρήσεων'}</button><a className="en-admin-secondary" href={tutorialShareUrl(guide.id)} target="_blank" rel="noreferrer"><Video size={15} />Προβολή βίντεο</a></div>{copiedGuide === guide.id && <p className="en-admin-muted" role="status">Ο σύνδεσμος αντιγράφηκε</p>}</article>)}</section>}
      {loading && !overview ? <Busy /> : <>
        {tab === 'overview' && <><div className="en-admin-section-heading"><h2>Η εικόνα της πλατφόρμας</h2><Field label="Περίοδος στατιστικών"><select value={days} onChange={event => setDays(Number(event.target.value))}><option value={7}>Τελευταίες 7 ημέρες</option><option value={30}>Τελευταίες 30 ημέρες</option><option value={90}>Τελευταίες 90 ημέρες</option></select></Field></div><div className="en-admin-stats">{[
          ['Επιχειρήσεις', number(stats.salons), Store], ['Αιτήματα σε έλεγχο', number(stats.pending_salons), FileCheck2], ['Δημοσιευμένοι χώροι', number(stats.published_salons), CheckCircle2], ['Ιδιοκτήτες', number(stats.owners), Users],
          ['Ραντεβού περιόδου', number(stats.bookings), CalendarDays], ['Ολοκληρωμένα ραντεβού', number(stats.completed_bookings), CheckCircle2], ['Επιβεβαιωμένα ραντεβού', number(stats.confirmed_bookings), CalendarDays], ['Ακυρωμένα ραντεβού', number(stats.cancelled_bookings), X], ['Εισπράξεις υπηρεσιών', currency(stats.service_revenue_cents), Euro], ['Ενεργές συνδρομές', number(salons.filter(salon => salon.subscription?.status === 'active').length), CreditCard], ['Εισπράξεις συνδρομών', currency(stats.subscription_revenue_cents), Euro], ['Εκκρεμείς χρεώσεις', currency(stats.outstanding_charges_cents), CreditCard],
        ].map(([label, value, Icon]) => <section className="en-admin-stat" key={label}><Icon size={19} /><span>{label}<strong>{value}</strong></span></section>)}</div><section className="en-admin-card"><h2>Ραντεβού ανά ημέρα</h2>{daily.length ? <div className="en-admin-chart" role="list" aria-label="Ημερήσια στατιστικά ραντεβού">{daily.map(day => <div role="listitem" className="en-admin-chart-day" key={day.date} title={`${displayDate(day.date)}: ${number(day.bookings)} ραντεβού`}><strong>{number(day.bookings)}</strong><span className="en-admin-chart-track"><i style={{ height: `${Math.max(Number(day.bookings) ? 5 : 0, Number(day.bookings || 0) / dailyMax * 100)}%` }} /></span><small>{new Date(`${day.date}T12:00:00Z`).toLocaleDateString('el-GR', { day: 'numeric', month: 'numeric' })}</small></div>)}</div> : <p className="en-admin-muted">Δεν υπάρχουν ραντεβού στην επιλεγμένη περίοδο</p>}</section></>}
        {tab === 'requests' && <div className="en-admin-review-grid"><section className="en-admin-card"><div className="en-admin-card-heading"><h2>Επιχειρήσεις</h2><Field label="Κατάσταση επιχειρήσεων"><select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="pending">Σε έλεγχο</option><option value="published">Δημοσιευμένες</option><option value="rejected">Χρειάζονται αλλαγές</option><option value="draft">Πρόχειρες</option><option value="">Όλες</option></select></Field></div><div className="en-admin-salon-list">{filteredSalons.map(salon => <button key={salon.id} className={selectedId === salon.id ? 'is-selected' : ''} aria-label={`Έλεγχος ${salon.name}`} onClick={() => { setSelectedId(salon.id); setError(''); setNotice(''); }}><strong>{salon.name}</strong><span>{[salon.city, salon.country].join(', ')}</span><small>{salon.owner_email}</small><span className={`en-admin-pill en-admin-pill-${salon.status}`}>{salonStatus[salon.status] || salon.status}</span></button>)}</div>{!filteredSalons.length && <p className="en-admin-muted">Δεν υπάρχουν επιχειρήσεις σε αυτή την κατηγορία</p>}</section>{detailLoading ? <section className="en-admin-card"><Busy /></section> : detail ? <ReviewPanel key={detail.salon.id} detail={detail} busy={busy} onReview={(id, decision, note) => mutate(() => reviewSalon(id, decision, note), decision === 'published' ? 'Η επιχείρηση εγκρίθηκε και εμφανίζεται στον ιστότοπο' : 'Το αίτημα ενημερώθηκε με τις απαραίτητες αλλαγές')} /> : <section className="en-admin-card en-admin-selection"><FileCheck2 size={30} /><p>Επιλέξτε μια επιχείρηση για να ελέγξετε το αίτημά της</p></section>}</div>}
        {tab === 'billing' && <><div className="en-admin-billing-grid"><PlanForm key={JSON.stringify(plan)} plan={plan} busy={busy} onSave={(price, enabled) => mutate(() => setPlatformBilling(price, enabled), 'Η μηνιαία τιμή ενημερώθηκε')} /><section className="en-admin-card"><h2>Χρεώσεις επιχειρήσεων</h2><p className="en-admin-muted">Επιλέξτε επιχείρηση για τη συνδρομή και τις μηνιαίες χρεώσεις της</p><Field label="Επιχείρηση για χρέωση"><select value={selectedId} onChange={event => { setSelectedId(event.target.value); setError(''); setNotice(''); }}><option value="">Επιλέξτε επιχείρηση</option>{salons.map(salon => <option key={salon.id} value={salon.id}>{salon.name} · {salon.city}</option>)}</select></Field><p className="en-admin-muted">Οι πληρωμές των πελατών για υπηρεσίες γίνονται απευθείας στο κατάστημα και είναι ξεχωριστές από τη συνδρομή Eneres</p></section></div>{detailLoading ? <Busy /> : detail && <><BusinessChargeForm key={JSON.stringify([detail.salon.id, detail.subscription])} detail={detail} plan={plan} busy={busy} onSubscription={(id, price, status) => mutate(() => setBusinessSubscription(id, price, status), 'Η συνδρομή ενημερώθηκε')} onCreateCharge={entry => mutate(() => createBusinessCharge(entry), 'Η μηνιαία χρέωση καταχωρίστηκε')} /><section className="en-admin-card"><h2>Ιστορικό χρεώσεων</h2><div className="en-admin-charges">{(detail.charges || []).map(charge => <article key={charge.id}><div><strong>{currency(charge.amount_cents)}</strong><span>{displayDate(charge.period_start)} – {displayDate(addDay(String(charge.period_end).slice(0, 10), -1))}</span><small>Πληρωτέα έως {displayDate(charge.due_date)}</small>{charge.external_reference && <small>{charge.external_reference}</small>}</div><span className={`en-admin-pill en-admin-pill-${charge.status}`}>{chargeStatus[charge.status] || charge.status}</span>{charge.status === 'pending' && charge.payment_provider !== 'stripe' && <div className="en-admin-actions"><button disabled={busy} className="en-admin-secondary" onClick={() => setPaymentCharge(charge)}>Καταχώριση εξόφλησης</button><button disabled={busy} className="en-admin-text-button" onClick={() => mutate(() => setChargeStatus(charge.id, 'void'), 'Η χρέωση ακυρώθηκε')}>Ακύρωση χρέωσης</button></div>}</article>)}</div>{!detail.charges?.length && <p className="en-admin-muted">Δεν έχουν καταχωριστεί χρεώσεις</p>}</section></>}</>}
      </>}
    </main>}
    {authOpen && <AccountPanel onClose={() => setAuthOpen(false)} />}
    {allowed && paymentCharge && <PaymentConfirmation charge={paymentCharge} busy={busy} onClose={() => setPaymentCharge(null)} onConfirm={(id, reference) => mutate(() => setChargeStatus(id, 'paid', reference), 'Η εξόφληση καταχωρίστηκε')} />}
  </div>;
}
