import { t, getLocale } from "./i18n";import { formatEuroCents } from './lib/currency';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CalendarDays, CheckCheck, ChevronRight, Clock3, LoaderCircle, Mail, Phone, RefreshCw, X } from 'lucide-react';
import { acknowledgeBusinessBooking, bookingAlertError, cancelBusinessBooking, listBusinessBookingAlerts } from './lib/businessNotifications';
import './business-notifications.css';

const pageSize = 100;
const statusLabels = { new: 'Νέα κράτηση', noted: 'Η κράτηση σημειώθηκε', cancelled: 'Ακυρώθηκε' };
const money = (value) => formatEuroCents(value || 0);
const date = (value, timezone, options = {}) => value ? new Intl.DateTimeFormat(getLocale(), { timeZone: timezone || 'Europe/Athens', day: 'numeric', month: 'short', year: 'numeric', ...options }).format(new Date(value)) : '—';
const time = (value, timezone) => value ? new Intl.DateTimeFormat(getLocale(), { timeZone: timezone || 'Europe/Athens', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '—';
const alertStatus = (alert) => alert.booking_status === 'cancelled' ? 'cancelled' : alert.status;
const merge = (older, incoming) => {
  const records = new Map(older.map((alert) => [alert.id, alert]));
  incoming.forEach((alert) => records.set(alert.id, alert));
  return [...records.values()].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || String(b.id).localeCompare(String(a.id)));
};
const notifyParent = (callback) => {
  try {Promise.resolve(callback?.()).catch(() => {});} catch {/* The parent reports its own calendar refresh errors. */}
};

export function useBusinessNotifications({ salonId, userId, verified, onChanged } = {}) {
  const [records, setRecords] = useState([]),[dataIdentity, setDataIdentity] = useState('');
  const [loading, setLoading] = useState(false),[refreshing, setRefreshing] = useState(false),[loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(''),[busy, setBusy] = useState(''),[hasMore, setHasMore] = useState(false),[newAlertNotice, setNewAlertNotice] = useState(null);
  const identity = verified && salonId && userId ? `${userId}:${salonId}` : '';
  const identityRef = useRef(identity),sequence = useRef(0),mutationRevision = useRef(0),knownIds = useRef(new Set()),initialized = useRef(false),offset = useRef(0),mutation = useRef(false),mounted = useRef(false);
  const onChangedRef = useRef(onChanged);onChangedRef.current = onChanged;identityRef.current = identity;

  const refresh = useCallback(async (quiet = false) => {
    if (!identity) return false;
    const owner = identity,request = ++sequence.current;
    if (!quiet) {setRefreshing(true);if (!initialized.current) setLoading(true);}
    try {
      const incoming = await listBusinessBookingAlerts(salonId);
      if (!mounted.current || identityRef.current !== owner || request !== sequence.current) return false;
      const unseen = initialized.current ? incoming.filter((alert) => !knownIds.current.has(alert.id)) : [];
      const arrived = unseen.filter((alert) => alertStatus(alert) === 'new');
      incoming.forEach((alert) => knownIds.current.add(alert.id));
      if (arrived.length) setNewAlertNotice({ count: arrived.length, name: arrived[0].customer_name });
      setRecords((current) => quiet ? merge(current, incoming) : incoming);setDataIdentity(owner);setError('');
      if (!initialized.current || !quiet || unseen.length) {offset.current = incoming.length;setHasMore(incoming.length === pageSize);}
      initialized.current = true;
      if (arrived.length) notifyParent(onChangedRef.current);
      return true;
    } catch (failure) {
      if (mounted.current && identityRef.current === owner && request === sequence.current) setError(bookingAlertError(failure).userMessage);
      return false;
    } finally {
      if (mounted.current && identityRef.current === owner && request === sequence.current) {setLoading(false);setRefreshing(false);}
    }
  }, [identity, salonId]);

  useEffect(() => {
    mounted.current = true;initialized.current = false;knownIds.current = new Set();offset.current = 0;mutation.current = false;
    setRecords([]);setDataIdentity('');setError('');setBusy('');setHasMore(false);setNewAlertNotice(null);setLoadingMore(false);setLoading(false);setRefreshing(false);
    if (identity) refresh();
    return () => {mounted.current = false;sequence.current++;};
  }, [identity, refresh]);

  useEffect(() => {
    if (!identity) return undefined;
    const poll = () => {if (document.visibilityState !== 'hidden' && !mutation.current) refresh(true);};
    const timer = setInterval(poll, 15000);
    window.addEventListener('focus', poll);document.addEventListener('visibilitychange', poll);
    return () => {clearInterval(timer);window.removeEventListener('focus', poll);document.removeEventListener('visibilitychange', poll);};
  }, [identity, refresh]);

  const loadMore = useCallback(async () => {
    if (!identity || loadingMore || !hasMore || mutation.current) return;
    const owner = identity,writeRevision = mutationRevision.current;setLoadingMore(true);
    try {
      const incoming = await listBusinessBookingAlerts(salonId, offset.current);
      if (!mounted.current || identityRef.current !== owner || writeRevision !== mutationRevision.current) return;
      incoming.forEach((alert) => knownIds.current.add(alert.id));
      offset.current += incoming.length;setRecords((current) => merge(current, incoming));setDataIdentity(owner);setHasMore(incoming.length === pageSize);setError('');
    } catch (failure) {if (mounted.current && identityRef.current === owner && writeRevision === mutationRevision.current) setError(bookingAlertError(failure).userMessage);} finally
    {if (mounted.current && identityRef.current === owner) setLoadingMore(false);}
  }, [identity, salonId, loadingMore, hasMore]);

  async function change(alertId, work) {
    if (!identity || mutation.current) return false;
    const owner = identity;mutation.current = true;setBusy(alertId);setError('');
    // Invalidate an older poll so it cannot overwrite a confirmed action.
    sequence.current++;mutationRevision.current++;
    try {
      const updated = await work();
      if (!mounted.current || identityRef.current !== owner) return false;
      setRecords((current) => merge(current, [updated]));setDataIdentity(owner);setNewAlertNotice(null);
      await refresh(true);
      if (mounted.current && identityRef.current === owner) notifyParent(onChangedRef.current);
      return true;
    } catch (failure) {
      const message = bookingAlertError(failure).userMessage;
      if (mounted.current && identityRef.current === owner) {
        await refresh(true);
        if (mounted.current && identityRef.current === owner) setError(message);
      }
      return false;
    } finally {
      if (mounted.current && identityRef.current === owner) {mutation.current = false;setBusy('');setLoading(false);setRefreshing(false);}
    }
  }

  const alerts = dataIdentity === identity ? records : [];
  return {
    alerts, loading, refreshing, loadingMore, error: identity ? error : '', busy: identity ? busy : '', hasMore,
    unreadCount: alerts[0]?.salon_unread_count ?? alerts.filter((alert) => alertStatus(alert) === 'new').length,
    newAlertNotice: identity ? newAlertNotice : null,
    refresh, loadMore, dismissNotice: () => setNewAlertNotice(null),
    acknowledge: (alertId) => change(alertId, () => acknowledgeBusinessBooking(alertId)),
    cancel: (alertId, reason) => change(alertId, () => cancelBusinessBooking(alertId, reason))
  };
}

export function NotificationButton({ notifications, onClick }) {
  const count = notifications?.unreadCount || 0;
  return <button type="button" className="bn-bell" aria-label={t("Ειδοποιήσεις κρατήσεων")} title={count ? t("{value0} νέες κρατήσεις", { value0: count }) : t("Ιστορικό κρατήσεων Eneres")} onClick={onClick}><Bell size={19} /><span className="bn-bell-label">{t("Ειδοποιήσεις")}</span>{count > 0 && <span className="bn-badge">{count > 99 ? '99+' : count}</span>}</button>;
}

export function NotificationToast({ notifications, onOpen }) {
  const notice = notifications?.newAlertNotice;
  if (!notice) return null;
  return <div className="bn-incoming" role="status"><Bell size={20} /><div><strong>{notice.count > 1 ? t("{value0} νέες κρατήσεις από το Eneres", { value0: notice.count }) : t("Νέα κράτηση από το Eneres")}</strong><span>{notice.name || t("Το ημερολόγιο σας ενημερώθηκε")}</span></div><button type="button" onClick={() => {notifications.dismissNotice();onOpen();}}>{t("Δείτε την κράτηση")}<ChevronRight size={15} /></button><button type="button" className="bn-incoming-close" aria-label={t("Κλείσιμο ειδοποίησης")} onClick={notifications.dismissNotice}><X size={16} /></button></div>;
}

function AlertDetails({ alert, timezone, notifications, onClose }) {
  const panel = useRef(null),closeRef = useRef(onClose),busyRef = useRef(false);
  closeRef.current = onClose;
  const [cancelling, setCancelling] = useState(false),[reason, setReason] = useState(''),[validation, setValidation] = useState('');
  const status = alertStatus(alert),busy = Boolean(notifications.busy);busyRef.current = busy;
  const phone = alert.customer_phone?.trim();
  useEffect(() => {
    const previous = document.activeElement,overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';panel.current?.querySelector('button')?.focus();
    const keyboard = (event) => {
      if (event.key === 'Escape' && !busyRef.current) {event.preventDefault();closeRef.current();}
      if (event.key !== 'Tab') return;
      const controls = [...panel.current.querySelectorAll('button:not(:disabled),textarea:not(:disabled),a[href]')].filter((element) => element.getClientRects().length);
      if (!controls.length) return;
      if (event.shiftKey && (document.activeElement === controls[0] || document.activeElement === panel.current)) {event.preventDefault();controls.at(-1).focus();} else
      if (!event.shiftKey && document.activeElement === controls.at(-1)) {event.preventDefault();controls[0].focus();}
    };
    document.addEventListener('keydown', keyboard);
    return () => {document.body.style.overflow = overflow;document.removeEventListener('keydown', keyboard);previous?.focus();};
  }, []);
  async function cancel(event) {
    event.preventDefault();
    if (reason.trim().length < 2 || reason.trim().length > 2000) {setValidation(t("Γράψτε τον λόγο ακύρωσης, από 2 έως 2000 χαρακτήρες"));return;}
    setValidation('');
    if (await notifications.cancel(alert.id, reason)) setCancelling(false);
  }
  return <div className="bn-modal-backdrop" onMouseDown={(event) => {if (event.target === event.currentTarget && !busy) onClose();}}><section className="bn-modal" ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="business-alert-title"><header><div><span className="bn-eyebrow">{t("ΝΕΑ ΚΡΑΤΗΣΗ ΑΠΟ ΤΟ ENERES")}</span><h2 id="business-alert-title">{alert.customer_name || t("Λεπτομέρειες κράτησης")}</h2></div><button type="button" className="bn-icon-button" onClick={onClose} disabled={busy} aria-label={t("Κλείσιμο λεπτομερειών κράτησης")}><X size={20} /></button></header>
    <span className={`bn-status bn-status-${status}`}>{t(statusLabels[status] || status)}</span>
    <dl className="bn-details"><div><dt>{t("Υπηρεσία")}</dt><dd>{alert.service_name}</dd></div><div><dt>{t("Επαγγελματίας")}</dt><dd>{alert.staff_name}</dd></div><div><dt>{t("Ημερομηνία")}</dt><dd>{date(alert.starts_at, timezone)}</dd></div><div><dt>{t("Ώρα")}</dt><dd>{time(alert.starts_at, timezone)} – {time(alert.ends_at, timezone)}</dd></div><div><dt>{t("Κινητό πελάτη")}</dt><dd>{phone ? <a href={`tel:${phone.replace(/[^\d+]/g, '')}`}><Phone size={15} />{phone}</a> : t("Δεν έχει δοθεί")}</dd></div><div><dt>{t("Email πελάτη")}</dt><dd>{alert.customer_email ? <a href={`mailto:${alert.customer_email}`}><Mail size={15} />{alert.customer_email}</a> : t("Δεν έχει δοθεί")}</dd></div><div><dt>{t("Πληρωμή στο κατάστημα")}</dt><dd>{money(alert.price_cents)}</dd></div>{alert.notes && <div><dt>{t("Σημειώσεις πελάτη")}</dt><dd className="bn-note-text">{alert.notes}</dd></div>}{alert.noted_at && <div><dt>{t("Σημειώθηκε")}</dt><dd>{date(alert.noted_at, timezone, { hour: '2-digit', minute: '2-digit' })}</dd></div>}{alert.cancellation_note && <div><dt>{t("Λόγος ακύρωσης")}</dt><dd className="bn-note-text">{alert.cancellation_note}</dd></div>}{alert.cancelled_at && <div><dt>{t("Ακυρώθηκε")}</dt><dd>{date(alert.cancelled_at, timezone, { hour: '2-digit', minute: '2-digit' })}</dd></div>}</dl>
    {notifications.error && <p className="bn-error" role="alert">{t(notifications.error)}</p>}
    {status === 'new' && <p className="bn-explanation">{t("Η κράτηση έχει ήδη δεσμεύσει την ώρα στο ημερολόγιό σας. Η σημείωση επιβεβαιώνει μόνο ότι ενημερωθήκατε")}</p>}
    {status !== 'cancelled' && !cancelling && <div className="bn-actions">{status === 'new' && <button type="button" className="bn-primary" disabled={busy} onClick={() => notifications.acknowledge(alert.id)}>{busy ? <LoaderCircle size={16} /> : <CheckCheck size={16} />}{t("Η κράτηση σημειώθηκε")}</button>}{alert.booking_status === 'confirmed' && <button type="button" className="bn-secondary bn-danger" disabled={busy} onClick={() => setCancelling(true)}>{t("Ακύρωση κράτησης")}</button>}</div>}
    {status !== 'cancelled' && cancelling && <form className="bn-cancel-form" onSubmit={cancel}><label>{t("Λόγος ακύρωσης")}<textarea autoFocus required minLength={2} maxLength={2000} rows={4} value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} placeholder={t("Εξηγήστε στον πελάτη γιατί ακυρώνεται το ραντεβού")} /></label><p className="bn-explanation">{t("Η ακύρωση αποδεσμεύει την ώρα. Ο λόγος θα εμφανίζεται στην κράτηση του πελάτη")}</p>{validation && <p className="bn-error" role="alert">{t(validation)}</p>}<div className="bn-actions"><button type="submit" className="bn-primary bn-cancel-confirm" disabled={busy}>{busy && <LoaderCircle size={16} />}{t("Επιβεβαίωση ακύρωσης")}</button><button type="button" className="bn-secondary" disabled={busy} onClick={() => {setCancelling(false);setValidation('');}}>{t("Επιστροφή")}</button></div></form>}
  </section></div>;
}

export default function BusinessNotifications({ salon, notifications }) {
  const [selected, setSelected] = useState(null),[filter, setFilter] = useState('all');
  useEffect(() => {setSelected(null);setFilter('all');}, [salon?.id]);
  const alerts = notifications.alerts || [];
  const selectedAlert = alerts.find((alert) => alert.id === selected);
  const filtered = alerts.filter((alert) => filter === 'all' || alertStatus(alert) === filter);
  const timezone = salon?.timezone || (salon?.country === 'Κύπρος' ? 'Europe/Nicosia' : 'Europe/Athens');
  return <section className="bn-history">
    <div className="bn-history-heading"><div><span className="bn-eyebrow">{t("ΕΝΗΜΕΡΩΣΕΙΣ ΕΠΙΧΕΙΡΗΣΗΣ")}</span><h2>{t("Ιστορικό κρατήσεων Eneres")}</h2><p>{t("Δείτε τις κρατήσεις από το Eneres, σημειώστε ότι ενημερωθήκατε και ανοίξτε τα στοιχεία επικοινωνίας")}</p></div><button type="button" className="bn-secondary" disabled={notifications.loading || notifications.refreshing || Boolean(notifications.busy)} onClick={() => notifications.refresh()}><RefreshCw size={16} />{t("Ανανέωση")}</button></div>
    <div className="bn-history-toolbar"><label>{t("Κατάσταση")}<select aria-label={t("Κατάσταση ειδοποιήσεων")} value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">{t("Όλες οι κρατήσεις")}</option><option value="new">{t("Νέες κρατήσεις")}</option><option value="noted">{t("Σημειωμένες")}</option><option value="cancelled">{t("Ακυρωμένες")}</option></select></label><span>{notifications.unreadCount}{t(" νέες κρατήσεις")}</span></div>
    {notifications.error && <p className="bn-error" role="alert">{t(notifications.error)}</p>}
    {notifications.loading ? <p className="bn-loading" role="status"><LoaderCircle size={18} />{t("Φόρτωση ιστορικού…")}</p> : <><div className="bn-table-wrap"><table className="bn-history-table"><thead><tr><th>{t("Ενημέρωση")}</th><th>{t("Πελάτης")}</th><th>{t("Ραντεβού")}</th><th>{t("Κατάσταση")}</th></tr></thead><tbody>{filtered.map((alert) => <tr key={alert.id}><td data-label={t("Ενημέρωση")}><button type="button" className="bn-row-link" onClick={() => setSelected(alert.id)} aria-label={t("Λεπτομέρειες κράτησης {value0}", { value0: alert.customer_name })}><Bell size={16} /><span>{t("Νέα κράτηση από το Eneres")}<small>{date(alert.created_at, timezone, { hour: '2-digit', minute: '2-digit' })}</small></span><ChevronRight size={16} /></button></td><td data-label={t("Πελάτης")}><strong>{alert.customer_name}</strong><small>{alert.service_name}</small></td><td data-label={t("Ραντεβού")}><span><CalendarDays size={14} />{date(alert.starts_at, timezone)}</span><small><Clock3 size={13} />{time(alert.starts_at, timezone)} · {alert.staff_name}</small></td><td data-label={t("Κατάσταση")}><span className={`bn-status bn-status-${alertStatus(alert)}`}>{t(statusLabels[alertStatus(alert)] || alert.status)}</span></td></tr>)}</tbody></table></div>{!filtered.length && <div className="bn-empty"><Bell size={30} /><h3>{alerts.length ? t("Δεν υπάρχουν κρατήσεις με αυτή την κατάσταση") : t("Εδώ θα βρίσκετε τις νέες κρατήσεις")}</h3><p>{t("Οι online κρατήσεις προστίθενται αυτόματα στο ημερολόγιο και στο ιστορικό σας")}</p></div>}{notifications.hasMore && <button type="button" className="bn-secondary bn-load-more" onClick={notifications.loadMore} disabled={notifications.loadingMore || Boolean(notifications.busy)}>{notifications.loadingMore && <LoaderCircle size={16} />}{t("Παλαιότερες κρατήσεις")}</button>}</>}
    {selectedAlert && <AlertDetails key={selectedAlert.id} alert={selectedAlert} timezone={timezone} notifications={notifications} onClose={() => setSelected(null)} />}
  </section>;
}
