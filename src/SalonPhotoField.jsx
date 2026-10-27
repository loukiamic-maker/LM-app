import { t, getLocale } from "./i18n";import { useEffect, useId, useRef, useState } from 'react';
import { ImagePlus, Upload, X } from 'lucide-react';
import { validateSalonPhoto } from './lib/salonPhotos';

export default function SalonPhotoField({ salon, name, city, country, file, onChange, disabled, onChecking }) {
  const id = useId();
  const [previewUrl, setPreviewUrl] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const selection = useRef(0);
  const input = useRef(null);
  useEffect(() => {
    if (!file) {setPreviewUrl('');return undefined;}
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => () => {selection.current++;}, []);

  async function choose(event) {
    const candidate = event.target.files?.[0];
    if (!candidate) return;
    const request = ++selection.current;
    setChecking(true);onChecking(true);setError('');
    try {
      await validateSalonPhoto(candidate);
      if (request === selection.current) onChange(candidate);
    } catch (failure) {
      if (request === selection.current) setError(failure.userMessage || t("Η φωτογραφία δεν μπορεί να ανοίξει. Επιλέξτε άλλο αρχείο"));
    } finally {
      if (request === selection.current) {setChecking(false);onChecking(false);}
      if (input.current) input.current.value = '';
    }
  }

  const image = previewUrl || salon.imageUrl;
  return <section className="lb-photo-editor" aria-labelledby={`${id}-label`}>
    <span className="lb-photo-label" id={`${id}-label`}>{t("Φωτογραφία επιχείρησης")}</span>
    <div className="lb-photo-controls"><label className={`lb-secondary lb-photo-picker${disabled || checking ? ' lb-photo-disabled' : ''}`}><Upload size={16} /><span>{checking ? t("Έλεγχος φωτογραφίας…") : image ? t("Αλλαγή φωτογραφίας") : t("Επιλογή φωτογραφίας")}<input ref={input} className="lb-sr-only" type="file" accept="image/jpeg,image/png,image/webp" aria-labelledby={`${id}-label`} aria-describedby={`${id}-help`} disabled={disabled || checking} onChange={choose} /></span></label>{file && <button type="button" className="lb-text-button" disabled={disabled || checking} onClick={() => {selection.current++;onChange(null);setError('');}}><X size={14} />{t("Αναίρεση επιλογής")}</button>}</div>
    <p className="lb-note" id={`${id}-help`}>{t("Επιλέξτε από τις φωτογραφίες του κινητού ή του υπολογιστή σας. JPG, PNG ή WebP έως 5 MB. Η φωτογραφία της επιχείρησης θα είναι δημόσια")}</p>
    {error && <p className="lb-photo-error" role="alert">{t(error)}</p>}
    <div className="lb-photo-preview-label">{t("Προεπισκόπηση καταχώρισης")}</div>
    <article className="lb-photo-preview">{image ? <img src={image} alt={t("Προεπισκόπηση φωτογραφίας επιχείρησης")} /> : <div className="lb-photo-placeholder"><ImagePlus size={30} /><span>{t("Η φωτογραφία σας θα εμφανιστεί εδώ")}</span></div>}<div><strong>{name || salon.name}</strong><span>{[city, country].filter(Boolean).map((value) => t(value)).join(', ')}</span></div></article>
    {file && <p className="lb-note lb-photo-pending" role="status">{t("Νέα φωτογραφία — θα αποθηκευτεί μαζί με τις αλλαγές")}</p>}
  </section>;
}
