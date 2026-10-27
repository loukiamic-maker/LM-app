import { useSyncExternalStore } from 'react';
import { Globe2 } from 'lucide-react';
import { getLanguage, setLanguage, subscribeLanguage, t } from './i18n';
import './language.css';
export function useLanguage() {
  const language = useSyncExternalStore(subscribeLanguage, getLanguage, () => 'en');
  return { language, setLanguage, t };
}
export default function LanguageSelector() {
  const { language } = useLanguage();
  return <label className="language-selector"><Globe2 size={16} aria-hidden="true" /><select aria-label={t('Γλώσσα', 'Language')} value={language} onChange={event => setLanguage(event.target.value)}><option value="en">English</option><option value="el">Ελληνικά</option></select></label>;
}
