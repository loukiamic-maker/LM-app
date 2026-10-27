import { t, getLocale } from './i18n';
import LanguageSelector, { useLanguage } from './Language';
import { formatEuro } from './lib/currency';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock3, LoaderCircle, Mail, MapPin, Phone, RefreshCw, Scissors, ShieldCheck, Store, UserRound, X } from 'lucide-react';
import { getSlots } from './lib/platform';
import { lockBodyScroll } from './lib/bodyScrollLock';
import { AccountPanel, useAccount } from './Account';
import { cleanPhone, isValidMobilePhone } from './lib/phone';
import './booking.css';

const euros = formatEuro;
const isoDate = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return ['year', 'month', 'day'].map((type) => parts.find((part) => part.type === type).value).join('-');
};
const addDays = (value, count) => {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
};
const validDate = (value, min, max) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value && value >= min && value <= max;
const formatDate = (date, timeZone, options = { weekday: 'long', day: 'numeric', month: 'long' }) => new Intl.DateTimeFormat(getLocale(), { timeZone, ...options }).format(new Date(`${date}T12:00:00Z`));
const userMessage = (error, fallback) => error?.userMessage || error?.message || fallback;
const slotKey = (slot) => `${slot.staffId}:${slot.startsAt}`;
const isConflict = (error) => ['23P01', '23505', '409'].includes(String(error?.code)) || /overlap|conflict|unavailable|not available|slot.*taken|διαθέσι|σύγκρουση|ήδη.*κρατη|καταληφθ/i.test(`${error?.message || ''} ${error?.userMessage || ''}`);

export default function LiveBooking({ salon, onClose, onConfirm, initialDate, onRequireAuth }) {
  useLanguage();
  const { user, profile, loading: profileLoading, authRequirementsLoading, requiresPhoneVerification, phoneVerified, authRequirementsError } = useAccount();
  const accountLoading = profileLoading || authRequirementsLoading;
  const timeZone = salon.timezone || (salon.country === 'Κύπρος' ? 'Europe/Nicosia' : 'Europe/Athens');
  const today = isoDate(new Date(), timeZone);
  const lastDate = addDays(today, 89);
  const firstDate = validDate(initialDate, today, lastDate) ? initialDate : addDays(today, 1);
  const services = useMemo(() => (salon.services || []).filter((entry) => entry.id && entry.active !== false), [salon.services]);
  const staffMembers = useMemo(() => (salon.staff || []).filter((entry) => entry.id && entry.active !== false), [salon.staff]);
  const cancellationHours = Number.isFinite(Number(salon.cancellationHours)) && Number(salon.cancellationHours) >= 0 ? Number(salon.cancellationHours) : 24;
  const [step, setStep] = useState(1);
  const [service, setService] = useState(null);
  const [staffChoice, setStaffChoice] = useState('');
  const [date, setDate] = useState(firstDate);
  const [rangeStart, setRangeStart] = useState(firstDate);
  const [slots, setSlots] = useState([]);
  const [slot, setSlot] = useState(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState('');
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [name, setName] = useState(profile?.name || '');
  const [nameEdited, setNameEdited] = useState(false);
  const phone = cleanPhone(profile?.mobilePhone || '');
  const phoneValid = isValidMobilePhone(phone);
  const [editingAccount, setEditingAccount] = useState(false);
  const [notes, setNotes] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(null);
  const dialog = useRef(null);
  const closeButton = useRef(null);
  const profileSettingsButton = useRef(null);
  const editingAccountRef = useRef(false);
  const settingsWereOpen = useRef(false);
  editingAccountRef.current = editingAccount;
  const closeRef = useRef(onClose);
  const mounted = useRef(false);
  const submitting = useRef(false);
  const requestId = useRef(null);
  const contactOwner = useRef(user?.id || null);
  const contactRevision = useRef(0);
  closeRef.current = onClose;

  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(rangeStart, index)).filter((day) => day >= today && day <= lastDate), [rangeStart, today, lastDate]);
  const visibleSlots = useMemo(() => {
    const unique = new Map();
    for (const value of [...slots].sort((left, right) => left.startsAt.localeCompare(right.startsAt) || left.staffName.localeCompare(right.staffName, getLocale()))) {
      if (!unique.has(value.startsAt)) unique.set(value.startsAt, value);
    }
    return [...unique.values()];
  }, [slots]);
  const verified = Boolean(user?.id && user.email && user.email_confirmed_at);
  const selectedStillAvailable = Boolean(slot && slots.some((value) => slotKey(value) === slotKey(slot)));
  const cancellationNote = cancellationHours === 0
    ? t("Η ακύρωση μέσω Eneres είναι δυνατή πριν από την ώρα έναρξης. Για μεταγενέστερες αλλαγές επικοινωνήστε με το κατάστημα")
    : t("Η ακύρωση μέσω Eneres είναι δυνατή έως {hours} ώρες πριν από την έναρξη. Μετά, επικοινωνήστε με το κατάστημα", {hours: cancellationHours});

  useEffect(() => {
    mounted.current = true;
    const previousFocus = document.activeElement;
    const releaseScroll = lockBodyScroll();
    closeButton.current?.focus();
    const ownKeyboard = () => !Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).some((element) => element !== dialog.current && element.getClientRects().length > 0);
    const handleKey = (event) => {
      // The account panel can open above this dialog without losing the selected appointment.
      if (editingAccountRef.current || !dialog.current || !ownKeyboard()) return;
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialog.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]') || []).filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.current.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && (document.activeElement === last || !dialog.current.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      mounted.current = false;
      releaseScroll();
      document.removeEventListener('keydown', handleKey);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    const owner = user?.id || null;
    if (contactOwner.current === owner) return;
    contactOwner.current = owner; contactRevision.current++;
    setName(''); setNotes(''); setNameEdited(false); setEditingAccount(false);
    setAcknowledged(false); setConfirmed(null); setError(''); setSaving(false); submitting.current = false;
  }, [user?.id]);

  useEffect(() => {
    if (!nameEdited) setName(profile?.name || '');
  }, [profile?.name, nameEdited]);

  useEffect(() => {
    if (settingsWereOpen.current && !editingAccount) profileSettingsButton.current?.focus();
    settingsWereOpen.current = editingAccount;
  }, [editingAccount]);

  useEffect(() => {
    requestId.current = null;
  }, [service?.id, slot?.staffId, slot?.startsAt, user?.id]);

  useEffect(() => {
    let active = true;
    setSlot(null);
    setSlots([]);
    setSlotsError('');
    if (!service?.id || !staffChoice) { setSlotsLoading(false); return undefined; }
    setSlotsLoading(true);
    getSlots(service.id, date, staffChoice === 'any' ? null : staffChoice)
      .then((result) => { if (active) setSlots(Array.isArray(result) ? result : []); })
      .catch((failure) => { if (active) setSlotsError(userMessage(failure, t("Δεν ήταν δυνατή η φόρτωση των διαθέσιμων ωρών. Δοκιμάστε ξανά"))); })
      .finally(() => { if (active) setSlotsLoading(false); });
    return () => { active = false; };
  }, [service?.id, date, staffChoice, refreshIndex]);

  useEffect(() => {
    if (!service?.id || !staffChoice || step < 2 || slotsLoading || confirmed) return undefined;
    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if (!active || refreshing || submitting.current || document.visibilityState === 'hidden') return;
      refreshing = true;
      try {
        const result = await getSlots(service.id, date, staffChoice === 'any' ? null : staffChoice);
        if (!active) return;
        const next = Array.isArray(result) ? result : [];
        setSlots(next); setSlotsError('');
        if (slot && !next.some(value => slotKey(value) === slotKey(slot))) {
          setSlot(null); setStep(2);
          setError(t("Η ώρα δεν είναι πλέον διαθέσιμη. Επιλέξτε μια νέα ώρα"));
        }
      } catch {
        if (!active) return;
        setSlots([]); setSlot(null); setStep(2);
        setSlotsError(t("Η διαθεσιμότητα δεν μπόρεσε να ενημερωθεί. Δοκιμάστε ξανά"));
      } finally { refreshing = false; }
    };
    const interval = setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { active = false; clearInterval(interval); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [service?.id, date, staffChoice, step, slot, slotsLoading, confirmed]);

  const chooseDate = (value) => {
    if (!validDate(value, today, lastDate)) return;
    setDate(value);
    setSlot(null);
    setError('');
    if (!days.includes(value)) setRangeStart(value);
  };
  const requestAccount = () => {
    setError('');
    if (onRequireAuth) onRequireAuth();
    else setError(t("Συνδεθείτε από το προφίλ σας και επιστρέψτε για να ολοκληρώσετε την κράτηση"));
  };
  const complete = async (event) => {
    event.preventDefault();
    if (submitting.current) return;
    if (accountLoading) return;
    if (authRequirementsError) { setError(t("Ανοίξτε το προφίλ σας για νέο έλεγχο του λογαριασμού")); return; }
    if (requiresPhoneVerification && !phoneVerified) { setError(t("Επιβεβαιώστε το κινητό σας με SMS από το προφίλ")); setEditingAccount(true); return; }
    if (!verified) { requestAccount(); return; }
    if (name.trim().length < 2) { setError(t("Συμπληρώστε το όνομά σας με τουλάχιστον δύο χαρακτήρες")); return; }
    if (!phoneValid) { setError(t("Συμπληρώστε έγκυρο κινητό στο προφίλ σας πριν ολοκληρώσετε την κράτηση")); return; }
    if (!acknowledged) { setError(t("Διαβάστε και αποδεχθείτε τις πληροφορίες κράτησης για να συνεχίσετε")); return; }
    if (!service?.id || !selectedStillAvailable) { setError(t("Επιλέξτε ξανά διαθέσιμη ημέρα και ώρα")); setStep(2); return; }
    if (!requestId.current) requestId.current = crypto.randomUUID();
    const payload = { serviceId: service.id, staffId: slot.staffId, startsAt: slot.startsAt, customerName: name.trim(), customerPhone: cleanPhone(phone), notes: notes.trim(), requestId: requestId.current };
    const savingRevision = contactRevision.current;
    submitting.current = true;
    setSaving(true);
    setError('');
    try {
      const booking = await onConfirm(payload);
      if (!booking?.id || booking.status !== 'confirmed') {
        const failure = new Error(t("Δεν λάβαμε επιβεβαιωμένη κράτηση. Ελέγξτε τα ραντεβού σας πριν δοκιμάσετε ξανά"));
        if (booking?.status === 'cancelled') { failure.code = '409'; failure.userMessage = t("Αυτό το αίτημα κράτησης έχει ακυρωθεί. Επιλέξτε ξανά ημέρα και ώρα για νέα κράτηση"); }
        throw failure;
      }
      if (mounted.current && savingRevision === contactRevision.current) setConfirmed(booking);
    } catch (failure) {
      if (!mounted.current || savingRevision !== contactRevision.current) return;
      if (isConflict(failure)) {
        setSlot(null);
        setStep(2);
        setRefreshIndex((value) => value + 1);
        setError(t("Η ώρα που επιλέξατε δεν είναι πλέον διαθέσιμη. Οι διαθέσιμες ώρες ανανεώθηκαν· επιλέξτε μια άλλη"));
      } else {
        // Keep the same idempotency key after an uncertain network response: retrying cannot create a second booking.
        setError(userMessage(failure, t("Η κράτηση δεν ολοκληρώθηκε. Δοκιμάστε ξανά")));
      }
    } finally {
      if (savingRevision === contactRevision.current) {
        submitting.current = false;
        if (mounted.current) setSaving(false);
      }
    }
  };

  if (editingAccount) return <AccountPanel onClose={() => { setEditingAccount(false); setError(''); }} />;

  return <div className="booking-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className={`booking-dialog booking-live ${confirmed ? 'booking-dialog-success' : ''}`} role="dialog" aria-modal="true" aria-labelledby="booking-title" aria-busy={saving}>
      <div className="booking-handle"/>
      <div className="booking-topline">
        {step > 1 && !confirmed ? <button type="button" className="booking-icon-button" aria-label={t("Προηγούμενο βήμα")} disabled={saving} onClick={() => { setError(''); setStep((value) => value - 1); }}><ArrowLeft size={20}/></button> : <span className="booking-brand">{t("Η στιγμή σας")}</span>}
        <LanguageSelector /><button ref={closeButton} type="button" className="booking-icon-button" aria-label={t("Κλείσιμο κράτησης")} onClick={onClose}><X size={20}/></button>
      </div>

      {confirmed ? <div className="booking-success">
        <div className="booking-success-icon"><CheckCircle2 size={38}/></div>
        <span className="booking-eyebrow">{t("Η ΔΙΚΗ ΣΑΣ ΣΤΙΓΜΗ ΦΡΟΝΤΙΔΑΣ")}</span>
        <h2 id="booking-title">{t("Το ραντεβού σας")}<br/>{t("επιβεβαιώθηκε")}</h2>
        <p>{t("Ευχαριστούμε, ")}{confirmed.name}{t("! Η κράτησή σας έχει καταχωριστεί στο ημερολόγιο του καταστήματος")}</p>
        <div className="booking-success-details">
          <strong>{confirmed.salonName || salon.name}</strong><span>{confirmed.service.name}</span>
          <div><CalendarDays size={17}/>{formatDate(confirmed.date, timeZone)} · {confirmed.time}</div>
          <div><UserRound size={17}/>{confirmed.staff}</div>
          <div><Store size={17}/>{t("Πληρωμή στο κατάστημα · ")}{euros(confirmed.service.price)}</div>
        </div>
        <p className="booking-live-success-note">{t("Θα βρείτε την κράτηση στην ενότητα «Τα ραντεβού μου». Η πληρωμή γίνεται απευθείας στο κατάστημα")}</p>
        <p className="booking-live-policy">{cancellationNote}</p>
        <button type="button" className="booking-primary" onClick={onClose}>{t("Ολοκλήρωση ")}<Check size={18}/></button>
      </div> : <>
        <div className="booking-progress" aria-label={t("Βήμα {step} από 3", {step})}>
          {[t("Υπηρεσία"), t("Ημέρα & ώρα"), t("Κράτηση")].map((label, index) => <div key={label} className={step >= index + 1 ? 'is-current' : ''}><span>{step > index + 1 ? <Check size={12}/> : index + 1}</span>{t(label)}</div>)}
        </div>
        <div className="booking-heading">
          <span className="booking-eyebrow">{salon.name}</span>
          <h2 id="booking-title">{step === 1 ? t("Τι θα κάνετε για εσάς;") : step === 2 ? t("Βρείτε τη δική σας στιγμή") : t("Λίγο πριν την ομορφιά")}</h2>
          <p>{step === 1 ? t("Επιλέξτε την υπηρεσία που σας ταιριάζει") : step === 2 ? t("Επιλέξτε επαγγελματία, ημέρα και ώρα") : t("Ελέγξτε τα στοιχεία και ολοκληρώστε την κράτηση")}</p>
        </div>

        {step === 1 && <div className="booking-step-content">
          <div className="booking-salon-line"><MapPin size={15}/><span>{[salon.address, t(salon.city), t(salon.country)].filter(Boolean).join(', ')}</span></div>
          {services.length ? <div className="booking-services">
            {services.map((item) => <button key={item.id} type="button" className={`booking-service ${service?.id === item.id ? 'is-selected' : ''}`} onClick={() => { setService(item); setError(''); }} aria-pressed={service?.id === item.id}>
              <span className="booking-service-icon"><Scissors size={21}/></span>
              <span className="booking-service-info"><strong>{item.name}</strong><small><Clock3 size={13}/>{item.duration}{t(" λεπτά")}</small></span>
              <strong className="booking-price">{euros(item.price)}</strong>
              <span className="booking-radio">{service?.id === item.id && <span/>}</span>
            </button>)}
          </div> : <p className="booking-empty">{t("Ο χώρος δεν προσφέρει αυτή τη στιγμή υπηρεσίες για online κράτηση. Επιστρέψτε αργότερα")}</p>}
          <div className="booking-reassurance"><ShieldCheck size={17}/>{t("Χωρίς ηλεκτρονική χρέωση. Πληρώνετε στο κατάστημα")}</div>
          <button type="button" className="booking-primary" disabled={!service} onClick={() => setStep(2)}>{t("Συνέχεια ")}<ArrowRight size={18}/></button>
        </div>}

        {step === 2 && <div className="booking-step-content">
          <h3>{t("Με ποιον θα θέλατε;")}</h3>
          {staffMembers.length ? <div className="booking-live-staff" role="group" aria-label={t("Επιλογή επαγγελματία")}>
            <button type="button" className={`booking-staff ${staffChoice === 'any' ? 'is-selected' : ''}`} onClick={() => { setStaffChoice('any'); setError(''); }} aria-pressed={staffChoice === 'any'}><span className="booking-avatar"><UserRound size={23}/></span><strong>{t("Χωρίς προτίμηση")}</strong><small>{t("Ο πρώτος διαθέσιμος")}</small>{staffChoice === 'any' && <Check size={14} className="booking-staff-check"/>}</button>
            {staffMembers.map((person, index) => <button key={person.id} type="button" className={`booking-staff ${staffChoice === person.id ? 'is-selected' : ''}`} onClick={() => { setStaffChoice(person.id); setError(''); }} aria-pressed={staffChoice === person.id}><span className={`booking-avatar booking-avatar-${index % 3}`}>{person.name.slice(0, 1)}</span><strong>{person.name}</strong><small>{t("Η ομάδα του χώρου")}</small>{staffChoice === person.id && <Check size={14} className="booking-staff-check"/>}</button>)}
          </div> : <p className="booking-empty">{t("Δεν υπάρχει ενεργός επαγγελματίας για αυτή την υπηρεσία. Δοκιμάστε ξανά αργότερα")}</p>}
          <div className="booking-date-heading"><h3>{t("Επιλέξτε ημέρα")}</h3><span>{formatDate(date, timeZone, { month: 'long', year: 'numeric' })}</span></div>
          <div className="booking-live-calendar-nav"><button type="button" aria-label={t("Προηγούμενες ημέρες")} disabled={rangeStart <= today} onClick={() => setRangeStart(addDays(rangeStart, -7) < today ? today : addDays(rangeStart, -7))}><ChevronLeft size={17}/></button><label><CalendarDays size={14}/><span>{t("Άλλη ημερομηνία")}</span><input aria-label={t("Ημερομηνία ραντεβού")} type="date" lang={getLocale()} value={date} min={today} max={lastDate} onChange={(event) => chooseDate(event.target.value)}/></label><button type="button" aria-label={t("Επόμενες ημέρες")} disabled={addDays(rangeStart, 7) > lastDate} onClick={() => setRangeStart(addDays(rangeStart, 7))}><ChevronRight size={17}/></button></div>
          <div className="booking-days">
            {days.map((day) => <button key={day} type="button" className={date === day ? 'is-selected' : ''} onClick={() => chooseDate(day)} aria-label={formatDate(day, timeZone)} aria-pressed={date === day}><span>{formatDate(day, timeZone, { weekday: 'short' }).replace('.', '')}</span><strong>{formatDate(day, timeZone, { day: 'numeric' })}</strong><i/></button>)}
          </div>
          <h3 className="booking-times-heading">{t("Διαθέσιμες ώρες ")}<span title={timeZone}>{t("Τοπική ώρα ")}{salon.country === 'Κύπρος' ? t("Κύπρου") : t("Ελλάδας")}</span></h3>
          <div className="booking-live-slot-region" aria-live="polite" aria-busy={slotsLoading}>
            {!staffChoice ? <p className="booking-empty">{t("Επιλέξτε επαγγελματία ή «Χωρίς προτίμηση» για να δείτε τις διαθέσιμες ώρες")}</p> : slotsLoading ? <p className="booking-live-loading"><LoaderCircle size={17} className="booking-live-spinner"/>{t("Αναζητούμε διαθέσιμες ώρες…")}</p> : slotsError ? <div className="booking-live-slot-error"><p role="alert">{t(slotsError)}</p><button type="button" onClick={() => setRefreshIndex((value) => value + 1)}><RefreshCw size={14}/>{t("Δοκιμή ξανά")}</button></div> : visibleSlots.length ? <div className="booking-times booking-live-times">
              {visibleSlots.map((value) => <button key={slotKey(value)} type="button" className={slot && slotKey(slot) === slotKey(value) ? 'is-selected' : ''} onClick={() => { setSlot(value); setError(''); }} aria-pressed={Boolean(slot && slotKey(slot) === slotKey(value))} aria-label={`${value.time} · ${value.staffName}`}><strong>{value.time}</strong>{staffChoice === 'any' && <span>{value.staffName}</span>}</button>)}
            </div> : <p className="booking-empty">{t("Δεν υπάρχουν διαθέσιμες ώρες για αυτή την ημέρα. Δοκιμάστε άλλη ημέρα ή άλλον επαγγελματία")}</p>}
          </div>
          {error && <p className="booking-error" role="alert">{t(error)}</p>}
          <div className="booking-selection-summary"><Scissors size={17}/><span>{service.name}</span><strong>{euros(service.price)}</strong></div>
          <button type="button" className="booking-primary" disabled={!selectedStillAvailable || slotsLoading} onClick={() => { setError(''); setStep(3); }}>{t("Συνέχεια στην επιβεβαίωση ")}<ArrowRight size={18}/></button>
        </div>}

        {step === 3 && <form className="booking-step-content" onSubmit={complete}>
          <div className="booking-summary-card">
            <div><span className="booking-summary-icon"><Scissors size={20}/></span><span><strong>{service.name}</strong><small>{service.duration}{t(" λεπτά · ")}{salon.name}</small></span><b>{euros(service.price)}</b></div>
            <button type="button" disabled={saving} onClick={() => setStep(2)}><span className="booking-summary-icon"><UserRound size={20}/></span><span><strong>{slot.staffName}</strong><small>{t("Ο επαγγελματίας σας")}</small></span><ChevronRight size={17}/></button>
            <button type="button" disabled={saving} onClick={() => setStep(2)}><span className="booking-summary-icon"><CalendarDays size={20}/></span><span><strong>{formatDate(date, timeZone, { weekday: 'short', day: 'numeric', month: 'short' })} · {slot.time}</strong><small>{t("Τοπική ώρα ")}{salon.country === 'Κύπρος' ? t("Κύπρου") : t("Ελλάδας")}</small></span><ChevronRight size={17}/></button>
          </div>
          <h3>{t("Τα στοιχεία της κράτησης")}</h3>
          {accountLoading ? <p className="booking-live-loading"><LoaderCircle size={17} className="booking-live-spinner"/>{t("Έλεγχος λογαριασμού…")}</p> : !verified ? <div className="booking-live-auth"><ShieldCheck size={23}/><div><strong>{user ? t("Επιβεβαιώστε το email σας") : t("Μια ασφαλής κράτηση ξεκινά από εσάς")}</strong><p>{user ? t("Χρειάζεται επιβεβαίωση του email του λογαριασμού σας πριν από την κράτηση") : t("Συνδεθείτε ή δημιουργήστε λογαριασμό για να διαχειρίζεστε και να ακυρώνετε τα ραντεβού σας")}</p><button type="button" onClick={requestAccount}>{user ? t("Διαχείριση λογαριασμού") : t("Σύνδεση ή εγγραφή")}<ArrowRight size={15}/></button></div></div> : <>
            <div className="booking-fields booking-live-fields"><label><span>{t("Το όνομά σας")}</span><div><UserRound size={17}/><input value={name} disabled={saving} onChange={(event) => { setName(event.target.value); setNameEdited(true); }} required minLength={2} maxLength={80} autoComplete="name" placeholder={t("Ονοματεπώνυμο")}/></div></label></div>
            <div className="booking-live-account-email"><Mail size={16}/><span>{user.email}</span><CheckCircle2 size={14}/><small>{t("Επιβεβαιωμένο email")}</small></div>
            <div className="booking-live-account-phone" aria-label={t("Κινητό από το προφίλ")}><Phone size={17} /><div><span>{t("Κινητό λογαριασμού")}</span><strong>{phoneValid ? phone : t("Δεν έχει αποθηκευτεί έγκυρο κινητό")}</strong></div><button ref={profileSettingsButton} type="button" disabled={saving} onClick={() => { setError(''); setEditingAccount(true); }}>{t("Αλλαγή στο προφίλ")}</button></div>
            {requiresPhoneVerification && !phoneVerified && <p className="booking-live-contact-needed" role="status">{t("Επιβεβαιώστε το κινητό σας με SMS από το προφίλ πριν από την κράτηση")}</p>}
            {authRequirementsError && <p className="booking-error" role="alert">{t("Ανοίξτε το προφίλ σας για νέο έλεγχο του λογαριασμού")}</p>}
            {!phoneValid && <p className="booking-live-contact-needed" role="status">{t("Προσθέστε το κινητό σας μία φορά στο προφίλ για να χρησιμοποιείται αυτόματα στις κρατήσεις σας")}</p>}
            <div className="booking-form-fields booking-contact-fields booking-contact-fields--saved"><label>{t("Σημειώσεις για την επιχείρηση (προαιρετικό)")}<textarea aria-label={t("Σημειώσεις για την επιχείρηση (προαιρετικό)")} value={notes} disabled={saving} onChange={event => setNotes(event.target.value)} maxLength={1000} rows={3} /></label></div>
            <p className="booking-live-payment-note">{t("Το κινητό και οι σημειώσεις σας είναι διαθέσιμα στην επιχείρηση για την εξυπηρέτηση της κράτησής σας")}</p>
          </>}
          <h3>{t("Πληρωμή")}</h3>
          <div className="booking-payment-methods"><div className="booking-payment-active"><Store size={19}/><span>{t("Πληρωμή στο κατάστημα")}</span><span className="booking-radio"><span/></span></div></div>
          <p className="booking-live-payment-note">{t("Δεν ζητάμε στοιχεία κάρτας. Η πληρωμή γίνεται απευθείας στο κατάστημα")}</p>
          <div className="booking-total"><div><span>{t("Υπηρεσία")}</span><span>{euros(service.price)}</span></div><div><strong>{t("Σύνολο")}</strong><strong>{euros(service.price)}</strong></div></div>
          <div className="booking-live-cancellation"><ShieldCheck size={18}/><div><strong>{t("Πολιτική ακύρωσης")}</strong><p>{cancellationNote}</p></div></div>
          <label className="booking-live-ack"><input type="checkbox" required checked={acknowledged} disabled={saving} onChange={(event) => setAcknowledged(event.target.checked)}/><span>{t("Έχω διαβάσει την πολιτική ακύρωσης και κατανοώ ότι το όνομα, το email και το κινητό μου θα χρησιμοποιηθούν από το κατάστημα και την πλατφόρμα Eneres για τη διαχείριση της κράτησης")}</span></label>
          <p className="booking-live-privacy">{t("Δεν σας εγγράφουμε σε διαφημιστικές επικοινωνίες")}</p>
          {error && <p className="booking-error" role="alert">{t(error)}</p>}
          <button className="booking-primary" type="submit" disabled={saving || accountLoading || !verified || !phoneValid || (requiresPhoneVerification && !phoneVerified) || Boolean(authRequirementsError) || !acknowledged}>{saving ? <><LoaderCircle size={17} className="booking-live-spinner"/>{t("Καταχώριση κράτησης…")}</> : <>{t("Επιβεβαίωση ραντεβού · ")}{euros(service.price)}<ArrowRight size={17}/></>}</button>
        </form>}
      </>}
    </section>
  </div>;
}
