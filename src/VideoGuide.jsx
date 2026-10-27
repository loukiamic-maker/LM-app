import { t, getLanguage } from './i18n';
import { ArrowLeft, BookOpen, VolumeX } from 'lucide-react';
import Brand from './Brand';
import LanguageSelector from './Language';
import { tutorialGuides } from './lib/tutorials';
import './video-guide.css';

export default function VideoGuide({ audience = 'client', onBack }) {
  const guide = tutorialGuides[audience] || tutorialGuides.client;
  return <main className="eneres-video-guide">
    <header className="evg-header"><button type="button" onClick={onBack}><ArrowLeft size={17} />{t("Επιστροφή")}</button><Brand onClick={onBack} /><span><BookOpen size={16} />{t("Οδηγοί Eneres")}</span><LanguageSelector /></header>
    <div className="evg-content"><span className="evg-eyebrow">{t("ΒΗΜΑ ΒΗΜΑ, ΣΤΑ ΕΛΛΗΝΙΚΑ")}</span><h1>{t(guide.title)}</h1><p className="evg-description">{t(guide.description)}</p>
      <video key={`${guide.id}-${getLanguage()}`} className="evg-video" controls playsInline preload="metadata" poster={guide.poster} aria-label={t(guide.title)}>
        <source src={guide.video} type="video/mp4" />
        <track kind="captions" src={guide.captions} srcLang={getLanguage()} label={getLanguage() === 'en' ? 'English' : 'Ελληνικά'} /> {t("Το πρόγραμμα περιήγησής σας δεν υποστηρίζει βίντεο.")} <a href={guide.video}>{t("Ανοίξτε το βίντεο")}</a>
      </video>
      <p className="evg-note"><VolumeX size={15} />{t("Οδηγίες με ελληνικούς υπότιτλους στην οθόνη, χωρίς ήχο")}</p>
      <p className="evg-demo-note">{t("Η παρουσίαση χρησιμοποιεί ενδεικτικά στοιχεία για να δείξει τα βήματα")}</p>
      <details className="evg-transcript"><summary>{t("Διαβάστε τις οδηγίες")}</summary><ol>{guide.steps.map(([title, text]) => <li key={title}><h2>{t(title)}</h2><p>{t(text)}</p></li>)}</ol></details>
      <a className="evg-download" href={guide.video} target="_blank" rel="noopener noreferrer">{t("Άνοιγμα βίντεο σε ξεχωριστή καρτέλα")}</a>
    </div>
  </main>;
}
