import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, CreditCard, ExternalLink, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { useAccount } from './Account';
import { getBusinessBilling, managementError, startSubscriptionCheckout } from './lib/admin';
import './business-billing.css';

const money = cents => cents == null ? 'Δεν έχει οριστεί' : new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' }).format(Number(cents) / 100);
const date = (value, timezone) => value ? new Date(String(value).length === 10 ? `${value}T12:00:00Z` : value).toLocaleDateString('el-GR', { timeZone: timezone, day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const subscriptionLabels = { pending: 'Σε αναμονή', active: 'Ενεργή', past_due: 'Εκκρεμεί πληρωμή', cancelled: 'Ακυρωμένη' };
const chargeLabels = { pending: 'Σε εκκρεμότητα', paid: 'Εξοφλημένη', void: 'Ακυρωμένη' };
const inclusiveEnd = value => { if (!value) return null; const end = new Date(`${String(value).slice(0, 10)}T12:00:00Z`); end.setUTCDate(end.getUTCDate() - 1); return end.toISOString().slice(0, 10); };

export default function BusinessBilling({ salon }) {
  const { user } = useAccount();
  const [data, setData] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [dataIdentity, setDataIdentity] = useState('');
  const [providerReady, setProviderReady] = useState(false), [checkingProvider, setCheckingProvider] = useState(false), [paying, setPaying] = useState(false);
  const [manageReady, setManageReady] = useState(false);
  const identity = useRef(''), sequence = useRef(0), request = useRef(null);
  identity.current = user && salon?.id ? `${user.id}:${salon.id}` : '';

  const refresh = useCallback(async () => {
    if (!user || !salon?.id) return;
    const currentIdentity = `${user.id}:${salon.id}`, currentSequence = ++sequence.current;
    setLoading(true); setError(''); setProviderReady(false); setManageReady(false); setCheckingProvider(false);
    try {
      const result = await getBusinessBilling(salon.id);
      if (identity.current !== currentIdentity || currentSequence !== sequence.current) return;
      setData(result); setDataIdentity(currentIdentity);
      if (result?.plan?.enabled || (result?.subscription?.payment_provider === 'stripe' && result?.subscription?.stripe_customer_id)) {
        setCheckingProvider(true);
        try {
          const status = await startSubscriptionCheckout(salon.id, undefined, 'status');
          if (identity.current === currentIdentity && currentSequence === sequence.current) { setProviderReady(status.configured === true); setManageReady(status.manage_configured === true); }
        } catch {
          if (identity.current === currentIdentity && currentSequence === sequence.current) setProviderReady(false);
        } finally {
          if (identity.current === currentIdentity && currentSequence === sequence.current) setCheckingProvider(false);
        }
      }
    } catch (failure) {
      if (identity.current === currentIdentity && currentSequence === sequence.current) setError(managementError(failure).userMessage);
    } finally {
      if (identity.current === currentIdentity && currentSequence === sequence.current) setLoading(false);
    }
  }, [user?.id, salon?.id]);

  useEffect(() => {
    setData(null); setDataIdentity(''); setError(''); setPaying(false); request.current = null;
    refresh();
    return () => { sequence.current++; };
  }, [refresh]);

  async function checkout(action) {
    if (!user || paying || (action === 'manage' ? !manageReady : !providerReady)) return;
    const currentIdentity = identity.current;
    setPaying(true); setError('');
    request.current ||= crypto.randomUUID();
    try {
      const result = await startSubscriptionCheckout(salon.id, request.current, action);
      if (identity.current === currentIdentity) window.location.assign(result.url);
    } catch (failure) {
      if (identity.current === currentIdentity) { setError(managementError(failure).userMessage); setPaying(false); }
    }
  }

  if (!user || !salon?.id) return null;
  const billing = dataIdentity === identity.current ? data : null;
  const subscription = billing?.subscription;
  const timezone = salon.timezone || (salon.country === 'Κύπρος' ? 'Europe/Nicosia' : 'Europe/Athens');
  const billingDate = value => date(value, timezone);
  const price = subscription?.monthly_price_cents ?? billing?.plan?.monthly_price_cents;
  const isStripe = subscription?.payment_provider === 'stripe' && Boolean(subscription?.stripe_customer_id);
  const periodThrough = !subscription?.current_period_end ? null : subscription.payment_provider === 'stripe'
    ? subscription.current_period_end
    : inclusiveEnd(new Intl.DateTimeFormat('sv-SE', { timeZone: timezone }).format(new Date(subscription.current_period_end)));
  const canSubscribe = Boolean(billing?.plan?.enabled && price != null && (!subscription || ['pending', 'cancelled'].includes(subscription.status)));
  return <div className="en-business-billing">
    <div className="en-billing-heading"><div><h2>Συνδρομή Eneres</h2><p>Η χρήση της πλατφόρμας από την επιχείρησή σας</p></div><button className="en-billing-secondary" onClick={refresh} disabled={loading || paying}><RefreshCw size={15} />Ανανέωση</button></div>
    {error && <p className="en-billing-message en-billing-error" role="alert">{error}</p>}
    {loading && !billing ? <p className="en-billing-loading" role="status"><LoaderCircle size={17} />Φόρτωση συνδρομής…</p> : billing && <>
      <section className="en-billing-card en-billing-plan"><span className="en-billing-icon"><CreditCard size={23} /></span><div><span className="en-billing-eyebrow">ΜΗΝΙΑΙΑ ΣΥΝΔΡΟΜΗ</span><h3>{price == null ? 'Η τιμή δεν έχει οριστεί ακόμη' : <>{money(price)} <small>/ μήνα</small></>}</h3><span className={`en-billing-status en-billing-status-${subscription?.status || 'pending'}`}>{subscriptionLabels[subscription?.status] || 'Χωρίς ενεργή συνδρομή'}</span>{periodThrough && <p>{subscription.payment_provider === 'stripe' ? subscription.cancel_at_period_end ? 'Ενεργή μέχρι' : 'Επόμενη ανανέωση' : 'Τρέχουσα περίοδος έως'} {billingDate(periodThrough)}</p>}</div></section>
      <section className="en-billing-card"><h3>Πληρωμή συνδρομής</h3><p className="en-billing-muted">Η συνδρομή Eneres είναι ξεχωριστή από τις πληρωμές των πελατών σας, που γίνονται στο κατάστημα</p>
        {checkingProvider ? <p className="en-billing-loading" role="status"><LoaderCircle size={16} />Έλεγχος τρόπου πληρωμής…</p> : <>
          {isStripe && manageReady && <><p className="en-billing-muted">Δείτε τον τρόπο πληρωμής και διαχειριστείτε τη συνδρομή σας στο ασφαλές περιβάλλον πληρωμών</p><button className="en-billing-primary" disabled={paying} onClick={() => checkout('manage')}>{paying ? <LoaderCircle size={16} /> : <ExternalLink size={16} />}Διαχείριση πληρωμών</button></>}
          {canSubscribe && providerReady ? <><p className="en-billing-muted">Με την ενεργοποίηση ξεκινά μηνιαία επαναλαμβανόμενη συνδρομή με την τιμή που εμφανίζεται παραπάνω</p><button className="en-billing-primary" disabled={paying} onClick={() => checkout('subscribe')}>{paying ? <LoaderCircle size={16} /> : <CreditCard size={16} />}Ενεργοποίηση μηνιαίας συνδρομής με κάρτα</button></> : !providerReady && !manageReady ? <p className="en-billing-muted">Η πληρωμή με κάρτα δεν είναι διαθέσιμη ακόμη</p> : !isStripe ? <p className="en-billing-muted">Η κατάσταση της συνδρομής σας ενημερώνεται από τη διαχείριση Eneres</p> : null}
        </>}
        <p className="en-billing-security"><ShieldCheck size={14} />Τα στοιχεία κάρτας δεν αποθηκεύονται στον ιστότοπο Eneres</p>
      </section>
      <section className="en-billing-card"><h3>Χρεώσεις και πληρωμές</h3><div className="en-billing-charges">{(billing.charges || []).map(charge => <article key={charge.id}><div><strong>{money(charge.amount_cents)}</strong><span>{billingDate(charge.period_start)} – {billingDate(inclusiveEnd(charge.period_end))}</span><small>Πληρωτέα έως {billingDate(charge.due_date)}</small>{charge.paid_at && <small>Εξόφληση {billingDate(charge.paid_at)}</small>}{charge.external_reference && <small>{charge.external_reference}</small>}</div><span className={`en-billing-status en-billing-status-${charge.status}`}>{charge.status === 'paid' && <CheckCircle2 size={12} />}{chargeLabels[charge.status] || charge.status}</span></article>)}</div>{!billing.charges?.length && <p className="en-billing-muted">Δεν έχουν καταχωριστεί χρεώσεις για την επιχείρησή σας</p>}</section>
    </>}
  </div>;
}
