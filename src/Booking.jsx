import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Check, CheckCircle2, ChevronRight, Clock3, CreditCard, Mail, MapPin, Scissors, ShieldCheck, Store, UserRound, Wallet, X } from 'lucide-react';
import './booking.css';
import { platformReady } from './lib/platform';
import LiveBooking from './LiveBooking';

const euros = (amount) => new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' }).format(amount);
const localISO = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return ['year', 'month', 'day'].map((type) => parts.find((part) => part.type === type).value).join('-');
};
const dayLabel = (date, timeZone, options) => new Intl.DateTimeFormat('el-GR', { timeZone, ...options }).format(new Date(`${date}T12:00:00Z`));
const minutes = (time) => Number(time.split(':')[0]) * 60 + Number(time.split(':')[1]);
const readContact = () => {
  try {
    const saved = JSON.parse(localStorage.getItem('meraki-profile') || 'null');
    return {
      name: typeof saved?.name === 'string' ? saved.name.slice(0, 80) : '',
      email: typeof saved?.email === 'string' ? saved.email.slice(0, 160) : '',
    };
  } catch {
    return { name: '', email: '' };
  }
};

export default function Booking(props) {
  return platformReady ? <LiveBooking {...props}/> : <DemoBooking {...props}/>;
}

function DemoBooking({ salon, onClose, onConfirm, bookings = [], initialDate }) {
  const [step, setStep] = useState(1);
  const [service, setService] = useState(null);
  const [staff, setStaff] = useState('');
  const timeZone = salon.country === 'Κύπρος' ? 'Europe/Nicosia' : 'Europe/Athens';
  const today = localISO(new Date(), timeZone);
  const tomorrowDate = new Date(`${today}T12:00:00Z`);
  tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
  const tomorrow = localISO(tomorrowDate, timeZone);
  const initialIsValid = typeof initialDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(initialDate) && Number.isFinite(Date.parse(`${initialDate}T12:00:00Z`)) && new Date(`${initialDate}T12:00:00Z`).toISOString().slice(0, 10) === initialDate && initialDate >= tomorrow;
  const firstDate = initialIsValid ? initialDate : tomorrow;
  const [date, setDate] = useState(firstDate);
  const [time, setTime] = useState('');
  const [initialContact] = useState(readContact);
  const [name, setName] = useState(initialContact.name);
  const [email, setEmail] = useState(initialContact.email);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef(null);
  const closeButton = useRef(null);
  const submitted = useRef(false);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const value = new Date(`${firstDate}T12:00:00Z`);
    value.setUTCDate(value.getUTCDate() + index);
    return localISO(value, timeZone);
  }), [firstDate, timeZone]);

  useEffect(() => {
    const active = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const handleKey = (event) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialog.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]') || []).filter((element) => element.getClientRects().length);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKey);
      if (active?.isConnected) active.focus();
    };
  }, [onClose]);

  const unavailable = (slot) => {
    if (!service) return false;
    if (date === today) {
      const now = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
      if (minutes(slot) <= minutes(now)) return true;
    }
    return bookings.some((booking) => {
      if (booking.salonId !== salon.id || booking.date !== date || booking.status === 'cancelled') return false;
      if (staff !== 'Χωρίς προτίμηση' && booking.staff !== 'Χωρίς προτίμηση' && booking.staff !== staff) return false;
      const start = minutes(slot);
      const bookedStart = minutes(booking.time);
      return start < bookedStart + booking.service.duration && bookedStart < start + service.duration;
    });
  };
  const canContinue = Boolean(service && staff && time && !unavailable(time));
  const complete = (event) => {
    event.preventDefault();
    if (submitted.current) return;
    if (name.trim().length < 2) { setError('Γράψτε το όνομά σας με τουλάχιστον δύο χαρακτήρες, χωρίς να μετράνε τα κενά.'); return; }
    if (!canContinue) { setError('Η ώρα αυτή δεν είναι πλέον διαθέσιμη. Επιλέξτε μια νέα ώρα.'); setStep(2); return; }
    submitted.current = true;
    const booking = {
      id: crypto.randomUUID(), salonId: salon.id, salonName: salon.name,
      service, staff, date, time, name: name.trim(), email: email.trim(),
      payment: 'venue', createdAt: new Date().toISOString(), country: salon.country,
    };
    try {
      onConfirm(booking);
      setConfirmed(true);
    } catch {
      submitted.current = false;
      setError('Η κράτηση δεν αποθηκεύτηκε. Προσπαθήστε ξανά.');
    }
  };

  return <div className="booking-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className={`booking-dialog ${confirmed ? 'booking-dialog-success' : ''}`} role="dialog" aria-modal="true" aria-labelledby="booking-title">
      <div className="booking-handle" />
      <div className="booking-topline">
        {step > 1 && !confirmed ? <button className="booking-icon-button" aria-label="Προηγούμενο βήμα" onClick={() => setStep(step - 1)}><ArrowLeft size={20}/></button> : <span className="booking-brand">Η στιγμή σας.</span>}
        <button ref={closeButton} className="booking-icon-button" aria-label="Κλείσιμο κράτησης" onClick={onClose}><X size={20}/></button>
      </div>

      {confirmed ? <div className="booking-success">
        <div className="booking-success-icon"><CheckCircle2 size={38}/></div>
        <span className="booking-eyebrow">ΜΙΑ ΜΙΚΡΗ ΣΤΙΓΜΗ, ΜΟΝΟ ΓΙΑ ΕΣΑΣ</span>
        <h2 id="booking-title">Η δοκιμαστική σας κράτηση<br/>αποθηκεύτηκε.</h2>
        <p>Ευχαριστούμε, {name.trim()}! Η δοκιμαστική κράτησή σας αποθηκεύτηκε σε αυτή τη συσκευή.</p>
        <div className="booking-success-details">
          <strong>{salon.name}</strong><span>{service.name}</span>
          <div><CalendarDays size={17}/>{dayLabel(date, timeZone, { weekday: 'long', day: 'numeric', month: 'long' })} · {time}</div>
          <div><UserRound size={17}/>{staff}</div>
          <div><Store size={17}/>Πληρωμή στο κατάστημα · {euros(service.price)}</div>
        </div>
        <p className="booking-local-note">Πρόκειται για επίδειξη. Δεν έχει ενημερωθεί πραγματικό κατάστημα και δεν έχει πραγματοποιηθεί χρέωση.</p>
        <button className="booking-primary" onClick={onClose}>Υπέροχα, ευχαριστώ <Check size={18}/></button>
      </div> : <>
        <div className="booking-progress" aria-label={`Βήμα ${step} από 3`}>
          {['Υπηρεσία', 'Ημέρα & ώρα', 'Επιβεβαίωση'].map((label, index) => <div key={label} className={step >= index + 1 ? 'is-current' : ''}><span>{step > index + 1 ? <Check size={12}/> : index + 1}</span>{label}</div>)}
        </div>
        <div className="booking-heading">
          <span className="booking-eyebrow">{salon.name}</span>
          <h2 id="booking-title">{step === 1 ? 'Τι θα κάνετε για εσάς;' : step === 2 ? 'Βρείτε τη δική σας στιγμή.' : 'Λίγο πριν την ομορφιά.'}</h2>
          <p>{step === 1 ? 'Επιλέξτε την υπηρεσία που σας ταιριάζει.' : step === 2 ? 'Επιλέξτε επαγγελματία, ημέρα και ώρα.' : 'Ελέγξτε τα στοιχεία και ολοκληρώστε την κράτηση.'}</p>
        </div>

        {step === 1 && <div className="booking-step-content">
          <div className="booking-salon-line"><MapPin size={15}/>{salon.location}<span>·</span><span>{salon.country}</span></div>
          <div className="booking-services">
            {salon.services.map((item) => <button key={item.name} className={`booking-service ${service?.name === item.name ? 'is-selected' : ''}`} onClick={() => setService(item)} aria-pressed={service?.name === item.name}>
              <span className="booking-service-icon"><Scissors size={21}/></span>
              <span className="booking-service-info"><strong>{item.name}</strong><small><Clock3 size={13}/>{item.duration} λεπτά</small></span>
              <strong className="booking-price">{euros(item.price)}</strong>
              <span className="booking-radio">{service?.name === item.name && <span/>}</span>
            </button>)}
          </div>
          <div className="booking-reassurance"><ShieldCheck size={17}/>Χωρίς έξοδα κράτησης. Με τον δικό σας ρυθμό.</div>
          <button className="booking-primary" disabled={!service} onClick={() => setStep(2)}>Συνέχεια <ArrowRight size={18}/></button>
        </div>}

        {step === 2 && <div className="booking-step-content">
          <h3>Με ποιον θα θέλατε;</h3>
          <div className="booking-staff-list">
            {['Χωρίς προτίμηση', 'Ελένη', 'Αλέξανδρος'].map((person, index) => <button key={person} className={`booking-staff ${staff === person ? 'is-selected' : ''}`} onClick={() => { setStaff(person); setTime(''); }} aria-pressed={staff === person}>
              <span className={`booking-avatar booking-avatar-${index}`}>{index === 0 ? <UserRound size={23}/> : person[0]}</span><strong>{person}</strong><small>{index === 0 ? 'Ο πρώτος διαθέσιμος' : index === 1 ? 'Senior specialist' : 'Beauty specialist'}</small>
              {staff === person && <Check size={14} className="booking-staff-check"/>}
            </button>)}
          </div>
          <div className="booking-date-heading"><h3>Επιλέξτε ημέρα</h3><span>{dayLabel(date, timeZone, { month: 'long', year: 'numeric' })}</span></div>
          <div className="booking-days">
            {days.map((day) => <button key={day} className={date === day ? 'is-selected' : ''} onClick={() => { setDate(day); setTime(''); }} aria-label={dayLabel(day, timeZone, { weekday: 'long', day: 'numeric', month: 'long' })} aria-pressed={date === day}><span>{dayLabel(day, timeZone, { weekday: 'short' }).replace('.', '')}</span><strong>{dayLabel(day, timeZone, { day: 'numeric' })}</strong><i/></button>)}
          </div>
          <h3 className="booking-times-heading">Διαθέσιμες ώρες <span>Τοπική ώρα {salon.country === 'Κύπρος' ? 'Κύπρου' : 'Ελλάδας'}</span></h3>
          <div className="booking-times">
            {salon.availability.map((slot) => <button key={slot} disabled={unavailable(slot)} className={time === slot ? 'is-selected' : ''} onClick={() => setTime(slot)} aria-pressed={time === slot}>{slot}</button>)}
          </div>
          {salon.availability.every(unavailable) && <p className="booking-empty">Δεν υπάρχουν διαθέσιμες ώρες. Επιλέξτε άλλη ημέρα ή άλλον επαγγελματία.</p>}
          {error && <p className="booking-error" role="alert">{error}</p>}
          <div className="booking-selection-summary"><Scissors size={17}/><span>{service.name}</span><strong>{euros(service.price)}</strong></div>
          <button className="booking-primary" disabled={!canContinue} onClick={() => { setError(''); setStep(3); }}>Συνέχεια στην επιβεβαίωση <ArrowRight size={18}/></button>
        </div>}

        {step === 3 && <form className="booking-step-content" onSubmit={complete}>
          <div className="booking-summary-card">
            <div><span className="booking-summary-icon"><Scissors size={20}/></span><span><strong>{service.name}</strong><small>{service.duration} λεπτά · {salon.name}</small></span><b>{euros(service.price)}</b></div>
            <button type="button" onClick={() => setStep(2)}><span className="booking-summary-icon"><UserRound size={20}/></span><span><strong>με {staff === 'Χωρίς προτίμηση' ? 'τον πρώτο διαθέσιμο επαγγελματία' : staff === 'Ελένη' ? 'την Ελένη' : 'τον Αλέξανδρο'}</strong><small>Ο επαγγελματίας σας</small></span><ChevronRight size={17}/></button>
            <button type="button" onClick={() => setStep(2)}><span className="booking-summary-icon"><CalendarDays size={20}/></span><span><strong>{dayLabel(date, timeZone, { weekday: 'short', day: 'numeric', month: 'short' })} · {time}</strong><small>Τοπική ώρα {salon.country === 'Κύπρος' ? 'Κύπρου' : 'Ελλάδας'}</small></span><ChevronRight size={17}/></button>
          </div>
          <h3>Τα στοιχεία σας</h3>
          <div className="booking-fields">
            <label><span>Όνομα</span><div><UserRound size={17}/><input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={80} autoComplete="given-name" placeholder="Το όνομά σας"/></div></label>
            <label><span>Email</span><div><Mail size={17}/><input value={email} onChange={(event) => setEmail(event.target.value)} required type="email" maxLength={160} autoComplete="email" placeholder="name@example.com"/></div></label>
          </div>
          <h3>Τρόπος πληρωμής</h3>
          <div className="booking-payment-methods">
            <div className="booking-payment-active"><Store size={19}/><span>Πληρωμή στο κατάστημα</span><span className="booking-radio"><span/></span></div>
            <button type="button" disabled><CreditCard size={19}/><span>Πιστωτική ή χρεωστική κάρτα</span><small>Σύντομα</small></button>
            <button type="button" disabled><Wallet size={19}/><span>Apple Pay</span><small>Σύντομα</small></button>
          </div>
          <div className="booking-total"><div><span>Υπηρεσία</span><span>{euros(service.price)}</span></div><div><strong>Σύνολο</strong><strong>{euros(service.price)}</strong></div></div>
          <p className="booking-local-note"><ShieldCheck size={14}/>Δοκιμαστική κράτηση: αποθηκεύεται μόνο σε αυτή τη συσκευή. Δεν ενημερώνεται πραγματικό κατάστημα και δεν γίνεται χρέωση.</p>
          {error && <p className="booking-error" role="alert">{error}</p>}
          <button className="booking-primary" type="submit">Επιβεβαίωση ραντεβού · {euros(service.price)} <ArrowRight size={17}/></button>
        </form>}
      </>}
    </section>
  </div>;
}
