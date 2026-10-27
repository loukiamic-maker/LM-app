import { t, getLanguage } from './i18n';
import { Globe2, MapPin } from 'lucide-react';
import Brand from './Brand';
import './site-footer.css';

export default function SiteFooter({ onNavigate, onInfo, onHowItWorks, mobileNavigation = true }) {
  const navigate = view => onNavigate?.(view);
  const showInfo = type => onInfo?.(type);

  return <footer className={`eneres-site-footer${mobileNavigation ? ' eneres-site-footer--mobile-nav' : ''}`}>
    <div className="eneres-footer-brand-row"><Brand onClick={() => navigate('explore')} /></div>
    <div className="eneres-footer-links">
      <nav className="eneres-footer-nav" aria-label={t("Πληροφορίες Eneres")}>
        <button type="button" onClick={() => showInfo('about')}>{t("Το Eneres")}</button>
        <button type="button" onClick={() => navigate('business')}>{t("Για επαγγελματίες")}</button>
        <button type="button" onClick={() => navigate('admin')}>{t("Διαχείριση")}</button>
        <button type="button" onClick={() => onHowItWorks?.()}>{t("Πώς λειτουργεί")}</button>
      </nav>
      <span className="eneres-footer-location"><MapPin size={13} aria-hidden="true" />{t("Φτιαγμένο για Ελλάδα & Κύπρο")}</span>
    </div>
    <div className="eneres-footer-bottom">
      <span>© {new Date().getFullYear()} {t("Eneres. Φτιαγμένο με φροντίδα")}</span>
      <div className="eneres-footer-legal">
        <button type="button" onClick={() => showInfo('privacy')}>{t("Απόρρητο")}</button>
        <span aria-hidden="true">·</span>
        <button type="button" onClick={() => showInfo('terms')}>{t("Όροι χρήσης")}</button>
        <span className="eneres-footer-language"><Globe2 size={12} aria-hidden="true" />{getLanguage() === 'en' ? 'English' : 'Ελληνικά'}</span>
      </div>
    </div>
  </footer>;
}
