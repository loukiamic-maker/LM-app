import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, CalendarDays, Check, CheckCircle2, ChevronDown, Clock3, Globe2, Heart, MapPin, Menu, Search, ShieldCheck, SlidersHorizontal, Sparkles, Star, Store, UserRound, X } from 'lucide-react';
import { categories, salons, locations } from './data';
import Booking from './Booking';
import Business from './Business';

const money = value => new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
const dateText = date => new Date(`${date}T12:00:00`).toLocaleDateString('el-GR', { weekday: 'long', day: 'numeric', month: 'long' });
const nextBookableDate = () => {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Athens' }).format(new Date());
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};
const readStorage = (key, fallback) => { try { const value = JSON.parse(localStorage.getItem(key)); return value ?? fallback; } catch { return fallback; } };

export function Photo({ index = 8, className = '', label, ...props }) {
  return <div {...props} role={label ? 'img' : undefined} aria-label={label} className={`photo ${className}`} style={{ backgroundPosition: `${(index % 4) * 100 / 3}% ${Math.floor(index / 4) * 50}%`, ...props.style }} />;
}

function Flower({ className = '' }) {
  return <svg className={className} aria-hidden="true" viewBox="0 0 40 40" fill="none"><path d="M20 4v32M4 20h32M8.7 8.7l22.6 22.6M8.7 31.3L31.3 8.7" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" /><circle cx="20" cy="20" r="4" fill="currentColor" /></svg>;
}

function Brand({ onClick, light = false }) {
  return <button className={`brand ${light ? 'brand-light' : ''}`} onClick={onClick} aria-label="meraki — Αρχική"><Flower className="brand-flower" /><span>meraki<span className="brand-dot">.</span></span></button>;
}

function SalonCard({ salon, favorite, onFavorite, onBook }) {
  return <article className="salon-card">
    <button className="salon-photo-button" onClick={() => onBook(salon)} aria-label={`Δείτε υπηρεσίες στο ${salon.name}`}><Photo index={salon.photoIndex} label={salon.name} /><span className="photo-overlay" /><span className="salon-photo-tag"><Sparkles size={12} />{salon.category === 'hair' ? 'Αγαπημένο της κοινότητας' : salon.category === 'barber' ? 'Το στυλ έχει χαρακτήρα' : 'Η στιγμή σας, εδώ'}</span></button>
    <button className={`favorite-button ${favorite ? 'is-favorite' : ''}`} aria-label={`${favorite ? 'Αφαίρεση από' : 'Προσθήκη στα'} αγαπημένα: ${salon.name}`} aria-pressed={favorite} onClick={() => onFavorite(salon.id)}><Heart size={19} fill={favorite ? 'currentColor' : 'none'} strokeWidth={1.7} /></button>
    <div className="salon-body"><div className="salon-title-row"><button className="salon-name" onClick={() => onBook(salon)}>{salon.name}</button><span className="rating"><Star size={13} fill="currentColor" />{salon.rating.toFixed(1)}<span>({salon.reviewCount})</span></span></div>
      <p className="salon-location"><MapPin size={13} />{salon.location}<span className="country-dot">·</span>{salon.country}</p>
      <div className="service-chips"><span>{categories.find(c => c.id === salon.category)?.shortLabel}</span><span>Online κράτηση</span></div>
      <div className="salon-bottom"><span>από <strong>{money(Math.min(...salon.services.map(s => s.price)))}</strong></span><button onClick={() => onBook(salon)}>Κλείστε ραντεβού <ArrowUpRight size={16} /></button></div>
    </div>
  </article>;
}

function App() {
  const [view, setView] = useState(() => ['business', 'bookings', 'favorites'].includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'explore');
  const [market, setMarket] = useState('all');
  const [category, setCategory] = useState('all');
  const [city, setCity] = useState('all');
  const [cityInput, setCityInput] = useState('all');
  const [searchDate, setSearchDate] = useState('');
  const [favorites, setFavorites] = useState(() => { const data = readStorage('meraki-favorites', []); return Array.isArray(data) ? data.filter(id => typeof id === 'string') : []; });
  const [bookings, setBookings] = useState(() => { const data = readStorage('meraki-bookings', []); return Array.isArray(data) ? data.filter(b => b?.id && b?.service && b?.date && b?.salonName) : []; });
  const [profile, setProfile] = useState(() => { const data = readStorage('meraki-profile', null); return data && typeof data === 'object' && typeof data.name === 'string' ? data : null; });
  const [activeSalon, setActiveSalon] = useState(null);
  const [modal, setModal] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [sort, setSort] = useState('recommended');
  const [toast, setToast] = useState('');
  const [cancelId, setCancelId] = useState(null);
  const resultsRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => { const onHash = () => { if (window.location.hash === '#business') setView('business'); else if (window.location.hash === '#bookings') setView('bookings'); else if (window.location.hash === '#favorites') setView('favorites'); else setView('explore'); }; window.addEventListener('hashchange', onHash); return () => window.removeEventListener('hashchange', onHash); }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 3500); return () => clearTimeout(timer); }, [toast]);
  const persist = (key, data) => { try { localStorage.setItem(key, JSON.stringify(data)); } catch { setToast('Η αποθήκευση δεν είναι διαθέσιμη. Οι αλλαγές ισχύουν για αυτή την επίσκεψη.'); } };
  const navigate = next => { setView(next); setMenuOpen(false); window.location.hash = next === 'explore' ? '' : next; window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const toggleFavorite = id => { const next = favorites.includes(id) ? favorites.filter(f => f !== id) : [...favorites, id]; setFavorites(next); persist('meraki-favorites', next); };
  const addBooking = booking => { setBookings(current => { const next = [...current, booking]; persist('meraki-bookings', next); return next; }); };
  const cancelBooking = () => { const next = bookings.filter(b => b.id !== cancelId); setBookings(next); persist('meraki-bookings', next); setCancelId(null); setToast('Το δοκιμαστικό ραντεβού ακυρώθηκε.'); };
  const changeMarket = value => { setMarket(value); setCity('all'); setCityInput('all'); setShowAll(true); };
  const chooseCategory = id => { setCategory(category === id ? 'all' : id); setShowAll(true); };
  const search = event => { event.preventDefault(); setCity(cityInput); setShowAll(true); setView('explore'); setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); };
  const resetFilters = () => { setCategory('all'); setCity('all'); setCityInput('all'); setSearchDate(''); setMarket('all'); setShowAll(false); };
  const allowedCities = locations.filter(place => market === 'all' || salons.some(s => s.city === place && s.country === market));
  const filtered = salons.filter(s => (market === 'all' || s.country === market) && (category === 'all' || s.category === category) && (city === 'all' || s.city === city));
  const sorted = [...filtered].sort((a, b) => sort === 'rating' ? b.rating - a.rating : sort === 'price' ? Math.min(...a.services.map(s => s.price)) - Math.min(...b.services.map(s => s.price)) : 0);
  const visibleSalons = view === 'favorites' ? salons.filter(s => favorites.includes(s.id)) : showAll || category !== 'all' || city !== 'all' || market !== 'all' ? sorted : sorted.slice(0, 3);
  const isFiltered = category !== 'all' || city !== 'all' || market !== 'all' || showAll;

  if (view === 'business') return <Business onBack={() => navigate('explore')} bookings={bookings} />;

  return <>
    <header className="site-header"><div className="header-inner"><nav className="desktop-nav" aria-label="Κύρια πλοήγηση"><button className={view === 'explore' ? 'nav-active' : ''} onClick={() => navigate('explore')}>Ανακαλύψτε</button><button className={view === 'bookings' ? 'nav-active' : ''} onClick={() => navigate('bookings')}>Τα ραντεβού μου{bookings.length > 0 && <span className="nav-count">{bookings.length}</span>}</button><button className={view === 'favorites' ? 'nav-active' : ''} onClick={() => navigate('favorites')}>Αγαπημένα</button></nav><div className="header-actions"><div className="market-select"><Globe2 size={15} /><select aria-label="Επιλογή χώρας" value={market} onChange={e => changeMarket(e.target.value)}><option value="all">Ελλάδα & Κύπρος</option><option value="Ελλάδα">Ελλάδα</option><option value="Κύπρος">Κύπρος</option></select><ChevronDown size={12} /></div><button className="business-link" onClick={() => navigate('business')}>Για επαγγελματίες <ArrowUpRight size={14} /></button><button className="profile-button" aria-label="Το προφίλ μου" onClick={() => setModal('profile')}>{profile ? profile.name.charAt(0).toLocaleUpperCase('el') : <UserRound size={19} />}</button><button className="mobile-menu" onClick={() => setMenuOpen(!menuOpen)} aria-label="Μενού" aria-expanded={menuOpen}>{menuOpen ? <X /> : <Menu />}</button></div></div>{menuOpen && <div className="mobile-menu-panel"><button onClick={() => navigate('business')}><Store size={18} /> Για επαγγελματίες <ArrowUpRight size={17} /></button><button onClick={() => setModal('about')}><Sparkles size={18} /> Γνωρίστε το meraki</button></div>}</header>

    <main>
      {view === 'explore' && <>
        <section className="hero"><div className="hero-orbit orbit-left" /><div className="hero-orbit orbit-right" /><div className="hero-content"><h1>Η φροντίδα σας,<br /><em>ένα ραντεβού μακριά.</em></h1></div></section>

        <section className="categories-section container"><div className="section-title"><h2>Τι θα κάνουμε σήμερα;</h2><span className="section-aside">Λίγη φροντίδα, πολλή καλή διάθεση <Sparkles size={15} /></span></div><div className="category-grid">{categories.slice(1).map(c => <button key={c.id} className={`category-card ${category === c.id ? 'category-active' : ''}`} aria-pressed={category === c.id} onClick={() => chooseCategory(c.id)}><Photo index={c.photoIndex} /><span>{c.shortLabel}</span>{category === c.id && <span className="category-check"><Check size={12} /></span>}</button>)}</div></section>

        <section className={`search-section container ${isFiltered ? "search-section--results" : ""}`} aria-label="Αναζήτηση χώρων">
          <form className="search-bar search-bar--compact" onSubmit={search}>
            <label className="search-field city-field"><MapPin size={17} strokeWidth={1.6} /><span><select aria-label="Πόλη ή περιοχή" value={cityInput} onChange={e => setCityInput(e.target.value)}><option value="all">Πόλη</option>{allowedCities.map(c => <option key={c}>{c}</option>)}</select></span><ChevronDown size={12} /></label>
            <label className="search-field date-field"><CalendarDays size={17} strokeWidth={1.6} /><span className="date-input-wrap"><input type="date" className={!searchDate ? "date-empty" : undefined} aria-label="Ημερομηνία ραντεβού" lang="el-GR" value={searchDate} min={nextBookableDate()} onChange={e => setSearchDate(e.target.value)} />{!searchDate && <span className="date-placeholder" aria-hidden="true">Ημερομηνία</span>}</span></label>
            <button type="submit" className="search-submit" aria-label="Αναζήτηση"><Search size={18} /><span>Αναζήτηση</span></button>
          </form>
          <div className="hero-assurance"><Check size={13} /> Εύκολα. Γρήγορα. Χωρίς τηλεφώνημα.<span className="assurance-dot">·</span><span>Ο δικός σας χρόνος μετράει.</span></div>
        </section>
      </>}

      {(view === 'explore' || view === 'favorites') && <section className={`salons-section container ${view === 'favorites' ? 'inner-page' : ''}`} ref={resultsRef}>
        <div className="section-title recommendations-title"><div><span className="overline">{view === 'favorites' ? 'ΟΙ ΔΙΚΕΣ ΣΑΣ ΕΠΙΛΟΓΕΣ' : isFiltered ? 'ΒΡΕΙΤΕ ΑΥΤΟ ΠΟΥ ΣΑΣ ΤΑΙΡΙΑΖΕΙ' : 'ΧΩΡΟΙ ΠΟΥ ΘΑ ΑΓΑΠΗΣΕΤΕ'}</span><h2>{view === 'favorites' ? 'Τα αγαπημένα σας' : isFiltered ? `${category === 'all' ? 'Ανακαλύψτε χώρους' : categories.find(c => c.id === category)?.label}${city !== 'all' ? ` · ${city}` : ''}` : 'Μια καλή αρχή για εσάς'}</h2>{view === 'favorites' && <p>Μικρές αδυναμίες που αξίζει να κρατάτε.</p>}</div><div className="results-actions">{isFiltered && view !== 'favorites' ? <label className="sort-select"><SlidersHorizontal size={14} /><select aria-label="Ταξινόμηση αποτελεσμάτων" value={sort} onChange={e => setSort(e.target.value)}><option value="recommended">Προτεινόμενα</option><option value="rating">Υψηλότερη βαθμολογία</option><option value="price">Χαμηλότερη τιμή</option></select><ChevronDown size={13} /></label> : view !== 'favorites' && <button className="text-link" onClick={() => setShowAll(true)}>Δείτε όλους τους χώρους <ArrowRight size={17} /></button>}</div></div>
        {isFiltered && view !== 'favorites' && <div className="active-filters"><span>{visibleSalons.length} {visibleSalons.length === 1 ? 'χώρος' : 'χώροι'} για εσάς</span>{market !== 'all' && <span className="filter-pill">{market}</span>}{category !== 'all' && <span className="filter-pill">{categories.find(c => c.id === category)?.shortLabel}<button aria-label="Αφαίρεση φίλτρου υπηρεσίας" onClick={() => { setCategory('all'); }}><X size={12} /></button></span>}{searchDate && <span className="filter-pill">{dateText(searchDate)}</span>}<button className="clear-filters" onClick={resetFilters}>Καθαρισμός φίλτρων</button></div>}
        {visibleSalons.length ? <div className="salon-grid">{visibleSalons.map(s => <SalonCard key={s.id} salon={s} favorite={favorites.includes(s.id)} onFavorite={toggleFavorite} onBook={setActiveSalon} />)}</div> : <div className="empty-state">{view === 'favorites' ? <Heart size={36} strokeWidth={1.3} /> : <Search size={36} strokeWidth={1.3} />}<h3>{view === 'favorites' ? 'Λίγη έμπνευση για τα αγαπημένα σας;' : 'Δεν βρέθηκε ο ιδανικός συνδυασμός… ακόμα.'}</h3><p>{view === 'favorites' ? 'Πατήστε την καρδιά σε έναν χώρο και θα τον βρίσκετε πάντα εδώ.' : 'Δοκιμάστε μια άλλη πόλη ή αφαιρέστε ένα φίλτρο.'}</p><button className="primary-button" onClick={() => { resetFilters(); navigate('explore'); }}>Ανακαλύψτε χώρους <ArrowRight size={16} /></button></div>}
        {view === 'explore' && !isFiltered && <div className="demo-note"><span className="tiny-dot" />Μια πρώτη γεύση του meraki. Οι χώροι και οι κρατήσεις είναι ενδεικτικοί.</div>}
      </section>}

      {view === 'bookings' && <section className="container inner-page appointments-page"><div className="section-title"><div><span className="overline">ΛΙΓΟΣ ΧΡΟΝΟΣ ΓΙΑ ΕΣΑΣ</span><h1>Τα ραντεβού σας</h1><p>Όλες οι επόμενες στιγμές φροντίδας, σε ένα μέρος.</p></div><button className="text-link" onClick={() => navigate('explore')}>Νέο ραντεβού <ArrowRight size={17} /></button></div>{bookings.length === 0 ? <div className="empty-state"><CalendarDays size={38} strokeWidth={1.2} /><h3>Το επόμενο ωραίο πράγμα στη μέρα σας.</h3><p>Δεν έχετε ραντεβού ακόμα. Ας βρούμε κάτι μόνο για εσάς.</p><button className="primary-button" onClick={() => navigate('explore')}>Βρείτε τον χώρο σας <ArrowRight size={16} /></button></div> : <><p className="local-booking-note"><ShieldCheck size={16} />Δοκιμαστικές κρατήσεις, αποθηκευμένες μόνο σε αυτή τη συσκευή. Δεν ενημερώνεται πραγματικό κατάστημα.</p><div className="appointment-list">{[...bookings].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)).map(b => <article className="appointment-card" key={b.id}><Photo index={salons.find(s => s.id === b.salonId)?.photoIndex ?? 8} /><div className="appointment-info"><span className="appointment-status"><CheckCircle2 size={13} />Δοκιμαστική κράτηση</span><h3>{b.salonName}</h3><p>{b.service.name} · {b.staff}</p><div className="appointment-date"><CalendarDays size={15} />{dateText(b.date)}<Clock3 size={15} />{b.time}</div></div><div className="appointment-price"><strong>{money(b.service.price)}</strong><span>Πληρωμή στο κατάστημα</span><button onClick={() => setCancelId(b.id)}>Ακύρωση ραντεβού</button></div></article>)}</div></>}</section>}

      {view === 'explore' && <><section className="care-strip container" id="how-it-works"><div className="care-heading"><span className="overline">ΛΙΓΟ ΠΙΟ ΑΠΛΑ. ΛΙΓΟ ΠΙΟ ΟΜΟΡΦΑ.</span><h2>Το ραντεβού σας,<br /><em>με τον δικό σας τρόπο.</em></h2></div><div className="care-item"><span className="care-icon"><Search size={21} strokeWidth={1.5} /></span><h3>Βρείτε το δικό σας μέρος</h3><p>Διαλέξτε υπηρεσία και περιοχή.<br />Τα υπόλοιπα, αφήστε τα σε εμάς.</p></div><div className="care-item"><span className="care-icon"><CalendarDays size={21} strokeWidth={1.5} /></span><h3>Διαλέξτε τη στιγμή σας</h3><p>Ημέρα, ώρα και επαγγελματίας.<br />Όλα όπως σας βολεύουν.</p></div><div className="care-item"><span className="care-icon"><Heart size={21} strokeWidth={1.5} /></span><h3>Αφεθείτε στη φροντίδα</h3><p>Λιγότερη οργάνωση.<br />Περισσότερος χρόνος για εσάς.</p></div></section>
      <section className="business-banner container"><div className="business-banner-copy"><span className="overline">ΓΙΑ ΑΝΘΡΩΠΟΥΣ ΜΕ ΜΕΡΑΚΙ</span><h2>Ο χώρος σας.<br />Η επόμενη όμορφη ιστορία.</h2><p>Γεμίστε το ημερολόγιό σας με νέες γνωριμίες.<br />Εσείς βάζετε το μεράκι. Εμείς την οργάνωση.</p><button className="primary-button" onClick={() => navigate('business')}>Γνωρίστε το meraki Business <ArrowUpRight size={16} /></button></div><Photo index={8} className="business-banner-photo" label="Φωτεινός χώρος κομμωτηρίου με καρέκλες και καθρέφτες" /><div className="business-floating-note"><span><CalendarDays size={19} /></span><div><strong>Μια μέρα γεμάτη δυνατότητες.</strong><small>Κάθε ραντεβού, μια νέα αρχή.</small></div><CheckCircle2 size={19} /></div></section></>}
    </main>

    <footer className="site-footer container"><div className="footer-top"><div><Brand onClick={() => navigate('explore')} /><p>Λίγος χρόνος. Πολύ μεράκι.</p></div><div className="footer-nav"><button onClick={() => setModal('about')}>Το meraki</button><button onClick={() => navigate('business')}>Για επαγγελματίες</button><button onClick={() => { navigate('explore'); setTimeout(() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' }), 50); }}>Πώς λειτουργεί</button></div><span className="footer-location"><MapPin size={14} />Φτιαγμένο για Ελλάδα & Κύπρο</span></div><div className="footer-bottom"><span>© {new Date().getFullYear()} meraki. Φτιαγμένο με φροντίδα.</span><span><button onClick={() => setModal('privacy')}>Απόρρητο</button><span>·</span><button onClick={() => setModal('terms')}>Όροι χρήσης</button><span className="language"><Globe2 size={12} />Ελληνικά</span></span></div></footer>
    <nav className="bottom-nav" aria-label="Πλοήγηση κινητού">{[{ id: 'explore', label: 'Εξερεύνηση', Icon: Search }, { id: 'bookings', label: 'Ραντεβού', Icon: CalendarDays }, { id: 'favorites', label: 'Αγαπημένα', Icon: Heart }].map(({ id, label, Icon }) => <button key={id} className={view === id ? 'bottom-active' : ''} onClick={() => navigate(id)}><Icon size={22} strokeWidth={1.6} /><span>{label}</span></button>)}<button className={modal === 'profile' ? 'bottom-active' : ''} onClick={() => setModal('profile')}><UserRound size={22} strokeWidth={1.6} /><span>Προφίλ</span></button></nav>

    {activeSalon && <Booking salon={activeSalon} onClose={() => setActiveSalon(null)} onConfirm={addBooking} bookings={bookings} initialDate={searchDate} />}
    {modal && <InfoModal type={modal} onClose={() => setModal(null)} profile={profile} onSaveProfile={data => { setProfile(data); persist('meraki-profile', data); setModal(null); setToast('Το προφίλ σας αποθηκεύτηκε σε αυτή τη συσκευή.'); }} onClear={() => { setProfile(null); setFavorites([]); setBookings([]); ['meraki-profile', 'meraki-bookings', 'meraki-favorites'].forEach(key => localStorage.removeItem(key)); setModal(null); setToast('Τα τοπικά δεδομένα διαγράφηκαν.'); }} />}
    {cancelId && <SimpleDialog title="Να ακυρώσουμε το ραντεβού;" onClose={() => setCancelId(null)}><p>Το δοκιμαστικό ραντεβού θα αφαιρεθεί από αυτή τη συσκευή.</p><div className="dialog-actions"><button className="secondary-button" onClick={() => setCancelId(null)}>Διατήρηση</button><button className="primary-button" onClick={cancelBooking}>Ναι, ακύρωση</button></div></SimpleDialog>}
    {toast && <div className="toast" role="status"><CheckCircle2 size={18} />{toast}<button onClick={() => setToast('')} aria-label="Κλείσιμο ειδοποίησης"><X size={15} /></button></div>}
  </>;
}

function SimpleDialog({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => { const previous = document.activeElement; const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; ref.current?.focus(); const keydown = e => { if (e.key === 'Escape') onClose(); if (e.key === 'Tab') { const focusable = [...ref.current.querySelectorAll('button, input, select, textarea, a[href]')].filter(el => !el.disabled); if (!focusable.length) return; const first = focusable[0], last = focusable.at(-1); if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } } }; document.addEventListener('keydown', keydown); return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keydown); previous?.focus(); }; }, []);
  return <div className="dialog-backdrop" onClick={e => e.target === e.currentTarget && onClose()}><section role="dialog" aria-modal="true" aria-label={title} className="info-dialog" tabIndex={-1} ref={ref}><button className="dialog-close" onClick={onClose} aria-label="Κλείσιμο"><X size={19} /></button><Flower className="dialog-flower" /><h2>{title}</h2>{children}</section></div>;
}

function InfoModal({ type, onClose, profile, onSaveProfile, onClear }) {
  const [clearing, setClearing] = useState(false);
  if (type === 'profile') return <SimpleDialog title="Ο δικός σας μικρός κόσμος." onClose={onClose}><p>Κρατήστε τα στοιχεία σας για την επόμενη επίσκεψη. Το προφίλ αποθηκεύεται μόνο στη συσκευή σας, χωρίς δημιουργία λογαριασμού.</p><form className="profile-form" onSubmit={e => { e.preventDefault(); const data = new FormData(e.target); onSaveProfile({ name: data.get('name').trim(), email: data.get('email').trim() }); }}><label>Το όνομά σας<input name="name" placeholder="π.χ. Ελένη" defaultValue={profile?.name || ''} required minLength={2} maxLength={70} autoComplete="given-name" pattern=".*\S.*" /></label><label>Email<input name="email" type="email" placeholder="hello@example.com" defaultValue={profile?.email || ''} required autoComplete="email" maxLength={120} /></label><button type="submit" className="primary-button">Αποθήκευση προφίλ <ArrowRight size={16} /></button></form>{profile && <button className="clear-data" onClick={() => setClearing(true)}>Διαγραφή τοπικών δεδομένων</button>}{clearing && <div className="clear-data-confirm"><p>Θα διαγραφούν το προφίλ, τα αγαπημένα και όλες οι δοκιμαστικές κρατήσεις σας.</p><button className="secondary-button" onClick={() => setClearing(false)}>Επιστροφή</button><button className="primary-button" onClick={onClear}>Διαγραφή όλων</button></div>}</SimpleDialog>;
  const content = {
    about: { title: 'Λίγος χρόνος. Πολύ μεράκι.', text: 'Το meraki είναι μια πρώτη ματιά σε έναν πιο απλό τρόπο να κλείνετε ραντεβού ομορφιάς και ευεξίας στην Ελλάδα και την Κύπρο. Ανακαλύψτε υπηρεσίες, βρείτε τον χώρο που σας ταιριάζει και δοκιμάστε τη διαδικασία κράτησης.', extra: 'Αυτή είναι διαδραστική δοκιμαστική έκδοση. Οι χώροι, οι αξιολογήσεις και οι διαθεσιμότητες είναι ενδεικτικά. Δεν αποστέλλονται πραγματικές κρατήσεις και δεν πραγματοποιούνται χρεώσεις.' },
    privacy: { title: 'Η ιδιωτικότητά σας μετράει.', text: 'Αυτή η δοκιμαστική έκδοση διατηρεί το προφίλ, τα αγαπημένα και τις δοκιμαστικές κρατήσεις μόνο στον τοπικό αποθηκευτικό χώρο του προγράμματος περιήγησής σας. Δεν στέλνει τα στοιχεία σας σε διακομιστή και δεν συλλέγει στοιχεία κάρτας.', extra: 'Μπορείτε να διαγράψετε τα τοπικά δεδομένα από το Προφίλ ή από τις ρυθμίσεις του προγράμματος περιήγησης. Τα δεδομένα δεν συγχρονίζονται μεταξύ συσκευών.' },
    terms: { title: 'Μια μικρή σημείωση.', text: 'Το meraki βρίσκεται σε δοκιμαστικό στάδιο. Οι επιχειρήσεις, οι υπηρεσίες, οι κριτικές, οι τιμές και τα ραντεβού είναι ενδεικτικά και δεν αποτελούν προσφορά ή πραγματική συναλλαγή.', extra: 'Η επιλογή «Πληρωμή στο κατάστημα» ολοκληρώνει μόνο μια τοπική δοκιμαστική κράτηση. Δεν ενημερώνει κατάστημα και δεν δεσμεύει πραγματικό ραντεβού. Οι ηλεκτρονικές πληρωμές και οι λογαριασμοί επιχειρήσεων δεν έχουν συνδεθεί ακόμα.' },
  }[type];
  return <SimpleDialog title={content.title} onClose={onClose}><p>{content.text}</p><p className="info-muted">{content.extra}</p><button className="primary-button" onClick={onClose}>Κατάλαβα <Check size={16} /></button></SimpleDialog>;
}

export default App;
