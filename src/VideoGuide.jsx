import { ArrowLeft, BookOpen, VolumeX } from 'lucide-react';
import Brand from './Brand';
import { tutorialGuides } from './lib/tutorials';
import './video-guide.css';

export default function VideoGuide({ audience = 'client', onBack }) {
  const guide = tutorialGuides[audience] || tutorialGuides.client;
  return <main className="eneres-video-guide">
    <header className="evg-header"><button type="button" onClick={onBack}><ArrowLeft size={17} />Επιστροφή</button><Brand onClick={onBack} /><span><BookOpen size={16} />Οδηγοί Eneres</span></header>
    <div className="evg-content"><span className="evg-eyebrow">ΒΗΜΑ ΒΗΜΑ, ΣΤΑ ΕΛΛΗΝΙΚΑ</span><h1>{guide.title}</h1><p className="evg-description">{guide.description}</p>
      <video key={guide.id} className="evg-video" controls playsInline preload="metadata" poster={guide.poster} aria-label={guide.title}>
        <source src={guide.video} type="video/mp4" />
        <track kind="captions" src={guide.captions} srcLang="el" label="Ελληνικά" />
        Το πρόγραμμα περιήγησής σας δεν υποστηρίζει βίντεο. <a href={guide.video}>Ανοίξτε το βίντεο</a>
      </video>
      <p className="evg-note"><VolumeX size={15} />Οδηγίες με ελληνικούς υπότιτλους στην οθόνη, χωρίς ήχο</p>
      <p className="evg-demo-note">Η παρουσίαση χρησιμοποιεί ενδεικτικά στοιχεία για να δείξει τα βήματα</p>
      <details className="evg-transcript"><summary>Διαβάστε τις οδηγίες</summary><ol>{guide.steps.map(([title, text]) => <li key={title}><h2>{title}</h2><p>{text}</p></li>)}</ol></details>
      <a className="evg-download" href={guide.video} target="_blank" rel="noopener noreferrer">Άνοιγμα βίντεο σε ξεχωριστή καρτέλα</a>
    </div>
  </main>;
}
