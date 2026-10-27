import LanguageSelector from './Language';
import { t, getLocale } from "./i18n";import { formatEuro } from './lib/currency';
import { platformReady } from './lib/platform';
import LiveBusiness from './LiveBusiness';
import Brand from './Brand';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, Eye, EyeOff, LayoutDashboard, LockKeyhole, Mail, Plus, Scissors, TrendingUp, Users, X } from 'lucide-react';
import './business.css';

const money = formatEuro;
const dateKey = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens' }).format(date);
const dayLabel = (date, options) => new Intl.DateTimeFormat(getLocale(), { timeZone: 'Europe/Athens', ...options }).format(date);
const shiftDate = (date, days) => {const next = new Date(date);next.setUTCDate(next.getUTCDate() + days);return next;};
const today = () => new Date(`${dateKey(new Date())}T12:00:00Z`);
const services = [{ name: 'Κούρεμα & χτένισμα', price: 35, duration: 60 }, { name: 'Βαφή ρίζας', price: 45, duration: 90 }, { name: 'Ημιμόνιμο μανικιούρ', price: 25, duration: 45 }, { name: 'Χαλαρωτικό μασάζ', price: 50, duration: 60 }];
const calendarStorageKey = 'meraki-business-calendar';

function readCalendar() {
  try {
    const stored = JSON.parse(localStorage.getItem(calendarStorageKey));
    return {
      added: Array.isArray(stored?.added) ? stored.added.filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string' && item.name.trim().length >= 2 && typeof item.staff === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date) && /^\d{2}:\d{2}$/.test(item.time) && typeof item.service?.name === 'string' && Number.isFinite(item.service?.price) && Number.isFinite(item.service?.duration)) : [],
      canceled: Array.isArray(stored?.canceled) ? stored.canceled.filter((id) => typeof id === 'string') : []
    };
  } catch {return { added: [], canceled: [] };}
}

function BrandMark() {
  return <span aria-hidden="true"><svg viewBox="0 0 32 32" width="28" height="28" fill="none"><path d="M16 4v24M4 16h24M7.5 7.5l17 17M24.5 7.5l-17 17" stroke="currentColor" strokeWidth="4" strokeLinecap="round" /></svg></span>;
}

function BizDialog({ title, onClose, children }) {
  const closeRef = useRef(null);
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const keyboard = (event) => {
      if (event.key === 'Escape') onCloseRef.current();
      if (event.key === 'Tab') {
        const items = panelRef.current?.querySelectorAll('button, input, select, textarea, a[href]');
        if (!items?.length) return;
        const first = items[0];const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {event.preventDefault();last.focus();} else
        if (!event.shiftKey && document.activeElement === last) {event.preventDefault();first.focus();}
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => {document.body.style.overflow = overflow;document.removeEventListener('keydown', keyboard);previous?.focus();};
  }, []);
  return <div className="biz-modal-backdrop" onMouseDown={(event) => {if (event.target === event.currentTarget) onClose();}}>
    <section className="biz-modal" role="dialog" aria-modal="true" aria-label={title} ref={panelRef}>
      <div className="biz-modal-heading"><h2>{t(title)}</h2><button type="button" className="biz-icon-button" aria-label={t("Κλείσιμο")} onClick={onClose} ref={closeRef}><X size={20} /></button></div>
      {children}
    </section>
  </div>;
}

export default function Business(props) {return platformReady ? <LiveBusiness {...props} /> : <DemoBusiness {...props} />;}

function DemoBusiness({ onBack, bookings = [] }) {
  const [view, setView] = useState('login');
  const [signup, setSignup] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState('');
  const [selectedDate, setSelectedDate] = useState(today);
  const [storedCalendar] = useState(readCalendar);
  const [added, setAdded] = useState(storedCalendar.added);
  const [canceled, setCanceled] = useState(storedCalendar.canceled);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [modal, setModal] = useState(null);
  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [toast, setToast] = useState(null);
  const [serviceIndex, setServiceIndex] = useState(0);
  const currentKey = dateKey(selectedDate);
  const sampleAppointments = useMemo(() => [
  { id: 'business-demo-1', name: 'Μαρία Αντωνίου', service: services[0], staff: 'Ελένη', date: dateKey(today()), time: '10:00', color: 'peach', paid: false },
  { id: 'business-demo-2', name: 'Ελένη Νικολάου', service: services[1], staff: 'Σοφία', date: dateKey(today()), time: '11:15', color: 'green', paid: true },
  { id: 'business-demo-3', name: 'Νίκος Αλεξίου', service: { name: "Ανδρικό κούρεμα", price: 25, duration: 30 }, staff: 'Ελένη', date: dateKey(today()), time: '13:30', color: 'blue', paid: false }],
  []);
  const salonBookings = bookings.filter((booking) => booking.salonId === 'atelier-hair');
  const appointments = [...sampleAppointments, ...added, ...salonBookings.map((booking) => ({ ...booking, name: booking.name || t("Νέα online κράτηση"), color: 'peach' }))].filter((item) => item.date === currentKey && !canceled.includes(item.id)).sort((a, b) => a.time.localeCompare(b.time));
  const revenue = appointments.reduce((sum, item) => sum + Number(item.service?.price || 0), 0);
  const dateRange = Array.from({ length: 7 }, (_, index) => shiftDate(selectedDate, index - 3));

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    try {localStorage.setItem(calendarStorageKey, JSON.stringify({ added, canceled }));setStorageAvailable(true);}
    catch {setStorageAvailable(false);}
  }, [added, canceled]);

  function showToast(message, type = 'success') {setToast({ message, type });}

  function authSubmit(event) {
    event.preventDefault();
    if (signup && String(new FormData(event.currentTarget).get('business')).trim().length < 2) {setNotice(t("Συμπληρώστε όνομα επιχείρησης με τουλάχιστον 2 χαρακτήρες"));return;}
    if (signup) setNotice(t("Η φόρμα είναι δοκιμαστική. Τα στοιχεία σας δεν αποθηκεύτηκαν και δεν στάλθηκε αίτημα εγγραφής. Δείτε τη δοκιμαστική έκδοση παρακάτω"));else
    setNotice(t("Η σύνδεση με πραγματικό λογαριασμό δεν έχει ενεργοποιηθεί ακόμη. Μπορείτε να εξερευνήσετε το δοκιμαστικό ημερολόγιο χωρίς λογαριασμό"));
    event.currentTarget.reset();
  }

  function addAppointment(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const appointment = { id: `business-${Date.now()}`, name: String(form.get('name')).trim(), staff: String(form.get('staff')), date: String(form.get('date')), time: String(form.get('time')), service: services[serviceIndex], color: 'peach', paid: false };
    if (appointment.name.length < 2) {showToast(t("Συμπληρώστε όνομα πελάτη με τουλάχιστον 2 χαρακτήρες"), 'error');return;}
    const minutes = (time) => {const [hour, minute] = time.split(':').map(Number);return hour * 60 + minute;};
    const start = minutes(appointment.time);
    const end = start + appointment.service.duration;
    if (end > 19 * 60) {showToast(t("Το ραντεβού πρέπει να ολοκληρώνεται μέχρι τις 19:00. Επιλέξτε νωρίτερη ώρα"), 'error');return;}
    if ([...sampleAppointments, ...added, ...salonBookings].some((item) => item.date === appointment.date && item.staff === appointment.staff && !canceled.includes(item.id) && start < minutes(item.time) + (item.service?.duration || 60) && end > minutes(item.time))) {showToast(t("Υπάρχει ήδη ραντεβού για αυτόν τον επαγγελματία εκείνη την ώρα. Επιλέξτε άλλη ώρα"), 'error');return;}
    setAdded((items) => [...items, appointment]);
    setSelectedDate(new Date(`${appointment.date}T12:00:00Z`));
    setModal(null);
    showToast(t("Το δοκιμαστικό ραντεβού προστέθηκε στο ημερολόγιο"));
  }

  if (view === 'login') return <main className="business-page business-auth">
    <div className="biz-dashboard-top"><button className="biz-back-link" onClick={onBack}><ArrowLeft size={17} />{t(" Πίσω στην εξερεύνηση")}</button><LanguageSelector /></div>
    <section className="biz-auth-card">
      <div className="biz-auth-photo"><div className="biz-auth-photo-overlay"><span className="biz-photo-eyebrow">{t("Ο ΧΩΡΟΣ ΣΑΣ. ΟΙ ΑΝΘΡΩΠΟΙ ΣΑΣ")}</span><p>{t("Περισσότερος χρόνος")}<br />{t("για ό,τι αγαπάτε")}</p><span>{t("Εμείς φροντίζουμε τα ραντεβού")}</span></div></div>
      <div className="biz-auth-content">
        <Brand />
        <span className="biz-eyebrow">{t("ΓΙΑ ΕΠΑΓΓΕΛΜΑΤΙΕΣ")}</span>
        <h1>{signup ? t("Ας γνωριστούμε") : t("Καλώς ήρθατε ξανά")}</h1>
        <p className="biz-muted">{signup ? t("Ένας όμορφος τρόπος να οργανώσετε την επιχείρησή σας") : t("Τα ραντεβού και η ομάδα σας, σε ένα μέρος")}</p>
        <form className="biz-auth-form" onSubmit={authSubmit}>
          {signup && <label className="biz-field"><span>{t("Όνομα επιχείρησης")}</span><input name="business" required minLength={2} placeholder={t("Το όνομα του καταστήματός σας")} autoComplete="organization" /></label>}
          <label className="biz-field"><span>Email</span><div className="biz-input-icon"><Mail size={18} /><input name="email" type="email" required placeholder="hello@your-salon.gr" autoComplete="email" /></div></label>
          <label className="biz-field"><span>{t("Κωδικός πρόσβασης")}</span><div className="biz-input-icon"><LockKeyhole size={18} /><input name="password" type={showPassword ? 'text' : 'password'} minLength={8} required placeholder={t("Τουλάχιστον 8 χαρακτήρες")} autoComplete={signup ? 'new-password' : 'current-password'} /><button type="button" className="biz-password-toggle" aria-label={showPassword ? t("Απόκρυψη κωδικού") : t("Εμφάνιση κωδικού")} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
          {notice && <p className="biz-auth-notice" role="status">{t(notice)}</p>}
          <button className="biz-primary" type="submit">{signup ? t("Εγγραφή καταστήματος") : t("Σύνδεση")}<ArrowRight size={17} /></button>
        </form>
        <p className="biz-auth-switch">{signup ? t("Έχετε ήδη λογαριασμό;") : t("Είστε νέος εδώ;")} <button onClick={() => {setSignup(!signup);setNotice('');}}>{signup ? t("Σύνδεση") : t("Εγγραφή καταστήματος")}</button></p>
        <div className="biz-auth-divider"><span>{t("ή γνωρίστε το Eneres")}</span></div>
        <button className="biz-demo-button" onClick={() => setView('dashboard')}><LayoutDashboard size={18} />{t(" Δείτε τη δοκιμαστική έκδοση ")}<ArrowRight size={17} /></button>
        <p className="biz-small-note">{t("Χωρίς λογαριασμό. Χωρίς πραγματικά δεδομένα ή χρεώσεις")}</p>
      </div>
    </section>
  </main>;

  return <main className="business-page biz-dashboard">
    <div className="biz-dashboard-top"><button className="biz-back-link" onClick={onBack}><ArrowLeft size={17} />{t(" Επιστροφή στο Eneres")}</button><span className="biz-demo-badge"><span />{t(" Δοκιμαστικό περιβάλλον")}</span><LanguageSelector /></div>
    <div className="biz-dashboard-shell">
      <aside className="biz-sidebar">
        <Brand /><span className="biz-eyebrow">{t("ΓΙΑ ΕΠΑΓΓΕΛΜΑΤΙΕΣ")}</span>
        <div className="biz-salon-identity"><span className="biz-salon-initial">A</span><div><strong>Atelier Hair Studio</strong><small>{t("Αθήνα · Δοκιμαστικό κατάστημα")}</small></div></div>
        <div className="biz-sidebar-active"><CalendarDays size={19} />{t(" Ημερολόγιο")}</div>
        <div className="biz-sidebar-tip"><Scissors size={23} /><strong>{t("Κάθε μέρα, λίγο πιο απλά")}</strong><p>{t("Τα online και τα χειροκίνητα ραντεβού σας, συγκεντρωμένα εδώ")}</p></div>
        <button className="biz-sidebar-exit" onClick={() => {setView('login');setNotice('');}}>{t("Έξοδος από τη δοκιμή ")}<ArrowRight size={16} /></button>
      </aside>
      <section className="biz-calendar-content">
        <header className="biz-calendar-heading"><div><span className="biz-eyebrow">{t("Η ΕΠΙΧΕΙΡΗΣΗ ΣΑΣ, ΜΕ ΜΙΑ ΜΑΤΙΑ")}</span><h1>{t("Μια όμορφη μέρα ξεκινά")}</h1><p className="biz-muted">{t("Λίγη οργάνωση. Περισσότερη δημιουργία")}</p></div><button className="biz-primary biz-add-desktop" onClick={() => {setServiceIndex(0);setModal('add');}}><Plus size={18} />{t(" Νέο ραντεβού")}</button></header>
        <div className="biz-stat-grid"><div className="biz-stat"><span className="biz-stat-icon biz-peach"><CalendarDays size={20} /></span><div><strong>{appointments.length}</strong><span>{t("ραντεβού")}</span></div></div><div className="biz-stat"><span className="biz-stat-icon biz-green"><TrendingUp size={20} /></span><div><strong>{money(revenue)}</strong><span>{t("προγραμματισμένη αξία")}</span></div></div><div className="biz-stat"><span className="biz-stat-icon biz-blue"><Users size={20} /></span><div><strong>{appointments.filter((item) => !String(item.id).startsWith('business-demo')).length}</strong><span>{t("νέες κρατήσεις")}</span></div></div></div>
        <section className="biz-calendar-card">
          <div className="biz-calendar-toolbar"><div><h2>{t("Ημερολόγιο")}</h2><span>{dayLabel(selectedDate, { month: 'long', year: 'numeric' })}</span></div><div className="biz-date-controls"><button onClick={() => setSelectedDate(today())}>{t("Σήμερα")}</button><button aria-label={t("Προηγούμενη εβδομάδα")} onClick={() => setSelectedDate(shiftDate(selectedDate, -7))}><ChevronLeft size={18} /></button><button aria-label={t("Επόμενη εβδομάδα")} onClick={() => setSelectedDate(shiftDate(selectedDate, 7))}><ChevronRight size={18} /></button></div></div>
          <div className="biz-date-strip">{dateRange.map((date) => <button className={dateKey(date) === currentKey ? 'biz-date-active' : ''} key={dateKey(date)} aria-pressed={dateKey(date) === currentKey} onClick={() => setSelectedDate(date)}><span>{dayLabel(date, { weekday: 'short' })}</span><strong>{dayLabel(date, { day: 'numeric' })}</strong>{dateKey(date) === dateKey(today()) && <i />}</button>)}</div>
          <div className="biz-timeline">
            <div className="biz-timeline-lines">{Array.from({ length: 11 }, (_, index) => <div key={index}><span>{String(index + 8).padStart(2, '0')}:00</span></div>)}</div>
            <div className="biz-timeline-events">{appointments.map((appointment) => {const [hour, minute] = appointment.time.split(':').map(Number);return <button key={appointment.id} className={`biz-appointment biz-${appointment.color || 'peach'}`} style={{ top: `${Math.max(0, (hour - 8) * 68 + minute / 60 * 68)}px`, minHeight: `${Math.max(55, Math.min(appointment.service?.duration || 60, 110) / 60 * 68 - 7)}px` }} onClick={() => {setSelectedAppointment(appointment);setModal('detail');}}><div><strong>{appointment.time} <span>{appointment.name}</span></strong><span>{t(appointment.service?.name)}</span><small>{t("με ")}{appointment.staff || t("την ομάδα μας")}</small></div><div className="biz-event-end">{appointment.paid && <span className="biz-paid">{t("Πληρωμένο")}</span>}<ChevronRight size={17} /></div></button>;})}</div>
            {!appointments.length && <div className="biz-empty-day"><CalendarDays size={32} /><h3>{t("Μια ελεύθερη μέρα")}</h3><p>{t("Δεν υπάρχουν ραντεβού για αυτή την ημερομηνία")}</p><button onClick={() => {setServiceIndex(0);setModal('add');}}>{t("Προσθήκη ραντεβού ")}<Plus size={15} /></button></div>}
          </div>
        </section>
        <p className="biz-calendar-note">{t("Ημερολόγιο δοκιμαστικού καταστήματος Atelier Hair Studio. Οι ώρες εμφανίζονται στη ζώνη ώρας Ελλάδας / Κύπρου ")}{storageAvailable ? t("Οι αλλαγές αποθηκεύονται μόνο σε αυτή τη συσκευή") : t("Η τοπική αποθήκευση δεν είναι διαθέσιμη. Οι αλλαγές διατηρούνται μόνο μέχρι να κλείσετε αυτή τη σελίδα")}{t(" Τα δοκιμαστικά δεδομένα δεν αποστέλλονται σε πραγματικό κατάστημα")}</p>
      </section>
    </div>
    <button className="biz-mobile-add" aria-label={t("Προσθήκη νέου ραντεβού")} onClick={() => {setServiceIndex(0);setModal('add');}}><Plus size={26} /></button>
    {toast && <div className={`biz-toast${toast.type === 'error' ? ' biz-toast-error' : ''}`} role={toast.type === 'error' ? 'alert' : 'status'}>{toast.type === 'error' ? <AlertCircle size={18} /> : <Check size={18} />}{t(toast.message)}</div>}
    {modal === 'add' && <BizDialog title={t("Νέο ραντεβού")} onClose={() => setModal(null)}><form className="biz-appointment-form" onSubmit={addAppointment}><p className="biz-muted">{t("Προσθέστε μια κράτηση στο δοκιμαστικό ημερολόγιο")}</p><label className="biz-field"><span>{t("Ονοματεπώνυμο πελάτη")}</span><input name="name" required minLength={2} maxLength={80} placeholder={t("π.χ. Μαρία Αντωνίου")} /></label><label className="biz-field"><span>{t("Υπηρεσία")}</span><select name="service" value={serviceIndex} onChange={(event) => setServiceIndex(Number(event.target.value))}>{services.map((service, index) => <option key={service.name} value={index}>{t(service.name)} · {money(service.price)}</option>)}</select></label><label className="biz-field"><span>{t("Επαγγελματίας")}</span><select name="staff"><option>Ελένη</option><option>Σοφία</option></select></label><div className="biz-form-row"><label className="biz-field"><span>{t("Ημερομηνία")}</span><input type="date" name="date" required defaultValue={currentKey} min={dateKey(today())} /></label><label className="biz-field"><span>{t("Ώρα")}</span><input type="time" name="time" required defaultValue="09:00" min="08:00" max="18:00" step="900" /></label></div><div className="biz-form-summary"><span><Clock3 size={16} /> {services[serviceIndex].duration}{t(" λεπτά")}</span><strong>{money(services[serviceIndex].price)}</strong></div><button className="biz-primary" type="submit"><Plus size={17} />{t(" Προσθήκη ραντεβού")}</button></form></BizDialog>}
    {modal === 'detail' && selectedAppointment && <BizDialog title={t("Λεπτομέρειες ραντεβού")} onClose={() => setModal(null)}><div className="biz-detail-avatar">{selectedAppointment.name?.slice(0, 1)}</div><h3 className="biz-detail-name">{selectedAppointment.name}</h3><dl className="biz-detail-list"><div><dt>{t("Υπηρεσία")}</dt><dd>{t(selectedAppointment.service?.name)}</dd></div><div><dt>{t("Επαγγελματίας")}</dt><dd>{selectedAppointment.staff || t("Η ομάδα μας")}</dd></div><div><dt>{t("Ημερομηνία")}</dt><dd>{dayLabel(new Date(`${selectedAppointment.date}T12:00:00Z`), { day: 'numeric', month: 'long' })}</dd></div><div><dt>{t("Ώρα & διάρκεια")}</dt><dd>{selectedAppointment.time} · {selectedAppointment.service?.duration || 60}{t(" λεπτά")}</dd></div><div><dt>{t("Αξία υπηρεσίας")}</dt><dd>{money(selectedAppointment.service?.price || 0)}</dd></div></dl><button className="biz-primary" onClick={() => setModal(null)}>{t("Επιστροφή στο ημερολόγιο")}</button><button className="biz-cancel-appointment" onClick={() => {setCanceled((items) => [...items, selectedAppointment.id]);setModal(null);showToast(t("Το δοκιμαστικό ραντεβού ακυρώθηκε"));}}>{t("Ακύρωση δοκιμαστικού ραντεβού")}</button></BizDialog>}
  </main>;
}
