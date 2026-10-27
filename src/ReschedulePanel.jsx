import { t, getLocale } from './i18n';
import { useLanguage } from './Language';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { getSlots, rescheduleBooking } from './lib/platform';

export default function ReschedulePanel({ booking, onClose, onSaved }) {
  useLanguage();
  const [date, setDate] = useState(booking.date);
  const [slots, setSlots] = useState([]);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setSelected(null); setLoading(true); setError('');
    getSlots(booking.service.id, date).then(data => { if (active) setSlots(data); }).catch(failure => { if (active) setError(failure.userMessage || failure.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [booking.service.id, date]);
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const panel = document.getElementById('reschedule-panel');
    const previous = document.activeElement;
    panel.querySelector('button')?.focus();
    const key = event => {
      if (event.key === 'Escape' && !busy) onClose();
      if (event.key === 'Tab') {
        const items = [...panel.querySelectorAll('button:not(:disabled),input:not(:disabled)')];
        if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1).focus(); }
        if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', key); if (previous?.isConnected) previous.focus(); };
  }, [busy, onClose]);
  const min = new Intl.DateTimeFormat('sv-SE', { timeZone: booking.country === 'Κύπρος' ? 'Europe/Nicosia' : 'Europe/Athens' }).format(new Date());
  const end = new Date(`${min}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + 90);
  async function save() {
    if (!selected || busy) return;
    setBusy(true); setError('');
    try { const saved = await rescheduleBooking({ bookingId: booking.id, staffId: selected.staffId, startsAt: selected.startsAt }); onSaved(saved); }
    catch (failure) { setError(failure.userMessage || failure.message); setSelected(null); }
    finally { setBusy(false); }
  }
  return <div className="account-overlay"><section id="reschedule-panel" className="account-panel" role="dialog" aria-modal="true" aria-label={t("Αλλαγή ώρας ραντεβού")}><button className="account-close" disabled={busy} onClick={onClose} aria-label={t("Κλείσιμο αλλαγής ώρας")}><X size={20}/></button><h2>{t("Μια νέα στιγμή για εσάς")}</h2><p className="lb-note">{booking.salonName} · {booking.service.name}{t(". Η αρχική κράτηση παραμένει ενεργή μέχρι να επιβεβαιωθεί η αλλαγή")}</p><label className="lb-field"><span>{t("Νέα ημερομηνία")}</span><input type="date" lang={getLocale()} min={min} max={end.toISOString().slice(0,10)} value={date} onChange={e => setDate(e.target.value)} /></label>{loading ? <p role="status">{t("Έλεγχος διαθεσιμότητας…")}</p> : <div className="lb-slot-grid" style={{ margin: '15px 0' }}>{slots.map(slot => <button key={`${slot.staffId}-${slot.startsAt}`} className={selected === slot ? 'lb-slot-selected' : ''} onClick={() => setSelected(slot)}><strong>{slot.time}</strong><span>{slot.staffName}</span></button>)}</div>}{!loading && !slots.length && <p>{t("Δεν υπάρχουν διαθέσιμες ώρες για αυτή την ημέρα")}</p>}{error && <p className="account-error" role="alert">{t(error)}</p>}<button className="account-primary" disabled={!selected || busy || loading} onClick={save}>{busy ? t("Αποθήκευση…") : t("Επιβεβαίωση νέας ώρας")}</button><p className="lb-note">{t("Αλλαγές έως ")}{booking.cancellationHours}{t(" ώρες πριν από το ραντεβού. Μετά, επικοινωνήστε με το κατάστημα")}</p></section></div>;
}
