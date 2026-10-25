import { Globe2, MapPin } from 'lucide-react';
import Brand from './Brand';
import './site-footer.css';

export default function SiteFooter({ onNavigate, onInfo, onHowItWorks, mobileNavigation = true }) {
  const navigate = view => onNavigate?.(view);
  const showInfo = type => onInfo?.(type);

  return <footer className={`eneres-site-footer${mobileNavigation ? ' eneres-site-footer--mobile-nav' : ''}`}>
    <div className="eneres-footer-brand-row"><Brand onClick={() => navigate('explore')} /></div>
    <div className="eneres-footer-links">
      <nav className="eneres-footer-nav" aria-label="Πληροφορίες Eneres">
        <button type="button" onClick={() => showInfo('about')}>Το Eneres</button>
        <button type="button" onClick={() => navigate('business')}>Για επαγγελματίες</button>
        <button type="button" onClick={() => navigate('admin')}>Διαχείριση</button>
        <button type="button" onClick={() => onHowItWorks?.()}>Πώς λειτουργεί</button>
      </nav>
      <span className="eneres-footer-location"><MapPin size={13} aria-hidden="true" />Φτιαγμένο για Ελλάδα & Κύπρο</span>
    </div>
    <div className="eneres-footer-bottom">
      <span>© {new Date().getFullYear()} Eneres. Φτιαγμένο με φροντίδα</span>
      <div className="eneres-footer-legal">
        <button type="button" onClick={() => showInfo('privacy')}>Απόρρητο</button>
        <span aria-hidden="true">·</span>
        <button type="button" onClick={() => showInfo('terms')}>Όροι χρήσης</button>
        <span className="eneres-footer-language"><Globe2 size={12} aria-hidden="true" />Ελληνικά</span>
      </div>
    </div>
  </footer>;
}
