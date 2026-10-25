import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, CalendarDays, Check, CheckCircle2, ChevronDown, Clock3, Globe2, Heart, MapPin, Menu, Search, ShieldCheck, SlidersHorizontal, Sparkles, Star, Store, UserRound, X } from 'lucide-react';
import { categories, salons as demoSalons, locationGroups } from './data';
import Brand from './Brand';
import CityPicker from './CityPicker';
import { AccountPanel, useAccount } from './Account';
import { platformReady, platformConfigurationError, listSalons, listBookings, createBooking, cancelBooking as cancelRemoteBooking } from './lib/platform';
import { findAvailableSalonIds } from './lib/searchAvailability';
import ReschedulePanel from './ReschedulePanel';
import Booking from './Booking';
import Business from './Business';
import Admin from './Admin';

const money = value => new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
const dateText = date => new Date(`${date}T12:00:00`).toLocaleDateString('el-GR', { weekday: 'long', day: 'numeric', month: 'long' });
const nextBookableDate = () => {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Athens' }).format(new Date());
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};
const readStorage = (key, fallback) => { try { const value = JSON.parse(localStorage.getItem(key)); return value ?? fallback; } catch { return fallback; } };

export function Photo({ index = 8, className = '', label, imageUrl, placeholder = false, ...props }) {
  if (imageUrl) return <img {...props} src={imageUrl} alt={label || ""} className={`photo ${className}`} style={{objectFit:"cover"}} referrerPolicy="no-referrer" />;
  if (placeholder) return <div className={`photo photo--placeholder ${className}`} role="img" aria-label="Δεν έχει προστεθεί φωτογραφία"><Store size={30}/><span>Ο χώρος σας</span></div>;
  return <div {...props} role={label ? 'img' : undefined} aria-label={label} className={`photo ${className}`} style={{ backgroundPosition: `${(index % 4) * 100 / 3}% ${Math.floor(index / 4) * 50}%`, ...props.style }} />;
}

function SalonCard({ salon, favorite, onFavorite, onBook }) {
  return <article className="salon-card">
    <button className="salon-photo-button" onClick={() => onBook(salon)} aria-label={`Δείτε υπηρεσίες στο ${salon.name}`}><Photo index={salon.photoIndex} imageUrl={salon.imageUrl} placeholder={!salon.isDemo && !salon.imageUrl} label={salon.name} /><span className="photo-overlay" /><span className="salon-photo-tag"><Sparkles size={12} />{!salon.isDemo ? 'Online κράτηση' : salon.category === 'hair' ? 'Αγαπημένο της κοινότητας' : salon.category === 'barber' ? 'Το στυλ έχει χαρακτήρα' : 'Η στιγμή σας, εδώ'}</span></button>
    <button className={`favorite-button ${favorite ? 'is-favorite' : ''}`} aria-label={`${favorite ? 'Αφαίρεση από' : 'Προσθήκη στα'} αγαπημένα: ${salon.name}`} aria-pressed={favorite} onClick={() => onFavorite(salon.id)}><Heart size={19} fill={favorite ? 'currentColor' : 'none'} strokeWidth={1.7} /></button>
    <div className="salon-body"><div className="salon-title-row"><button className="salon-name" onClick={() => onBook(salon)}>{salon.name}</button>{Number.isFinite(salon.rating) && <span className="rating"><Star size={13} fill="currentColor" />{salon.rating.toFixed(1)}<span>({salon.reviewCount})</span></span>}</div>
      <p className="salon-location"><MapPin size={13} /><span>{[salon.location, salon.country].filter(Boolean).join(', ')}</span></p>
      <div className="service-chips"><span>{categories.find(c => c.id === salon.category)?.shortLabel}</span><span>Online κράτηση</span></div>
      <div className="salon-bottom"><span>από <strong>{money(Math.min(...salon.services.map(s => s.price)))}</strong></span><button onClick={() => onBook(salon)}>Κλείστε ραντεβού <ArrowUpRight size={16} /></button></div>
    </div>
  </article>;
}

function App() {
  const account = useAccount();
  const pendingSalon = useRef(null);
  const previousUser = useRef(null);
  const [liveSalons, setLiveSalons] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(platformReady);
  const [catalogError, setCatalogError] = useState('');
  const [dateAvailability, setDateAvailability] = useState(null);
  const [availabilityError, setAvailabilityError] = useState('');
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [bookingsError, setBookingsError] = useState('');
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [bookingOwner, setBookingOwner] = useState(null);
  const [rescheduleTarget, setRescheduleTarget] = useState(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const salons = platformReady ? liveSalons : demoSalons;
  const [view, setView] = useState(() => ['business', 'bookings', 'favorites', 'admin'].includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'explore');
  const [category, setCategory] = useState('all');
  const [city, setCity] = useState('all');
  const [cityInput, setCityInput] = useState('all');
  const [dateInput, setDateInput] = useState('');
  const [searchDate, setSearchDate] = useState('');
  const [searchRevision, setSearchRevision] = useState(0);
  const [favorites, setFavorites] = useState(() => { const data = readStorage('meraki-favorites', []); return Array.isArray(data) ? data.filter(id => typeof id === 'string') : []; });
  const [storedBookings, setBookings] = useState(() => { if (platformReady) return []; const data = readStorage('meraki-bookings', []); return Array.isArray(data) ? data.filter(b => b?.id && b?.service && b?.date && b?.salonName) : []; });
  const [demoProfile, setProfile] = useState(() => { const data = readStorage('meraki-profile', null); return data && typeof data === 'object' && typeof data.name === 'string' ? data : null; });
  const [activeSalon, setActiveSalon] = useState(null);
  const [modal, setModal] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [sort, setSort] = useState('recommended');
  const [toast, setToast] = useState('');
  const [cancelId, setCancelId] = useState(null);
  const resultsRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const profile = platformReady ? account.profile : demoProfile;
  const isAdmin = account.user?.app_metadata?.role === 'admin';
  const bookings = platformReady && bookingOwner !== account.user?.id ? [] : storedBookings;

  useEffect(() => {
    if (!platformReady || !['explore', 'favorites'].includes(view)) return;
    let active = true;
    setCatalogLoading(true);
    listSalons().then(data => { if (active) { setLiveSalons(data); setCatalogError(''); } }).catch(error => { if (active) setCatalogError(error.userMessage || error.message); }).finally(() => { if (active) setCatalogLoading(false); });
    return () => { active = false; };
  }, [view]);
  useEffect(() => {
    if (!platformReady) return;
    let active = true;
    const id = account.user?.id;
    setBookings([]); setBookingOwner(id || null); setBookingsError(''); setBookingsLoading(Boolean(id));
    if (!id) return;
    const refresh = () => listBookings().then(data => { if (active) { setBookings(data); setBookingOwner(id); setBookingsError(''); } }).catch(error => { if (active) setBookingsError(error.userMessage || error.message); }).finally(() => { if (active) setBookingsLoading(false); });
    refresh();
    const focus = () => { if (document.visibilityState !== 'hidden') refresh(); };
    const interval = setInterval(focus, 20000);
    window.addEventListener('focus', focus);
    return () => { active = false; clearInterval(interval); window.removeEventListener('focus', focus); };
  }, [account.user?.id]);
  useEffect(() => { if (account.recovery) setModal('account'); }, [account.recovery]);
  useEffect(() => {
    if (previousUser.current && previousUser.current !== account.user?.id) { setActiveSalon(null); setRescheduleTarget(null); setCancelId(null); pendingSalon.current = null; }
    previousUser.current = account.user?.id || null;
  }, [account.user?.id]);
  const openSalon = salon => {
    if (platformReady && !account.user?.email_confirmed_at) { pendingSalon.current = salon; setModal('account'); } else setActiveSalon(salon);
  };
  const closeAccount = () => { setModal(null); if (pendingSalon.current && account.user?.email_confirmed_at) { setActiveSalon(pendingSalon.current); pendingSalon.current = null; } };
  const requireAuth = () => { pendingSalon.current = activeSalon; setActiveSalon(null); setModal('account'); };

  useEffect(() => { const onHash = () => { if (window.location.hash === '#business') setView('business'); else if (window.location.hash === '#bookings') setView('bookings'); else if (window.location.hash === '#favorites') setView('favorites'); else if (window.location.hash === '#admin') setView('admin'); else setView('explore'); }; window.addEventListener('hashchange', onHash); return () => window.removeEventListener('hashchange', onHash); }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 3500); return () => clearTimeout(timer); }, [toast]);
  const persist = (key, data) => { try { localStorage.setItem(key, JSON.stringify(data)); } catch { setToast('Η αποθήκευση δεν είναι διαθέσιμη Οι αλλαγές ισχύουν για αυτή την επίσκεψη'); } };
  const navigate = next => { setView(next); setMenuOpen(false); window.location.hash = next === 'explore' ? '' : next; window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const toggleFavorite = id => { const next = favorites.includes(id) ? favorites.filter(f => f !== id) : [...favorites, id]; setFavorites(next); persist('meraki-favorites', next); };
  const addBooking = booking => {
    if (platformReady) return createBooking(booking).then(saved => { setBookings(current => [...current.filter(b => b.id !== saved.id), saved]); setBookingOwner(account.user.id); return saved; });
    setBookings(current => { const next = [...current, booking]; persist('meraki-bookings', next); return next; });
    return booking;
  };
  const cancelBooking = async () => {
    if (platformReady) { setMutationBusy(true); try { const saved = await cancelRemoteBooking(cancelId); setBookings(current => current.map(b => b.id === saved.id ? saved : b)); setCancelId(null); setToast('Το ραντεβού ακυρώθηκε'); } catch (error) { setToast(error.userMessage || error.message); } finally { setMutationBusy(false); } return; }
    const next = bookings.filter(b => b.id !== cancelId); setBookings(next); persist('meraki-bookings', next); setCancelId(null); setToast('Το δοκιμαστικό ραντεβού ακυρώθηκε');
  };
  const chooseCategory = id => { setCategory(category === id ? 'all' : id); setShowAll(true); };
  const search = event => { event.preventDefault(); setCity(cityInput); setSearchDate(dateInput); setSearchRevision(current => current + 1); setShowAll(true); setView('explore'); setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); };
  const resetFilters = () => { setCategory('all'); setCity('all'); setCityInput('all'); setDateInput(''); setSearchDate(''); setShowAll(false); };
  useEffect(() => {
    if (!platformReady || !searchDate || view !== 'explore') {
      setDateAvailability(null); setAvailabilityError(''); setAvailabilityLoading(false);
      return;
    }
    let active = true;
    const candidates = liveSalons.filter(s => (category === 'all' || s.category === category) && (city === 'all' || s.city === city));
    setDateAvailability(null); setAvailabilityError(''); setAvailabilityLoading(true);
    findAvailableSalonIds(candidates, searchDate, () => active)
      .then(ids => { if (active) setDateAvailability(ids); })
      .catch(() => { if (active) setAvailabilityError('Η διαθεσιμότητα δεν μπόρεσε να ελεγχθεί Πατήστε «Αναζήτηση» για νέα προσπάθεια'); })
      .finally(() => { if (active) setAvailabilityLoading(false); });
    return () => { active = false; };
  }, [liveSalons, searchDate, searchRevision, category, city, view]);
  const filtered = salons.filter(s => (category === 'all' || s.category === category) && (city === 'all' || s.city === city)
    && (!platformReady || !searchDate || dateAvailability?.has(s.id)));
  const sorted = [...filtered].sort((a, b) => sort === 'rating' ? b.rating - a.rating : sort === 'price' ? Math.min(...a.services.map(s => s.price)) - Math.min(...b.services.map(s => s.price)) : 0);
  const visibleSalons = view === 'favorites' ? salons.filter(s => favorites.includes(s.id)) : showAll || category !== 'all' || city !== 'all' ? sorted : sorted.slice(0, 3);
  const isFiltered = category !== 'all' || city !== 'all' || showAll;

  if (platformConfigurationError) return <main className="container inner-page"><h1>Η σύνδεση της υπηρεσίας χρειάζεται έλεγχο</h1><p>Οι ρυθμίσεις του συστήματος κρατήσεων δεν είναι έγκυρες Επικοινωνήστε με τον διαχειριστή</p></main>;

  if (view === 'business') return <Business onBack={() => navigate('explore')} bookings={bookings} />;
  if (view === 'admin') return <Admin onBack={() => navigate('explore')} />;

  return <>
    <header className="site-header"><div className="header-inner"><Brand onClick={() => navigate('explore')} /><nav className="desktop-nav" aria-label="Κύρια πλοήγηση"><button className={view === 'explore' ? 'nav-active' : ''} onClick={() => navigate('explore')}>Ανακαλύψτε</button><button className={view === 'bookings' ? 'nav-active' : ''} onClick={() => navigate('bookings')}>Τα ραντεβού μου{bookings.length > 0 && <span className="nav-count">{bookings.length}</span>}</button><button className={view === 'favorites' ? 'nav-active' : ''} onClick={() => navigate('favorites')}>Αγαπημένα</button>{isAdmin && <button className={view === 'admin' ? 'nav-active' : ''} onClick={() => navigate('admin')}>Διαχείριση</button>}</nav><div className="header-actions"><button className="business-link" onClick={() => navigate('business')}>Για επαγγελματίες <ArrowUpRight size={14} /></button><button className="profile-button" aria-label="Το προφίλ μου" onClick={() => setModal(platformReady ? 'account' : 'profile')}>{profile ? profile.name.charAt(0).toLocaleUpperCase('el') : <UserRound size={19} />}</button><button className="mobile-menu" onClick={() => setMenuOpen(!menuOpen)} aria-label="Μενού" aria-expanded={menuOpen}>{menuOpen ? <X /> : <Menu />}</button></div></div>{menuOpen && <div className="mobile-menu-panel"><button onClick={() => navigate('business')}><Store size={18} /> Για επαγγελματίες <ArrowUpRight size={17} /></button><button onClick={() => setModal('about')}><Sparkles size={18} /> Γνωρίστε το Eneres</button>{isAdmin && <button onClick={() => navigate('admin')}><ShieldCheck size={18} /> Διαχείριση Eneres</button>}</div>}</header>

    <main>
      {view === 'explore' && <>
        <section className="hero"><div className="hero-orbit orbit-left" /><div className="hero-orbit orbit-right" /><div className="hero-content"><h1>Η φροντίδα σας,<br /><em>ένα ραντεβού μακριά</em></h1></div></section>

        <section className="categories-section container"><div className="section-title"><h2>Τι υπηρεσία χρειάζεστε σήμερα;</h2><span className="section-aside">Λίγη φροντίδα, πολλή καλή διάθεση <Sparkles size={15} /></span></div><div className="category-grid">{categories.slice(1).map(c => <button key={c.id} className={`category-card ${category === c.id ? 'category-active' : ''}`} aria-pressed={category === c.id} onClick={() => chooseCategory(c.id)}><Photo index={c.photoIndex} /><span>{c.shortLabel}</span>{category === c.id && <span className="category-check"><Check size={12} /></span>}</button>)}</div></section>

        <section className={`search-section container ${isFiltered ? "search-section--results" : ""}`} aria-label="Αναζήτηση χώρων">
          <form className="search-bar search-bar--compact" onSubmit={search}>
            <CityPicker value={cityInput} onChange={setCityInput} groups={locationGroups} />
            <label className="search-field date-field"><CalendarDays size={17} strokeWidth={1.6} /><span className="date-input-wrap"><input type="date" className={!dateInput ? "date-empty" : undefined} aria-label="Ημερομηνία ραντεβού" lang="el-GR" value={dateInput} min={nextBookableDate()} onChange={e => setDateInput(e.target.value)} />{!dateInput && <span className="date-placeholder" aria-hidden="true">Ημερομηνία</span>}</span></label>
            <button type="submit" className="search-submit" aria-label="Αναζήτηση"><Search size={18} /><span>Αναζήτηση</span></button>
          </form>
          <div className="hero-assurance" aria-hidden="true" />
        </section>
      </>}

      {(view === 'explore' || view === 'favorites') && <section className={`salons-section container ${view === 'favorites' ? 'inner-page' : ''}`} ref={resultsRef}>
        <div className="section-title recommendations-title"><div>{view === 'favorites' ? <span className="overline">ΟΙ ΔΙΚΕΣ ΣΑΣ ΕΠΙΛΟΓΕΣ</span> : <span className="overline overline-space" aria-hidden="true" />}<h2 className={view === 'explore' && category === 'all' ? 'discovery-heading' : undefined}>{view === 'favorites' ? 'Τα αγαπημένα σας' : category === 'all' ? <><span className="discovery-heading-text">Ανακαλύψτε χώρους</span>{city !== 'all' && <span className="discovery-city"> · {city}</span>}</> : `${categories.find(c => c.id === category)?.label}${city !== 'all' ? ` · ${city}` : ''}`}</h2>{view === 'favorites' && <p>Μικρές αδυναμίες που αξίζει να κρατάτε</p>}</div><div className="results-actions">{isFiltered && view !== 'favorites' ? <label className="sort-select"><SlidersHorizontal size={14} /><select aria-label="Ταξινόμηση αποτελεσμάτων" value={sort} onChange={e => setSort(e.target.value)}><option value="recommended">Προτεινόμενα</option><option value="rating">Υψηλότερη βαθμολογία</option><option value="price">Χαμηλότερη τιμή</option></select><ChevronDown size={13} /></label> : view !== 'favorites' && <button className="text-link" onClick={() => setShowAll(true)}>Δείτε όλους τους χώρους <ArrowRight size={17} /></button>}</div></div>
        {isFiltered && view !== 'favorites' && <div className="active-filters"><span>{visibleSalons.length} {visibleSalons.length === 1 ? 'χώρος' : 'χώροι'} για εσάς</span>{category !== 'all' && <span className="filter-pill">{categories.find(c => c.id === category)?.shortLabel}<button aria-label="Αφαίρεση φίλτρου υπηρεσίας" onClick={() => { setCategory('all'); }}><X size={12} /></button></span>}{searchDate && <span className="filter-pill">{dateText(searchDate)}</span>}<button className="clear-filters" onClick={resetFilters}>Καθαρισμός φίλτρων</button></div>}
        {(catalogLoading || availabilityLoading) && view === 'explore' ? <p role="status">{catalogLoading ? 'Φόρτωση χώρων…' : 'Έλεγχος διαθεσιμότητας…'}</p> : (catalogError || availabilityError) && view === 'explore' ? <p role="alert">{catalogError || availabilityError}</p> : visibleSalons.length ? <div className="salon-grid">{visibleSalons.map(s => <SalonCard key={s.id} salon={s} favorite={favorites.includes(s.id)} onFavorite={toggleFavorite} onBook={openSalon} />)}</div> : <div className="empty-state">{view === 'favorites' ? <Heart size={36} strokeWidth={1.3} /> : <Search size={36} strokeWidth={1.3} />}<h3>{view === 'favorites' ? 'Λίγη έμπνευση για τα αγαπημένα σας;' : 'Δεν βρέθηκε ο ιδανικός συνδυασμός… ακόμα'}</h3><p>{view === 'favorites' ? 'Πατήστε την καρδιά σε έναν χώρο και θα τον βρίσκετε πάντα εδώ' : 'Δοκιμάστε μια άλλη πόλη ή αφαιρέστε ένα φίλτρο'}</p><button className="primary-button" onClick={() => { resetFilters(); navigate('explore'); }}>Ανακαλύψτε χώρους <ArrowRight size={16} /></button></div>}
        {!platformReady && view === 'explore' && !isFiltered && <div className="demo-note"><span className="tiny-dot" />Μια πρώτη γεύση του Eneres Οι χώροι και οι κρατήσεις είναι ενδεικτικοί</div>}
      </section>}

      {view === 'bookings' && <section className="container inner-page appointments-page"><div className="section-title"><div><span className="overline">ΛΙΓΟΣ ΧΡΟΝΟΣ ΓΙΑ ΕΣΑΣ</span><h1>Τα ραντεβού σας</h1><p>Όλες οι επόμενες στιγμές φροντίδας, σε ένα μέρος</p></div><button className="text-link" onClick={() => navigate('explore')}>Νέο ραντεβού <ArrowRight size={17} /></button></div>{bookingsError && <p role="alert">{bookingsError}</p>}{platformReady && account.user && bookingsLoading ? <p role="status">Φόρτωση ραντεβού…</p> : platformReady && !account.user ? <div className="empty-state"><UserRound size={32}/><h3>Τα ραντεβού σας, παντού μαζί σας</h3><button className="primary-button" onClick={() => setModal('account')}>Σύνδεση / Δημιουργία λογαριασμού</button></div> : bookings.length === 0 ? <div className="empty-state"><CalendarDays size={38} strokeWidth={1.2} /><h3>Το επόμενο ωραίο πράγμα στη μέρα σας</h3><p>Δεν έχετε ραντεβού ακόμα Ας βρούμε κάτι μόνο για εσάς</p><button className="primary-button" onClick={() => navigate('explore')}>Βρείτε τον χώρο σας <ArrowRight size={16} /></button></div> : <><p className="local-booking-note"><ShieldCheck size={16} />{platformReady ? "Οι κρατήσεις σας συγχρονίζονται με το κατάστημα Η πληρωμή γίνεται στον χώρο του" : "Δοκιμαστικές κρατήσεις, αποθηκευμένες μόνο σε αυτή τη συσκευή Δεν ενημερώνεται πραγματικό κατάστημα"}</p><div className="appointment-list">{[...bookings].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)).map(b => <article className="appointment-card" key={b.id}><Photo index={salons.find(s => s.id === b.salonId)?.photoIndex ?? 8} imageUrl={salons.find(s => s.id === b.salonId)?.imageUrl} placeholder={platformReady && !salons.find(s => s.id === b.salonId)?.imageUrl} /><div className="appointment-info"><span className="appointment-status"><CheckCircle2 size={13} />{platformReady ? ({confirmed:"Επιβεβαιωμένο",cancelled:"Ακυρωμένο",completed:"Ολοκληρωμένο",no_show:"Δεν προσήλθε"}[b.status] || b.status) : "Δοκιμαστική κράτηση"}</span><h3>{b.salonName}</h3><p>{b.service.name} · {b.staff}</p><div className="appointment-date"><CalendarDays size={15} />{dateText(b.date)}<Clock3 size={15} />{b.time}</div></div><div className="appointment-price"><strong>{money(b.service.price)}</strong><span>Πληρωμή στο κατάστημα</span>{(!platformReady || b.status === "confirmed") && <><button onClick={() => setCancelId(b.id)}>Ακύρωση ραντεβού</button>{platformReady && <button onClick={() => setRescheduleTarget(b)}>Αλλαγή ώρας</button>}</>}</div></article>)}</div></>}</section>}

      {view === 'explore' && <><section className="care-strip container" id="how-it-works"><div className="care-heading"><h2>Το ραντεβού σας,<br /><em>με τον δικό σας τρόπο</em></h2></div><div className="care-item"><span className="care-icon"><Search size={21} strokeWidth={1.5} /></span><h3>Βρείτε το δικό σας μέρος</h3><p>Διαλέξτε υπηρεσία και περιοχή<br />Τα υπόλοιπα, αφήστε τα σε εμάς</p></div><div className="care-item"><span className="care-icon"><CalendarDays size={21} strokeWidth={1.5} /></span><h3>Διαλέξτε τη στιγμή σας</h3><p>Ημέρα, ώρα και επαγγελματίας<br />Όλα όπως σας βολεύουν</p></div><div className="care-item"><span className="care-icon"><Heart size={21} strokeWidth={1.5} /></span><h3>Αφεθείτε στη φροντίδα</h3><p>Λιγότερη οργάνωση<br />Περισσότερος χρόνος για εσάς</p></div></section>
      <section className="business-banner container"><div className="business-banner-copy"><span className="overline">ΓΙΑ ΕΠΑΓΓΕΛΜΑΤΙΕΣ</span><h2>Ο χώρος σας<br />Η επόμενη όμορφη ιστορία</h2><p>Γεμίστε το ημερολόγιό σας με νέες γνωριμίες</p><button className="primary-button" onClick={() => navigate('business')}>Γνωρίστε το Eneres Business <ArrowUpRight size={16} /></button></div><Photo index={8} className="business-banner-photo" label="Φωτεινός χώρος κομμωτηρίου με καρέκλες και καθρέφτες" /><div className="business-floating-note"><span><CalendarDays size={19} /></span><div><strong>Μια μέρα γεμάτη δυνατότητες</strong><small>Κάθε ραντεβού, μια νέα αρχή</small></div><CheckCircle2 size={19} /></div></section></>}
    </main>

    <footer className="site-footer container"><div className="footer-top"><div className="footer-nav"><button onClick={() => setModal('about')}>Το Eneres</button><button onClick={() => navigate('business')}>Για επαγγελματίες</button><button onClick={() => navigate('admin')}>Διαχείριση</button><button onClick={() => { navigate('explore'); setTimeout(() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' }), 50); }}>Πώς λειτουργεί</button></div><span className="footer-location"><MapPin size={14} />Φτιαγμένο για Ελλάδα & Κύπρο</span><div className="footer-brand"><Brand onClick={() => navigate('explore')} /></div></div><div className="footer-bottom"><span>© {new Date().getFullYear()} Eneres Φτιαγμένο με φροντίδα</span><span><button onClick={() => setModal('privacy')}>Απόρρητο</button><span>·</span><button onClick={() => setModal('terms')}>Όροι χρήσης</button><span className="language"><Globe2 size={12} />Ελληνικά</span></span></div></footer>
    <nav className="bottom-nav" aria-label="Πλοήγηση κινητού">{[{ id: 'explore', label: 'Εξερεύνηση', Icon: Search }, { id: 'bookings', label: 'Ραντεβού', Icon: CalendarDays }, { id: 'favorites', label: 'Αγαπημένα', Icon: Heart }].map(({ id, label, Icon }) => <button key={id} className={view === id ? 'bottom-active' : ''} onClick={() => navigate(id)}><Icon size={22} strokeWidth={1.6} /><span>{label}</span></button>)}<button className={modal === 'profile' ? 'bottom-active' : ''} onClick={() => setModal(platformReady ? 'account' : 'profile')}><UserRound size={22} strokeWidth={1.6} /><span>Προφίλ</span></button></nav>

    {activeSalon && <Booking salon={activeSalon} onClose={() => setActiveSalon(null)} onConfirm={addBooking} bookings={bookings} initialDate={searchDate} onRequireAuth={requireAuth} />}
    {modal && modal !== 'account' && <InfoModal type={modal} onClose={() => setModal(null)} profile={profile} onSaveProfile={data => { setProfile(data); persist('meraki-profile', data); setModal(null); setToast('Το προφίλ σας αποθηκεύτηκε σε αυτή τη συσκευή'); }} onClear={() => { setProfile(null); setFavorites([]); setBookings([]); ['meraki-profile', 'meraki-bookings', 'meraki-favorites'].forEach(key => localStorage.removeItem(key)); setModal(null); setToast('Τα τοπικά δεδομένα διαγράφηκαν'); }} />}
    {modal === 'account' && <AccountPanel onClose={closeAccount} />}
    {rescheduleTarget && <ReschedulePanel booking={rescheduleTarget} onClose={() => setRescheduleTarget(null)} onSaved={saved => { setBookings(current => current.map(b => b.id === saved.id ? saved : b)); setRescheduleTarget(null); setToast('Το ραντεβού μεταφέρθηκε'); }} />}
    {cancelId && <SimpleDialog title="Να ακυρώσουμε το ραντεβού;" onClose={() => setCancelId(null)}><p>{platformReady ? 'Το ραντεβού θα ακυρωθεί στο σύστημα του καταστήματος, σύμφωνα με την πολιτική ακύρωσης' : 'Το δοκιμαστικό ραντεβού θα αφαιρεθεί από αυτή τη συσκευή'}</p><div className="dialog-actions"><button className="secondary-button" onClick={() => setCancelId(null)}>Διατήρηση</button><button className="primary-button" disabled={mutationBusy} onClick={cancelBooking}>Ναι, ακύρωση</button></div></SimpleDialog>}
    {toast && <div className="toast" role="status"><CheckCircle2 size={18} />{toast}<button onClick={() => setToast('')} aria-label="Κλείσιμο ειδοποίησης"><X size={15} /></button></div>}
  </>;
}

function SimpleDialog({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => { const previous = document.activeElement; const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; ref.current?.focus(); const keydown = e => { if (e.key === 'Escape') onClose(); if (e.key === 'Tab') { const focusable = [...ref.current.querySelectorAll('button, input, select, textarea, a[href]')].filter(el => !el.disabled); if (!focusable.length) return; const first = focusable[0], last = focusable.at(-1); if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } } }; document.addEventListener('keydown', keydown); return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keydown); previous?.focus(); }; }, []);
  return <div className="dialog-backdrop" onClick={e => e.target === e.currentTarget && onClose()}><section role="dialog" aria-modal="true" aria-label={title} className="info-dialog" tabIndex={-1} ref={ref}><button className="dialog-close" onClick={onClose} aria-label="Κλείσιμο"><X size={19} /></button><Brand className="dialog-brand" /><h2>{title}</h2>{children}</section></div>;
}

function InfoModal({ type, onClose, profile, onSaveProfile, onClear }) {
  const [clearing, setClearing] = useState(false);
  if (type === 'profile') return <SimpleDialog title="Ο δικός σας μικρός κόσμος" onClose={onClose}><p>Κρατήστε τα στοιχεία σας για την επόμενη επίσκεψη Το προφίλ αποθηκεύεται μόνο στη συσκευή σας, χωρίς δημιουργία λογαριασμού</p><form className="profile-form" onSubmit={e => { e.preventDefault(); const data = new FormData(e.target); onSaveProfile({ name: data.get('name').trim(), email: data.get('email').trim() }); }}><label>Το όνομά σας<input name="name" placeholder="π.χ. Ελένη" defaultValue={profile?.name || ''} required minLength={2} maxLength={70} autoComplete="given-name" pattern=".*\S.*" /></label><label>Email<input name="email" type="email" placeholder="hello@example.com" defaultValue={profile?.email || ''} required autoComplete="email" maxLength={120} /></label><button type="submit" className="primary-button">Αποθήκευση προφίλ <ArrowRight size={16} /></button></form>{profile && <button className="clear-data" onClick={() => setClearing(true)}>Διαγραφή τοπικών δεδομένων</button>}{clearing && <div className="clear-data-confirm"><p>Θα διαγραφούν το προφίλ, τα αγαπημένα και όλες οι δοκιμαστικές κρατήσεις σας</p><button className="secondary-button" onClick={() => setClearing(false)}>Επιστροφή</button><button className="primary-button" onClick={onClear}>Διαγραφή όλων</button></div>}</SimpleDialog>;
  const liveContent = {
    about: { title: 'Eneres Η φροντίδα σας, πιο κοντά', text: 'Ανακαλύψτε επιχειρήσεις ομορφιάς και ευεξίας στην Ελλάδα και την Κύπρο και κλείστε την ώρα που σας ταιριάζει Οι κρατήσεις επιβεβαιώνονται από το κοινό σύστημα διαθεσιμότητας', extra: 'Η πληρωμή γίνεται απευθείας στο κατάστημα Η επιχείρηση παρέχει την υπηρεσία και εκδίδει το αντίστοιχο παραστατικό' },
    privacy: { title: 'Τα προσωπικά σας δεδομένα', text: 'Για τον λογαριασμό και την κράτησή σας επεξεργαζόμαστε όνομα, email και στοιχεία ραντεβού Αποθηκεύονται στη συνδεδεμένη βάση δεδομένων και είναι προσβάσιμα από εσάς, την επιχείρηση της κράτησης και τους εξουσιοδοτημένους διαχειριστές Ο πάροχος email χρησιμοποιείται για τις απαραίτητες ειδοποιήσεις κράτησης', extra: 'Δεν συλλέγουμε στοιχεία κάρτας Η συνεδρία σύνδεσης διατηρείται στον browser Πριν από την εμπορική έναρξη πρέπει να συμπληρωθούν ο υπεύθυνος επεξεργασίας, τα στοιχεία επικοινωνίας, οι χρόνοι διατήρησης και η διαδικασία άσκησης δικαιωμάτων στην πλήρη πολιτική απορρήτου' },
    terms: { title: 'Η κράτησή σας με το Eneres', text: 'Η υπηρεσία, η τιμή, ο επαγγελματίας και η ώρα εμφανίζονται πριν από την επιβεβαίωση Η κράτηση ισχύει όταν το σύστημα επιστρέψει επιβεβαίωση Η πληρωμή πραγματοποιείται στο κατάστημα· το Eneres δεν χρεώνει την κάρτα σας', extra: 'Η προθεσμία ακύρωσης ή αλλαγής ορίζεται από την επιχείρηση και εμφανίζεται στην κράτηση Μετά την προθεσμία επικοινωνήστε με το κατάστημα Πριν από την εμπορική έναρξη πρέπει να οριστούν ο υπεύθυνος λειτουργίας και οι πλήρεις όροι εξυπηρέτησης' },
  };
  const content = (platformReady ? liveContent : {
    about: { title: 'Eneres Η φροντίδα σας, πιο κοντά', text: 'Το Eneres είναι μια πρώτη ματιά σε έναν πιο απλό τρόπο να κλείνετε ραντεβού ομορφιάς και ευεξίας στην Ελλάδα και την Κύπρο Ανακαλύψτε υπηρεσίες, βρείτε τον χώρο που σας ταιριάζει και δοκιμάστε τη διαδικασία κράτησης', extra: 'Αυτή είναι διαδραστική δοκιμαστική έκδοση Οι χώροι, οι αξιολογήσεις και οι διαθεσιμότητες είναι ενδεικτικά Δεν αποστέλλονται πραγματικές κρατήσεις και δεν πραγματοποιούνται χρεώσεις' },
    privacy: { title: 'Η ιδιωτικότητά σας μετράει', text: 'Αυτή η δοκιμαστική έκδοση διατηρεί το προφίλ, τα αγαπημένα και τις δοκιμαστικές κρατήσεις μόνο στον τοπικό αποθηκευτικό χώρο του προγράμματος περιήγησής σας Δεν στέλνει τα στοιχεία σας σε διακομιστή και δεν συλλέγει στοιχεία κάρτας', extra: 'Μπορείτε να διαγράψετε τα τοπικά δεδομένα από το Προφίλ ή από τις ρυθμίσεις του προγράμματος περιήγησης Τα δεδομένα δεν συγχρονίζονται μεταξύ συσκευών' },
    terms: { title: 'Μια μικρή σημείωση', text: 'Το Eneres βρίσκεται σε δοκιμαστικό στάδιο Οι επιχειρήσεις, οι υπηρεσίες, οι κριτικές, οι τιμές και τα ραντεβού είναι ενδεικτικά και δεν αποτελούν προσφορά ή πραγματική συναλλαγή', extra: 'Η επιλογή «Πληρωμή στο κατάστημα» ολοκληρώνει μόνο μια τοπική δοκιμαστική κράτηση Δεν ενημερώνει κατάστημα και δεν δεσμεύει πραγματικό ραντεβού Οι ηλεκτρονικές πληρωμές και οι λογαριασμοί επιχειρήσεων δεν έχουν συνδεθεί ακόμα' },
  })[type];
  return <SimpleDialog title={content.title} onClose={onClose}><p>{content.text}</p><p className="info-muted">{content.extra}</p><button className="primary-button" onClick={onClose}>Κατάλαβα <Check size={16} /></button></SimpleDialog>;
}

export default App;
