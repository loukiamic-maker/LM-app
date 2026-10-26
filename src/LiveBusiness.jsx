import { formatEuro } from './lib/currency';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Bell, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Euro, LoaderCircle, LogOut, MapPin, PlayCircle, Plus, RefreshCw, Scissors, Settings2, ShieldCheck, Trash2, Users, X } from 'lucide-react';
import { AccountPanel, useAccount } from './Account';
import { completeBooking, createSalon, deleteTimeOff, getSlots, listBusinessBookings, listOwnSalons, rescheduleBooking, saveHours, saveService, saveStaff, saveTimeOff, submitSalon } from './lib/platform';
import { categories, locationGroups } from './data';
import { createManualBooking, editManualBooking } from './lib/ownerCalendar';
import './live-business.css';
import BusinessBilling from './BusinessBilling';
import Brand from './Brand';
import SalonPhotoField from './SalonPhotoField';
import { saveSalonWithPhoto } from './lib/salonPhotos';
import BusinessTimeline from './BusinessTimeline';
import BusinessNotifications, { NotificationButton, NotificationToast, useBusinessNotifications } from './BusinessNotifications';
import { cancelBookingWithNote } from './lib/businessNotifications';

const money = amount => formatEuro(amount || 0);
const errorText = (error) => error?.userMessage || error?.message || "Κάτι πήγε στραβά. Δοκιμάστε ξανά";
const timezoneFor = (country) => country === 'Κύπρος' ? 'Europe/Nicosia' : 'Europe/Athens';
const dateInZone = (date = new Date(), timezone = 'Europe/Athens') => new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(date);
const readableDate = (date, timezone = 'Europe/Athens', options = {}) => new Intl.DateTimeFormat('el-GR', { timeZone: timezone, day: 'numeric', month: 'long', ...options }).format(new Date(date));
const changeDay = (date, amount) => { const next = new Date(`${date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + amount); return next.toISOString().slice(0, 10); };
const statusLabels = { confirmed: 'Επιβεβαιωμένο', cancelled: 'Ακυρωμένο', completed: 'Ολοκληρωμένο', no_show: 'Δεν προσήλθε' };
const salonStatuses = { draft: 'Πρόχειρο', pending: 'Σε έλεγχο', published: 'Δημοσιευμένο', suspended: 'Σε αναστολή', rejected: 'Χρειάζεται αλλαγές' };
const weekdays = [[1, 'Δευτέρα'], [2, 'Τρίτη'], [3, 'Τετάρτη'], [4, 'Πέμπτη'], [5, 'Παρασκευή'], [6, 'Σάββατο'], [0, 'Κυριακή']];

// Interpret the form's wall-clock time in the salon's zone, not the visitor's browser zone.
function localDateTimeToISO(value, timezone) {
  const target = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(target)) throw new Error('Επιλέξτε έγκυρη ημερομηνία και ώρα');
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  let guess = target;
  for (let index = 0; index < 4; index++) {
    const parts = Object.fromEntries(format.formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    guess = target - (represented - guess);
  }
  const parts = Object.fromEntries(format.formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
  if (`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` !== value) throw new Error("Αυτή η τοπική ώρα δεν υπάρχει λόγω αλλαγής θερινής ώρας. Επιλέξτε άλλη ώρα");
  return new Date(guess).toISOString();
}

function Logo() { return <Brand />; }
function Spinner({ text = 'Φόρτωση…' }) { return <span className="lb-spinner" role="status"><LoaderCircle size={18} />{text}</span>; }
function Message({ children, error = false }) { return children ? <div className={`lb-message${error ? ' lb-message-error' : ''}`} role={error ? 'alert' : 'status'}>{error ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}<span>{children}</span></div> : null; }
function Field({ label, children, className = '' }) { return <label className={`lb-field ${className}`}><span>{label}</span>{children}</label>; }

function Modal({ title, onClose, children, busy = false }) {
  const panel = useRef(null);
  const closeCallback = useRef(onClose);
  const busyRef = useRef(busy);
  closeCallback.current = onClose;
  busyRef.current = busy;
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.querySelector('button, input, select')?.focus();
    const keyboard = (event) => {
      if (event.key === 'Escape' && !busyRef.current) closeCallback.current();
      if (event.key !== 'Tab') return;
      const controls = [...(panel.current?.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]') || [])];
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keyboard); previous?.focus(); };
  }, []);
  return <div className="lb-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><section className="lb-modal" role="dialog" aria-modal="true" aria-label={title} ref={panel}><header><h2>{title}</h2><button type="button" className="lb-icon-button" aria-label="Κλείσιμο" disabled={busy} onClick={onClose}><X size={20} /></button></header>{children}</section></div>;
}

function SalonForm({ salon, busy, onSubmit }) {
  const [validation, setValidation] = useState('');
  const [photo, setPhoto] = useState(null);
  const [photoChecking, setPhotoChecking] = useState(false);
  const [previewName, setPreviewName] = useState(salon?.name || '');
  const [country, setCountry] = useState(salon?.country || 'Ελλάδα');
  const [city, setCity] = useState(salon?.city || '');
  const cities = locationGroups.find((group) => group.country === country)?.cities || [];
  const changeCountry = (nextCountry) => {
    setCountry(nextCountry);
    const allowed = locationGroups.find((group) => group.country === nextCountry)?.cities || [];
    setCity((current) => allowed.includes(current) ? current : '');
  };
  async function submit(event) {
    event.preventDefault(); setValidation('');
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const data = { name: values.name.trim(), city: values.city.trim(), country: values.country, category: values.category, address: values.address.trim() };
    if (data.name.length < 2 || !cities.includes(data.city) || data.country !== country || data.address.length < 3) { setValidation('Συμπληρώστε όνομα, πόλη και πλήρη διεύθυνση'); return; }
    if (busy || photoChecking) return;
    if (salon) { data.description = values.description.trim(); data.cancellationHours = Number(values.cancellationHours); }
    await onSubmit(data, photo);
  }
  return <form className="lb-form" onSubmit={submit}><Field label="Όνομα επιχείρησης"><input name="name" defaultValue={salon?.name || ''} onChange={(event) => setPreviewName(event.target.value)} required minLength={2} maxLength={100} placeholder="π.χ. Το κομμωτήριό σας" /></Field><div className="lb-form-grid"><Field label="Χώρα"><select name="country" value={country} onChange={(event) => changeCountry(event.target.value)}>{locationGroups.map((group) => <option key={group.country}>{group.country}</option>)}</select></Field><Field label="Πόλη"><select name="city" required value={city} onChange={(event) => setCity(event.target.value)}><option value="" disabled>Επιλέξτε πόλη</option>{cities.map((place) => <option key={place} value={place}>{place}</option>)}</select></Field></div><Field label="Κύρια κατηγορία"><select name="category" defaultValue={salon?.category || 'hair'}>{categories.filter((category) => category.id !== 'all').map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></Field><Field label="Διεύθυνση"><input name="address" required minLength={3} maxLength={240} defaultValue={salon?.address || ''} placeholder="Οδός, αριθμός και ταχυδρομικός κώδικας" /></Field>{salon && <><Field label="Λίγα λόγια για τον χώρο σας"><textarea name="description" rows={4} maxLength={3000} defaultValue={salon.description || ''} /></Field><SalonPhotoField salon={salon} name={previewName} city={city} country={country} file={photo} onChange={setPhoto} disabled={busy} onChecking={setPhotoChecking} /><Field label="Δωρεάν ακύρωση έως και (ώρες πριν)"><input name="cancellationHours" type="number" min="0" max="168" step="1" required defaultValue={salon.cancellationHours ?? 24} /></Field><p className="lb-note">Ο ιδιοκτήτης μπορεί να ακυρώσει μια κράτηση και μετά το όριο της πολιτικής ακύρωσης</p></>}<Message error>{validation}</Message><button type="submit" className="lb-primary" disabled={busy || photoChecking}>{busy ? <Spinner text="Αποθήκευση…" /> : <><Check size={17} />{salon ? 'Αποθήκευση αλλαγών' : 'Δημιουργία πρόχειρης επιχείρησης'}</>}</button></form>;
}

function ServiceForm({ service, busy, onSubmit }) {
  const [validation, setValidation] = useState('');
  async function submit(event) {
    event.preventDefault(); setValidation('');
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const entry = { ...(service?.id ? { id: service.id } : {}), name: values.name.trim(), duration: Number(values.duration), price: Number(values.price), active: values.active === 'on' };
    if (entry.name.length < 2 || !Number.isFinite(entry.price) || entry.price < 0 || !Number.isInteger(entry.duration) || entry.duration < 5) { setValidation('Ελέγξτε το όνομα, τη διάρκεια και την τιμή της υπηρεσίας'); return; }
    await onSubmit(entry);
  }
  return <form className="lb-form" onSubmit={submit}><Field label="Όνομα υπηρεσίας"><input name="name" required minLength={2} maxLength={100} defaultValue={service?.name || ''} placeholder="π.χ. Κούρεμα & χτένισμα" /></Field><div className="lb-form-grid"><Field label="Διάρκεια (λεπτά)"><input name="duration" type="number" min="5" max="480" step="5" required defaultValue={service?.duration || 30} /></Field><Field label="Τιμή (€)"><input name="price" type="number" min="0" max="10000" step="0.01" required defaultValue={service?.price ?? ''} placeholder="35,00" /></Field></div><label className="lb-checkbox"><input type="checkbox" name="active" defaultChecked={service?.active ?? true} />Διαθέσιμη για online κρατήσεις</label><p className="lb-note">Οι υπάρχουσες κρατήσεις κρατούν την τιμή και τη διάρκεια που ίσχυαν κατά την κράτηση</p><Message error>{validation}</Message><button className="lb-primary" type="submit" disabled={busy}>{busy ? <Spinner text="Αποθήκευση…" /> : 'Αποθήκευση υπηρεσίας'}</button></form>;
}

function StaffForm({ staff, busy, onSubmit }) {
  const [validation, setValidation] = useState('');
  async function submit(event) { event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get('name')).trim(); if (name.length < 2) { setValidation('Συμπληρώστε τουλάχιστον 2 χαρακτήρες για το όνομα'); return; } await onSubmit({ ...(staff?.id ? { id: staff.id } : {}), name, active: form.get('active') === 'on' }); }
  return <form className="lb-form" onSubmit={submit}><Field label="Όνομα επαγγελματία"><input name="name" required minLength={2} maxLength={100} defaultValue={staff?.name || ''} placeholder="π.χ. Ελένη Παπαδοπούλου" /></Field><label className="lb-checkbox"><input name="active" type="checkbox" defaultChecked={staff?.active ?? true} />Διαθέσιμος/η για online ραντεβού</label><p className="lb-note">Κάθε ενεργό μέλος της ομάδας μπορεί να παρέχει τις ενεργές υπηρεσίες της επιχείρησης. Ορίστε και το προσωπικό του ωράριο</p><Message error>{validation}</Message><button type="submit" className="lb-primary" disabled={busy}>{busy ? <Spinner text="Αποθήκευση…" /> : 'Αποθήκευση επαγγελματία'}</button></form>;
}

function HoursEditor({ staff, hours, busy, onSubmit }) {
  const [rows, setRows] = useState(() => Object.fromEntries(weekdays.map(([day]) => [day, hours.filter((entry) => Number(entry.weekday) === day).map((entry) => ({ opens_at: entry.opens_at.slice(0, 5), closes_at: entry.closes_at.slice(0, 5) }))])));
  const [validation, setValidation] = useState('');
  function change(day, index, key, value) { setRows((current) => ({ ...current, [day]: current[day].map((entry, position) => position === index ? { ...entry, [key]: value } : entry) })); }
  async function submit(event) {
    event.preventDefault(); setValidation('');
    const result = [];
    for (const [day, label] of weekdays) {
      const entries = [...rows[day]].sort((a, b) => a.opens_at.localeCompare(b.opens_at));
      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        if (!entry.opens_at || !entry.closes_at || entry.closes_at <= entry.opens_at) { setValidation(`Ελέγξτε τις ώρες για την ${label}. Η λήξη πρέπει να είναι μετά την έναρξη`); return; }
        if (index > 0 && entry.opens_at < entries[index - 1].closes_at) { setValidation(`Τα διαστήματα για την ${label} δεν μπορούν να επικαλύπτονται`); return; }
        result.push({ weekday: day, ...entry });
      }
    }
    await onSubmit(result);
  }
  return <form className="lb-hours-editor" onSubmit={submit}><h3>Ωράριο · {staff.name}</h3><p className="lb-note">Κενή ημέρα σημαίνει κλειστά. Προσθέστε δύο διαστήματα για διάλειμμα μέσα στη μέρα. Οι ώρες είναι τοπικές για την επιχείρηση</p>{weekdays.map(([day, label]) => <div className="lb-hours-day" key={day}><strong>{label}</strong><div className="lb-hours-intervals">{rows[day].length === 0 && <span className="lb-hours-closed">Κλειστά</span>}{rows[day].map((entry, index) => <div className="lb-hours-interval" key={index}><input aria-label={`${label}, έναρξη ${index + 1}`} type="time" required value={entry.opens_at} onChange={(event) => change(day, index, 'opens_at', event.target.value)} /><span>—</span><input aria-label={`${label}, λήξη ${index + 1}`} type="time" required value={entry.closes_at} onChange={(event) => change(day, index, 'closes_at', event.target.value)} /><button type="button" className="lb-icon-button" aria-label={`Αφαίρεση διαστήματος ${label}`} disabled={busy} onClick={() => setRows((current) => ({ ...current, [day]: current[day].filter((_, position) => position !== index) }))}><X size={16} /></button></div>)}<button className="lb-text-button" type="button" disabled={busy || rows[day].length >= 4} onClick={() => setRows((current) => ({ ...current, [day]: [...current[day], { opens_at: current[day].length ? '' : '09:00', closes_at: current[day].length ? '' : '17:00' }] }))}><Plus size={13} />Διάστημα</button></div></div>)}<Message error>{validation}</Message><button className="lb-primary" type="submit" disabled={busy}>{busy ? <Spinner text="Αποθήκευση…" /> : 'Αποθήκευση ωραρίου'}</button></form>;
}

function TimeOffForm({ staff, timezone, busy, onSubmit }) {
  const [validation, setValidation] = useState('');
  async function submit(event) {
    event.preventDefault(); setValidation('');
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const starts_at = localDateTimeToISO(values.starts, timezone); const ends_at = localDateTimeToISO(values.ends, timezone);
      if (Date.parse(ends_at) <= Date.parse(starts_at)) throw new Error('Η λήξη της απουσίας πρέπει να είναι μετά την έναρξη');
      await onSubmit({ starts_at, ends_at, reason: values.reason.trim() });
    } catch (error) { setValidation(errorText(error)); }
  }
  return <form className="lb-form" onSubmit={submit}><p className="lb-note">Απουσία για {staff.name}. Οι ώρες είναι τοπικές ({timezone}). Οι υπάρχουσες κρατήσεις δεν ακυρώνονται αυτόματα</p><Field label="Έναρξη απουσίας"><input name="starts" type="datetime-local" step="900" required /></Field><Field label="Λήξη απουσίας"><input name="ends" type="datetime-local" step="900" required /></Field><Field label="Σημείωση (προαιρετική)"><input name="reason" maxLength={240} placeholder="π.χ. Άδεια" /></Field><Message error>{validation}</Message><button className="lb-primary" type="submit" disabled={busy}>{busy ? <Spinner text="Αποθήκευση…" /> : 'Καταχώριση απουσίας'}</button></form>;
}

function ManualBookingForm({ booking, salon, date, timezone, bookings, busy, onSubmit, initialTime = '09:00', initialStaffId = '' }) {
  const services = salon.services.filter((entry) => entry.active);
  const staff = salon.staff.filter((entry) => entry.active);
  const initialService = services.find((entry) => entry.id === booking?.service.id) || services[0];
  const [serviceId, setServiceId] = useState(initialService?.id || '');
  const [staffId, setStaffId] = useState(staff.some((entry) => entry.id === booking?.staffId) ? booking.staffId : staff.some((entry) => entry.id === initialStaffId) ? initialStaffId : staff[0]?.id || '');
  const [duration, setDuration] = useState(booking?.service.duration ?? initialService?.duration ?? 30);
  const [price, setPrice] = useState(booking?.service.price ?? initialService?.price ?? '');
  const [validation, setValidation] = useState('');
  const requestId = useRef(crypto.randomUUID());
  const today = dateInZone(new Date(), timezone);
  const chooseService = (nextId) => {
    setServiceId(nextId);
    const service = services.find((entry) => entry.id === nextId);
    if (service) { setDuration(service.duration); setPrice(service.price); }
  };
  async function submit(event) {
    event.preventDefault(); setValidation('');
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(values.time || '')) throw new Error('Συμπληρώστε την ημερομηνία και την ώρα του ραντεβού');
      const entry = {
        serviceId, staffId, startsAt: localDateTimeToISO(`${values.date}T${values.time}`, timezone),
        name: String(values.name || '').trim(), email: String(values.email || '').trim(),
        phone: String(values.phone || '').replace(/[\s().-]/g, ''), notes: String(values.notes || '').trim(),
        duration: Number(duration), price: Number(price),
      };
      if (!services.some((item) => item.id === serviceId) || !staff.some((item) => item.id === staffId)) throw new Error('Επιλέξτε ενεργή υπηρεσία και επαγγελματία');
      if (entry.name.length < 2) throw new Error('Συμπληρώστε το όνομα του πελάτη');
      if (!/^\+?[0-9]{8,15}$/.test(entry.phone)) throw new Error('Συμπληρώστε έγκυρο τηλέφωνο πελάτη με 8 έως 15 ψηφία');
      if (!Number.isInteger(entry.duration) || entry.duration < 5 || entry.duration > 480 || entry.duration % 5) throw new Error('Η διάρκεια πρέπει να είναι από 5 έως 480 λεπτά, σε βήματα των 5');
      if (String(price).trim() === '' || !Number.isFinite(entry.price) || entry.price < 0 || entry.price > 10000) throw new Error('Συμπληρώστε έγκυρη τιμή');
      const starts = Date.parse(entry.startsAt);
      const ends = starts + entry.duration * 60_000;
      if ((bookings || []).some((existing) => existing.id !== booking?.id && existing.staffId === entry.staffId && existing.status === 'confirmed' && Date.parse(existing.startsAt) < ends && Date.parse(existing.endsAt) > starts)) throw new Error('Ο επαγγελματίας έχει ήδη κράτηση σε αυτό το διάστημα. Επιλέξτε άλλη ώρα ή επαγγελματία');
      if ((salon.timeOff || []).some((absence) => absence.staff_id === entry.staffId && Date.parse(absence.starts_at) < ends && Date.parse(absence.ends_at) > starts)) throw new Error('Ο επαγγελματίας απουσιάζει σε αυτό το διάστημα. Επιλέξτε άλλη ώρα ή επαγγελματία');
      await onSubmit(entry, requestId.current);
    } catch (failure) { setValidation(errorText(failure)); }
  }
  return <form className="lb-form lb-manual-form" onSubmit={submit}>
    <p className="lb-note">Καταχωρίστε ένα τηλεφωνικό ή άλλο ραντεβού στον ίδιο χώρο εργασίας με τις online κρατήσεις. Ο χρόνος δεσμεύεται μόλις αποθηκευτεί επιτυχώς</p>
    <Field label="Όνομα πελάτη"><input name="name" required minLength={2} maxLength={100} autoComplete="name" defaultValue={booking?.name || ''} /></Field>
    <div className="lb-form-grid"><Field label="Email πελάτη (προαιρετικό)"><input name="email" type="email" maxLength={320} autoComplete="email" defaultValue={booking?.email || ''} /></Field><Field label="Τηλέφωνο πελάτη"><input name="phone" type="tel" required maxLength={40} autoComplete="tel" defaultValue={booking?.phone || ''} /></Field></div>
    <div className="lb-form-grid"><Field label="Υπηρεσία"><select required value={serviceId} onChange={(event) => chooseService(event.target.value)}>{!services.length && <option value="">Προσθέστε πρώτα υπηρεσία</option>}{services.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></Field><Field label="Επαγγελματίας"><select required value={staffId} onChange={(event) => setStaffId(event.target.value)}>{!staff.length && <option value="">Προσθέστε πρώτα επαγγελματία</option>}{staff.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></Field></div>
    <div className="lb-form-grid"><Field label="Ημερομηνία"><input name="date" type="date" required min={changeDay(today, -366)} max={changeDay(today, 366)} defaultValue={booking?.date || date} /></Field><Field label="Ώρα"><input name="time" type="time" required step="300" defaultValue={booking?.time || initialTime} /></Field></div>
    <div className="lb-form-grid"><Field label="Διάρκεια (λεπτά)"><input name="duration" type="number" required min="5" max="480" step="5" value={duration} onChange={(event) => setDuration(event.target.value)} /></Field><Field label="Τιμή (€)"><input name="price" type="number" required min="0" max="10000" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} /></Field></div>
    <Field label="Σημειώσεις (προαιρετικές)"><textarea name="notes" rows={3} maxLength={1000} defaultValue={booking?.notes || ''} /></Field>
    <p className="lb-note">Οι ώρες αφορούν τη ζώνη της επιχείρησής σας ({timezone}). Επιτρέπεται χειροκίνητη κράτηση εκτός του online ωραρίου, αλλά δεν μπορεί να επικαλύπτει άλλη κράτηση ή απουσία. Δεν αποστέλλεται αυτόματο email για χειροκίνητες κρατήσεις</p>
    <Message error>{validation}</Message>
    <button className="lb-primary" type="submit" disabled={busy || !services.length || !staff.length}>{busy ? <Spinner text="Αποθήκευση…" /> : <><Check size={17} />{booking ? 'Αποθήκευση αλλαγών' : 'Προσθήκη ραντεβού'}</>}</button>
  </form>;
}

function RescheduleForm({ booking, salon, busy, onSubmit }) {
  const [date, setDate] = useState(booking.date);
  const [staffId, setStaffId] = useState(booking.staffId || '');
  const [slots, setSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setSelectedSlot(null); setSlots([]);
    getSlots(booking.service.id, date, staffId || null).then((data) => { if (active) setSlots(data); }).catch((failure) => { if (active) setError(errorText(failure)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [booking.service.id, date, staffId]);
  return <form className="lb-form" onSubmit={async (event) => { event.preventDefault(); if (selectedSlot) await onSubmit({ bookingId: booking.id, staffId: selectedSlot.staffId, startsAt: selectedSlot.startsAt }); }}><p className="lb-note">{booking.name} · {booking.service.name}. Η υπάρχουσα κράτηση αλλάζει μόνο εφόσον η νέα ώρα επιβεβαιωθεί από τον διακομιστή</p><div className="lb-form-grid"><Field label="Νέα ημερομηνία"><input type="date" required min={dateInZone(new Date(), salon.timezone)} max={changeDay(dateInZone(new Date(), salon.timezone), 90)} value={date} onChange={(event) => setDate(event.target.value)} /></Field><Field label="Επαγγελματίας"><select value={staffId} onChange={(event) => setStaffId(event.target.value)}><option value="">Οποιοσδήποτε διαθέσιμος</option>{salon.staff.filter((member) => member.active).map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select></Field></div>{loading ? <Spinner text="Έλεγχος διαθεσιμότητας…" /> : <><Message error>{error}</Message><div className="lb-slot-grid">{slots.map((slot) => <button key={`${slot.staffId}-${slot.startsAt}`} type="button" className={selectedSlot?.staffId === slot.staffId && selectedSlot?.startsAt === slot.startsAt ? 'lb-slot-selected' : ''} onClick={() => setSelectedSlot(slot)}><strong>{slot.time}</strong><span>{slot.staffName}</span></button>)}</div>{!error && !slots.length && <p className="lb-note">Δεν υπάρχουν διαθέσιμες ώρες. Επιλέξτε άλλη ημέρα ή επαγγελματία</p>}</>}<button className="lb-primary" type="submit" disabled={busy || loading || !selectedSlot}>{busy ? <Spinner text="Επιβεβαίωση…" /> : 'Επιβεβαίωση νέας ώρας'}</button></form>;
}

export default function LiveBusiness({ onBack }) {
  const { user, profile, loading: accountLoading, signOut } = useAccount();
  const [authOpen, setAuthOpen] = useState(false);
  const [salons, setSalons] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [tab, setTab] = useState('calendar');
  const [date, setDate] = useState(() => dateInZone());
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState(null);
  const [staffId, setStaffId] = useState('');
  const [paidAtVenue, setPaidAtVenue] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const ownerRequest = useRef(0);
  const calendarRequest = useRef(0);
  const mutationLock = useRef(false);
  const salon = salons.find((item) => item.id === selectedId);
  const timezone = salon?.timezone || timezoneFor(salon?.country);
  const staff = salon?.staff.find((member) => member.id === staffId) || salon?.staff[0];
  const verified = Boolean(user?.email_confirmed_at || user?.confirmed_at);

  const loadSalons = useCallback(async (quiet = false) => {
    if (!user?.id || !verified) return false;
    const request = ++ownerRequest.current;
    if (!quiet) setLoading(true);
    try {
      const data = await listOwnSalons();
      if (request === ownerRequest.current) { setSalons(data); setSelectedId((current) => data.some((item) => item.id === current) ? current : data[0]?.id || ''); }
      return true;
    } catch (failure) { if (request === ownerRequest.current) setError(errorText(failure)); return false; }
    finally { if (request === ownerRequest.current) setLoading(false); }
  }, [user?.id, verified]);

  const loadCalendar = useCallback(async (quiet = false) => {
    if (!user?.id || !verified || !selectedId) return false;
    const request = ++calendarRequest.current;
    if (!quiet) setCalendarLoading(true);
    try { const data = await listBusinessBookings(selectedId, date); if (request === calendarRequest.current) setBookings(data); return true; }
    catch (failure) { if (request === calendarRequest.current) setError(errorText(failure)); return false; }
    finally { if (request === calendarRequest.current) setCalendarLoading(false); }
  }, [user?.id, verified, selectedId, date]);

  const refreshAfterNotification = useCallback(async () => { await Promise.all([loadCalendar(true), loadSalons(true)]); }, [loadCalendar, loadSalons]);
  const notifications = useBusinessNotifications({ salonId: salon?.id, userId: user?.id, verified, onChanged: refreshAfterNotification });
  useEffect(() => { setCancelReason(''); }, [modal?.kind, modal?.booking?.id]);

  useEffect(() => { setModal(null); setNotice(''); setStaffId(''); setSalons([]); setSelectedId(''); setBookings([]); setError(''); if (user?.id && verified) { setAuthOpen(false); loadSalons(); } return () => { ownerRequest.current++; calendarRequest.current++; }; }, [user?.id, verified, loadSalons]);
  useEffect(() => { setBookings([]); setError(''); if (selectedId) loadCalendar(); return () => { calendarRequest.current++; }; }, [selectedId, date, loadCalendar]);
  useEffect(() => {
    if (!user?.id || !verified) return undefined;
    const refresh = () => { if (document.visibilityState !== 'hidden' && !mutationLock.current) { loadSalons(true); if (selectedId && tab === 'calendar') loadCalendar(true); } };
    const interval = setInterval(refresh, 20000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(interval); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [user?.id, verified, selectedId, tab, loadSalons, loadCalendar]);

  async function perform(key, action, success, close = true) {
    if (mutationLock.current) return false;
    mutationLock.current = true; setBusy(key); setError(''); setNotice('');
    try {
      const result = await action();
      if (close) setModal(null);
      setNotice(success);
      await loadSalons(true);
      if (selectedId) await loadCalendar(true);
      return result || true;
    } catch (failure) { setError(errorText(failure)); return false; }
    finally { mutationLock.current = false; setBusy(''); }
  }

  const activeBookings = bookings.filter((booking) => booking.status === 'confirmed');
  const received = bookings.filter((booking) => booking.paymentStatus === 'paid').reduce((sum, booking) => sum + booking.service.price, 0);
  const hours = salon?.hours.filter((entry) => entry.staff_id === staff?.id) || [];
  const readyChecklist = salon ? [Boolean(salon.address?.trim()), salon.services.some((entry) => entry.active), salon.staff.some((member) => member.active), salon.staff.some((member) => member.active && salon.hours.some((entry) => entry.staff_id === member.id))] : [];
  const readyToSubmit = readyChecklist.every(Boolean);
  const bookingDetail = modal?.kind === 'booking' ? bookings.find((booking) => booking.id === modal.booking.id) || modal.booking : null;

  return <main className="live-business">
    <header className="lb-topbar"><button className="lb-back" onClick={onBack}><ArrowLeft size={17} />Στην εξερεύνηση</button><Logo /><div className="lb-top-actions"><a className="lb-help-link" href="#guide-business" aria-label="Βίντεο οδηγιών"><PlayCircle size={16} /><span>Βίντεο οδηγιών</span></a>{user && verified && salon && <NotificationButton notifications={notifications} onClick={() => setTab('notifications')} />}</div></header>
    {accountLoading ? <div className="lb-centered"><Spinner text="Έλεγχος λογαριασμού…" /></div> : !user || !verified ? <section className="lb-auth-intro"><div className="lb-auth-art"><Scissors size={38} /><span>Ο ΧΩΡΟΣ ΣΑΣ. ΟΙ ΑΝΘΡΩΠΟΙ ΣΑΣ</span><h1>Περισσότερος χρόνος<br />για ό,τι αγαπάτε</h1><p>Υπηρεσίες, ομάδα και πραγματικά ραντεβού, σε ένα μέρος</p></div><div className="lb-auth-copy"><span className="lb-eyebrow">ENERES ΓΙΑ ΕΠΑΓΓΕΛΜΑΤΙΕΣ</span><h2>{user ? 'Επιβεβαιώστε το email σας' : 'Η επιχείρησή σας ξεκινά εδώ'}</h2><p>{user ? 'Ανοίξτε τον σύνδεσμο επιβεβαίωσης που λάβατε στο email σας για να διαχειριστείτε την επιχείρησή σας' : 'Συνδεθείτε ή δημιουργήστε λογαριασμό για να προσθέσετε τον χώρο σας, να ορίσετε διαθεσιμότητα και να δέχεστε κρατήσεις'}</p><button className="lb-primary" onClick={() => setAuthOpen(true)}>{user ? 'Ο λογαριασμός μου' : 'Σύνδεση / Δημιουργία λογαριασμού'}<ArrowRight size={17} /></button><p className="lb-note">Η πληρωμή γίνεται στο κατάστημα. Οι επιχειρήσεις εμφανίζονται στην αναζήτηση μετά από έλεγχο</p>{user && <button className="lb-text-button" onClick={async () => { try { await signOut(); } catch (failure) { setError(errorText(failure)); } }}>Αποσύνδεση</button>}<Message error>{error}</Message></div></section> : <>
      <div className="lb-account-bar"><span>Καλώς ήρθατε, {profile?.name || user.email}</span><div><button className="lb-text-button" onClick={() => setAuthOpen(true)}>Ο λογαριασμός μου</button><button className="lb-text-button" disabled={Boolean(busy)} onClick={async () => { try { await signOut(); } catch (failure) { setError(errorText(failure)); } }}><LogOut size={14} />Αποσύνδεση</button></div></div>
      <div className="lb-global-messages"><Message error>{error}</Message><Message>{notice}</Message><NotificationToast notifications={notifications} onOpen={() => setTab('notifications')} /></div>
      {loading && !salons.length ? <div className="lb-centered"><Spinner text="Φόρτωση επιχειρήσεων…" /></div> : !salons.length ? <section className="lb-onboarding"><span className="lb-eyebrow">ΕΝΑ ΝΕΟ ΚΕΦΑΛΑΙΟ ΓΙΑ ΤΟΝ ΧΩΡΟ ΣΑΣ</span><h1>Ας γνωρίσουμε<br />την επιχείρησή σας</h1><p>Ξεκινήστε με τα βασικά. Στη συνέχεια προσθέστε υπηρεσίες, επαγγελματίες και το ωράριό τους</p><div className="lb-onboarding-form"><SalonForm busy={Boolean(busy)} onSubmit={async (values) => { const result = await perform('create-salon', () => createSalon(values), "Το πρόχειρο της επιχείρησής σας δημιουργήθηκε. Προσθέστε υπηρεσίες και ωράριο"); if (result?.id) { setSelectedId(result.id); setTab('settings'); } }} /></div></section> : <div className="lb-layout">
        <aside className="lb-sidebar"><span className="lb-eyebrow">Η ΕΠΙΧΕΙΡΗΣΗ ΣΑΣ</span><label className="lb-salon-select"><span className="lb-sr-only">Επιλογή επιχείρησης</span><select value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setStaffId(''); setNotice(''); }}>{salons.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>{salon && <><span className={`lb-salon-status lb-salon-${salon.status}`}>{salonStatuses[salon.status] || salon.status}</span><span className="lb-salon-location"><MapPin size={12} />{salon.city}, {salon.country}</span></>}<nav aria-label="Διαχείριση επιχείρησης">{[['calendar', CalendarDays, 'Ημερολόγιο'], ['notifications', Bell, 'Ιστορικό κρατήσεων'], ['services', Scissors, 'Υπηρεσίες'], ['team', Users, 'Ομάδα & ωράριο'], ['billing', Euro, 'Η συνδρομή σας'], ['settings', Settings2, 'Η επιχείρησή μου']].map(([id, Icon, label]) => <button key={id} className={tab === id ? 'lb-nav-active' : ''} onClick={() => { setTab(id); setNotice(''); }} aria-current={tab === id ? 'page' : undefined}><Icon size={18} />{label}</button>)}</nav><button className="lb-text-button lb-add-salon" onClick={() => setModal({ kind: 'salon' })}><Plus size={15} />Προσθήκη επιχείρησης</button><div className="lb-sidebar-note"><ShieldCheck size={22} /><strong>Πληρωμή στον χώρο σας</strong><p>Τα ποσά αφορούν υπηρεσίες στο κατάστημα. Η καταχώριση εξόφλησης δεν χρεώνει ηλεκτρονικά τον πελάτη</p></div></aside>
        {salon && <section className="lb-content">
          <header className="lb-content-heading"><div><span className="lb-eyebrow">{salon.name}</span><h1>{tab === 'calendar' ? 'Το ημερολόγιο σας' : tab === 'services' ? 'Η φροντίδα που προσφέρετε' : tab === 'team' ? 'Οι άνθρωποι πίσω από τη φροντίδα' : tab === 'billing' ? 'Η συνδρομή σας' : tab === 'notifications' ? 'Κρατήσεις από το Eneres' : 'Ο χώρος σας, με τα λόγια σας'}</h1><p>{tab === 'calendar' ? "Πραγματικές κρατήσεις. Λίγη περισσότερη οργάνωση" : tab === 'services' ? 'Ορίστε υπηρεσίες, τιμές και διάρκεια' : tab === 'team' ? 'Διαθεσιμότητα που ταιριάζει στην ομάδα σας' : tab === 'billing' ? 'Μηνιαία συνδρομή και ιστορικό πληρωμών' : tab === 'notifications' ? 'Νέες κρατήσεις, ενημερώσεις και στοιχεία πελατών' : 'Πληροφορίες, πολιτική ακύρωσης και δημοσίευση'}</p></div><button className="lb-icon-button" aria-label="Ανανέωση δεδομένων" disabled={Boolean(busy) || loading || calendarLoading} onClick={() => { setError(''); loadSalons(true); if (tab === 'calendar') loadCalendar(); }}><RefreshCw size={18} /></button></header>
          {tab === 'calendar' && <>
            <div className="lb-stats"><div><CalendarDays size={20} /><strong>{activeBookings.length}</strong><span>επιβεβαιωμένα ραντεβού</span></div><div><CheckCircle2 size={20} /><strong>{bookings.filter((entry) => entry.status === 'completed').length}</strong><span>ολοκληρωμένα</span></div><div><Euro size={20} /><strong>{money(received)}</strong><span>καταχωρισμένες εξοφλήσεις</span></div></div>
            <section className="lb-card lb-calendar"><div className="lb-calendar-toolbar"><div><h2>Ημερολόγιο</h2><span>{readableDate(`${date}T12:00:00Z`, timezone, { weekday: 'long', year: 'numeric' })}</span></div><div className="lb-calendar-actions"><button type="button" className="lb-primary lb-compact lb-new-booking" disabled={Boolean(busy) || !salon.services.some((entry) => entry.active) || !salon.staff.some((entry) => entry.active)} onClick={() => { setError(''); setModal({ kind: 'manual' }); }}><Plus size={16} />Νέο ραντεβού</button><div className="lb-calendar-date-controls"><button type="button" className="lb-icon-button" aria-label="Προηγούμενη ημέρα" onClick={() => setDate(changeDay(date, -1))}><ChevronLeft size={18} /></button><input aria-label="Ημερομηνία ημερολογίου" type="date" value={date} onChange={(event) => { if (event.target.value) setDate(event.target.value); }} /><button className="lb-icon-button" aria-label="Επόμενη ημέρα" onClick={() => setDate(changeDay(date, 1))}><ChevronRight size={18} /></button><button className="lb-text-button" onClick={() => setDate(dateInZone(new Date(), timezone))}>Σήμερα</button></div></div></div>
              {calendarLoading ? <div className="lb-centered"><Spinner text="Φόρτωση ραντεβού…" /></div> : <BusinessTimeline salon={salon} date={date} timezone={timezone} bookings={bookings} onDateChange={setDate} disabled={Boolean(busy)} onSelectBooking={(booking) => { setPaidAtVenue(booking.paymentStatus === 'paid'); setModal({ kind: 'booking', booking }); }} onCreate={({ time, staffId: selectedStaff }) => { setError(''); setModal({ kind: 'manual', initialTime: time, initialStaffId: selectedStaff }); }} />}
            </section><p className="lb-note">Τοπική ώρα: {timezone}. Το ημερολόγιο ανανεώνεται αυτόματα όσο η σελίδα είναι ορατή</p>
          </>}
          {tab === 'notifications' && <BusinessNotifications salon={salon} notifications={notifications} />}
          {tab === 'services' && <section className="lb-card"><div className="lb-section-heading"><h2>Οι υπηρεσίες σας</h2><button className="lb-primary lb-compact" onClick={() => setModal({ kind: 'service' })}><Plus size={16} />Νέα υπηρεσία</button></div>{salon.services.length ? <div className="lb-record-list">{salon.services.map((service) => <article className="lb-record" key={service.id}><span className="lb-record-icon"><Scissors size={19} /></span><div><strong>{service.name}</strong><span>{service.duration} λεπτά · {service.active ? 'Ενεργή' : 'Ανενεργή'}</span></div><strong>{money(service.price)}</strong><button className="lb-text-button" onClick={() => setModal({ kind: 'service', service })}>Επεξεργασία</button></article>)}</div> : <div className="lb-empty"><Scissors size={32} /><h3>Κάθε υπηρεσία, μια στιγμή φροντίδας</h3><p>Προσθέστε την πρώτη υπηρεσία σας για να ορίσετε τιμή και διάρκεια</p></div>}</section>}
          {tab === 'team' && <><section className="lb-card"><div className="lb-section-heading"><h2>Η ομάδα σας</h2><button className="lb-primary lb-compact" onClick={() => setModal({ kind: 'staff' })}><Plus size={16} />Νέος επαγγελματίας</button></div>{salon.staff.length ? <><div className="lb-staff-tabs">{salon.staff.map((member) => <button className={member.id === staff?.id ? 'lb-staff-selected' : ''} key={member.id} onClick={() => setStaffId(member.id)}><span>{member.name.slice(0, 1)}</span><strong>{member.name}</strong>{!member.active && <small>Ανενεργός/ή</small>}</button>)}</div>{staff && <div className="lb-team-toolbar"><span>{staff.active ? 'Διαθέσιμος/η για online κρατήσεις' : 'Δεν δέχεται νέες online κρατήσεις'}</span><button className="lb-text-button" onClick={() => setModal({ kind: 'staff', staff })}>Επεξεργασία επαγγελματία</button></div>}</> : <div className="lb-empty"><Users size={32} /><h3>Γνωρίστε μας την ομάδα σας</h3><p>Προσθέστε τουλάχιστον έναν επαγγελματία και ορίστε το ωράριό του</p></div>}</section>{staff && <><section className="lb-card"><HoursEditor key={`${staff.id}-${JSON.stringify(hours)}`} staff={staff} hours={hours} busy={Boolean(busy)} onSubmit={(entries) => perform('hours', () => saveHours(staff.id, entries), 'Το ωράριο αποθηκεύτηκε', false)} /></section><section className="lb-card"><div className="lb-section-heading"><div><h2>Άδειες & απουσίες</h2><p>{staff.name} · {timezone}</p></div><button className="lb-secondary lb-compact" onClick={() => setModal({ kind: 'timeoff', staff })}><Plus size={16} />Νέα απουσία</button></div>{salon.timeOff.filter((entry) => entry.staff_id === staff.id).length ? <div className="lb-record-list">{salon.timeOff.filter((entry) => entry.staff_id === staff.id).sort((a, b) => a.starts_at.localeCompare(b.starts_at)).map((entry) => <article className="lb-record lb-timeoff-record" key={entry.id}><Clock3 size={19} /><div><strong>{readableDate(entry.starts_at, timezone, { hour: '2-digit', minute: '2-digit' })} – {readableDate(entry.ends_at, timezone, { hour: '2-digit', minute: '2-digit' })}</strong><span>{entry.reason || 'Απουσία'}</span></div><button type="button" className="lb-icon-button lb-danger" aria-label="Διαγραφή απουσίας" disabled={Boolean(busy)} onClick={() => perform('delete-timeoff', () => deleteTimeOff(entry.id), 'Η απουσία αφαιρέθηκε', false)}><Trash2 size={17} /></button></article>)}</div> : <p className="lb-note">Δεν έχουν καταχωριστεί απουσίες για αυτόν τον επαγγελματία</p>}</section></>}</>}
          {tab === 'billing' && <BusinessBilling key={salon.id} salon={salon} />}
          {tab === 'settings' && <><section className="lb-card"><div className="lb-section-heading"><h2>Στοιχεία επιχείρησης</h2></div><SalonForm key={JSON.stringify([salon.id, salon.name, salon.description, salon.address, salon.cancellationHours, salon.city, salon.country, salon.category, salon.imageUrl])} salon={salon} busy={Boolean(busy)} onSubmit={(patch, photo) => perform('salon-settings', () => saveSalonWithPhoto(salon, patch, photo), 'Τα στοιχεία της επιχείρησης αποθηκεύτηκαν', false)} /></section><section className="lb-card lb-publication"><div className="lb-section-heading"><h2>Δημοσίευση επιχείρησης</h2><span className={`lb-salon-status lb-salon-${salon.status}`}>{salonStatuses[salon.status] || salon.status}</span></div><p>Η επιχείρησή σας ελέγχεται πριν εμφανιστεί δημόσια. Συμπληρώστε τα παρακάτω και στείλτε την για έλεγχο</p><ul>{['Πλήρης διεύθυνση επιχείρησης', 'Τουλάχιστον μία ενεργή υπηρεσία', 'Τουλάχιστον ένας ενεργός επαγγελματίας', 'Ωράριο ενεργού επαγγελματία'].map((label, index) => <li className={readyChecklist[index] ? 'lb-check-ready' : ''} key={label}>{readyChecklist[index] ? <CheckCircle2 size={17} /> : <span className="lb-check-empty" />}{label}</li>)}</ul>{salon.status === 'pending' ? <Message>Η επιχείρησή σας έχει υποβληθεί. Θα εμφανιστεί στην αναζήτηση μετά την έγκριση</Message> : salon.status === 'published' ? <Message>Η επιχείρησή σας είναι δημοσιευμένη και μπορεί να δέχεται online κρατήσεις</Message> : salon.status === 'suspended' ? <p className="lb-note">Η επιχείρηση βρίσκεται σε αναστολή. Επικοινωνήστε με τον διαχειριστή για επανενεργοποίηση</p> : <button className="lb-primary" disabled={!readyToSubmit || Boolean(busy)} onClick={() => perform('submit-salon', () => submitSalon(salon.id), 'Η επιχείρησή σας στάλθηκε για έλεγχο', false)}>{busy === 'submit-salon' ? <Spinner text="Υποβολή…" /> : <><ShieldCheck size={17} />Υποβολή για έλεγχο</>}</button>}</section></>}
        </section>}
      </div>}
    </>}
    {modal?.kind === 'manual' && salon && <Modal title={modal.booking ? 'Επεξεργασία χειροκίνητου ραντεβού' : 'Νέο χειροκίνητο ραντεβού'} busy={Boolean(busy)} onClose={() => setModal(null)}><ManualBookingForm key={modal.booking?.id || 'new'} booking={modal.booking} salon={salon} date={date} timezone={timezone} bookings={bookings} busy={Boolean(busy)} initialTime={modal.initialTime} initialStaffId={modal.initialStaffId} onSubmit={async (entry, requestId) => {
      const saved = await perform('manual-booking', () => modal.booking ? editManualBooking(modal.booking.id, entry) : createManualBooking(salon.id, entry, requestId), modal.booking ? 'Οι αλλαγές στο ραντεβού αποθηκεύτηκαν' : 'Το ραντεβού καταχωρίστηκε και ο χρόνος δεσμεύτηκε');
      if (saved?.date && saved.date !== date) setDate(saved.date);
    }} /><Message error>{error}</Message></Modal>}
    {modal?.kind === 'salon' && <Modal title="Νέα επιχείρηση" busy={Boolean(busy)} onClose={() => setModal(null)}><SalonForm busy={Boolean(busy)} onSubmit={async (values) => { const result = await perform('create-salon', () => createSalon(values), 'Η επιχείρηση δημιουργήθηκε ως πρόχειρο'); if (result?.id) { setSelectedId(result.id); setTab('settings'); } }} /></Modal>}
    {modal?.kind === 'service' && salon && <Modal title={modal.service ? 'Επεξεργασία υπηρεσίας' : 'Νέα υπηρεσία'} busy={Boolean(busy)} onClose={() => setModal(null)}><ServiceForm service={modal.service} busy={Boolean(busy)} onSubmit={(entry) => perform('service', () => saveService(salon.id, entry), 'Η υπηρεσία αποθηκεύτηκε')} /><Message error>{error}</Message></Modal>}
    {modal?.kind === 'staff' && salon && <Modal title={modal.staff ? 'Επεξεργασία επαγγελματία' : 'Νέος επαγγελματίας'} busy={Boolean(busy)} onClose={() => setModal(null)}><StaffForm staff={modal.staff} busy={Boolean(busy)} onSubmit={async (entry) => { const result = await perform('staff', () => saveStaff(salon.id, entry), "Ο επαγγελματίας αποθηκεύτηκε. Ορίστε και το ωράριό του"); if (result?.id) setStaffId(result.id); }} /><Message error>{error}</Message></Modal>}
    {modal?.kind === 'timeoff' && salon && <Modal title="Καταχώριση απουσίας" busy={Boolean(busy)} onClose={() => setModal(null)}><TimeOffForm staff={modal.staff} timezone={timezone} busy={Boolean(busy)} onSubmit={(entry) => perform('timeoff', () => saveTimeOff(modal.staff.id, entry), 'Η απουσία καταχωρίστηκε')} /><Message error>{error}</Message></Modal>}
    {bookingDetail && <Modal title="Λεπτομέρειες ραντεβού" busy={Boolean(busy)} onClose={() => setModal(null)}><div className="lb-booking-detail-person"><span>{bookingDetail.name?.slice(0, 1)}</span><h3>{bookingDetail.name}</h3><p>{bookingDetail.email || 'Χωρίς email'}</p>{bookingDetail.phone && <p><a href={`tel:${bookingDetail.phone.replace(/[^+0-9]/g, '')}`}>{bookingDetail.phone}</a></p>}</div><dl className="lb-detail-list"><div><dt>Υπηρεσία</dt><dd>{bookingDetail.service.name}</dd></div><div><dt>Επαγγελματίας</dt><dd>{bookingDetail.staff}</dd></div><div><dt>Ημερομηνία & ώρα</dt><dd>{readableDate(bookingDetail.startsAt, timezone, { hour: '2-digit', minute: '2-digit' })}</dd></div><div><dt>Διάρκεια</dt><dd>{bookingDetail.service.duration} λεπτά</dd></div><div><dt>Κατάσταση</dt><dd>{statusLabels[bookingDetail.status] || bookingDetail.status}</dd></div><div><dt>Πληρωμή στο κατάστημα</dt><dd>{money(bookingDetail.service.price)} · {bookingDetail.paymentStatus === 'paid' ? 'Εξοφλημένο' : 'Ανεξόφλητο'}</dd></div>{bookingDetail.notes && <div><dt>Σημειώσεις</dt><dd>{bookingDetail.notes}</dd></div>}{bookingDetail.cancellationNote && <div><dt>Αιτία ακύρωσης</dt><dd>{bookingDetail.cancellationNote}</dd></div>}<div><dt>Προέλευση</dt><dd>{bookingDetail.source === 'offline' ? 'Χειροκίνητη κράτηση' : 'Online κράτηση'}</dd></div></dl>{bookingDetail.status === 'confirmed' && <div className="lb-detail-actions">{bookingDetail.source === 'offline' && <button className="lb-secondary" disabled={Boolean(busy)} onClick={() => { setError(''); setModal({ kind: 'manual', booking: bookingDetail }); }}><CalendarDays size={16} />Επεξεργασία ραντεβού</button>}{Date.parse(bookingDetail.startsAt) > Date.now() ? <>{bookingDetail.source !== 'offline' && <button className="lb-secondary" disabled={Boolean(busy)} onClick={() => setModal({ kind: 'reschedule', booking: bookingDetail })}><CalendarDays size={16} />Αλλαγή ώρας / επαγγελματία</button>}</> : <><label className="lb-checkbox"><input type="checkbox" checked={paidAtVenue} onChange={(event) => setPaidAtVenue(event.target.checked)} />Το ποσό εξοφλήθηκε στο κατάστημα</label><p className="lb-note">Καταχωρίστε εξόφληση μόνο εάν λάβατε την πληρωμή. Δεν γίνεται ηλεκτρονική χρέωση</p><button className="lb-primary" disabled={Boolean(busy)} onClick={() => perform('complete-booking', () => completeBooking(bookingDetail.id, paidAtVenue), paidAtVenue ? 'Το ραντεβού ολοκληρώθηκε και καταχωρίστηκε ως εξοφλημένο στο κατάστημα' : 'Το ραντεβού ολοκληρώθηκε χωρίς καταχώριση εξόφλησης')}><CheckCircle2 size={17} />{paidAtVenue ? 'Ολοκλήρωση & καταχώριση εξόφλησης' : 'Ολοκλήρωση ραντεβού'}</button></>}<button className="lb-text-button lb-danger" disabled={Boolean(busy)} onClick={() => setModal({ kind: 'cancel', booking: bookingDetail })}>Ακύρωση ραντεβού</button></div>}{bookingDetail.status === 'completed' && bookingDetail.paymentStatus !== 'paid' && <div className="lb-detail-actions"><p className="lb-note">Καταχωρίστε την εξόφληση μόνο εφόσον λάβατε την πληρωμή στο κατάστημα. Δεν γίνεται ηλεκτρονική χρέωση</p><button className="lb-primary" disabled={Boolean(busy)} onClick={() => perform('record-payment', () => completeBooking(bookingDetail.id, true), "Η εξόφληση καταχωρίστηκε στο κατάστημα. Δεν έγινε ηλεκτρονική χρέωση")}><Euro size={17} />Καταχώριση εξόφλησης στο κατάστημα</button></div>}<Message error>{error}</Message></Modal>}
    {modal?.kind === 'cancel' && <Modal title="Ακύρωση ραντεβού;" busy={Boolean(busy)} onClose={() => setModal(null)}><p className="lb-modal-copy">Θα ακυρωθεί το ραντεβού του/της {modal.booking.name} για {modal.booking.service.name}, στις {modal.booking.time}. Ως ιδιοκτήτης μπορείτε να το ακυρώσετε και μετά το όριο της πολιτικής ακύρωσης</p><Field label="Αιτία ακύρωσης"><textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} minLength={2} maxLength={2000} rows={3} required placeholder="Γράψτε τον λόγο που θα δει ο πελάτης" /></Field><p className="lb-note">Η αιτία αποθηκεύεται στο ιστορικό και εμφανίζεται στην κράτηση του πελάτη</p><button className="lb-primary lb-danger-button" disabled={Boolean(busy) || cancelReason.trim().length < 2} onClick={async () => { const saved = await perform('cancel-booking', () => cancelBookingWithNote(modal.booking.id, cancelReason.trim()), 'Το ραντεβού ακυρώθηκε. Η ώρα είναι ξανά διαθέσιμη'); if (saved) notifications.refresh(); }}>{busy ? <Spinner text="Ακύρωση…" /> : 'Επιβεβαίωση ακύρωσης'}</button><button className="lb-secondary" disabled={Boolean(busy)} onClick={() => setModal({ kind: 'booking', booking: modal.booking })}>Διατήρηση ραντεβού</button><Message error>{error}</Message></Modal>}
    {modal?.kind === 'reschedule' && salon && <Modal title="Αλλαγή ραντεβού" busy={Boolean(busy)} onClose={() => setModal(null)}><RescheduleForm booking={modal.booking} salon={salon} busy={Boolean(busy)} onSubmit={(data) => perform('reschedule', () => rescheduleBooking(data), 'Το ραντεβού μεταφέρθηκε στη νέα ώρα')} /><Message error>{error}</Message></Modal>}
    {authOpen && <AccountPanel onClose={() => setAuthOpen(false)} />}
  </main>;
}
