import { useEffect, useId, useRef, useState } from 'react';
import { joinPhone, phoneCountries, splitPhone } from './lib/phone';
import { t } from './i18n';
import { useLanguage } from './Language';
import './phone-field.css';

export default function PhoneField({ value = '', onChange, disabled = false, required = true }) {
  useLanguage();
  const initial = splitPhone(value);
  const [countryId, setCountryId] = useState(initial.country);
  const [number, setNumber] = useState(initial.number);
  const emitted = useRef(value);
  const id = useId();
  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    const next = splitPhone(value);
    setCountryId(next.country);setNumber(next.number);
  }, [value]);
  const emit = (country, nextNumber) => {
    const next = joinPhone(country, nextNumber);
    emitted.current = next;onChange(next);
  };
  const country = phoneCountries.find((item) => item.id === countryId);
  const changeNumber = (next) => {
    if (next.trim().startsWith('+')) {
      const parsed = splitPhone(next);
      setCountryId(parsed.country);setNumber(parsed.number);emit(parsed.country, parsed.number);
    } else {setNumber(next);emit(countryId, next);}
  };
  const changeCountry = (next) => {
    let nextNumber = number;
    if (next === 'INTL') nextNumber = value;else
    if (countryId === 'INTL') {
      const parsed = splitPhone(number);
      nextNumber = parsed.country === 'INTL' ? '' : parsed.number;
    }
    setCountryId(next);setNumber(nextNumber);emit(next, nextNumber);
  };
  return <fieldset className="phone-field" disabled={disabled}>
    <legend>{t("Κινητό τηλέφωνο")}</legend>
    <div className="phone-field-controls">
      <label htmlFor={`${id}-country`}>{t("Κωδικός χώρας")}<select id={`${id}-country`} value={countryId} onChange={(event) => changeCountry(event.target.value)} autoComplete="tel-country-code">{phoneCountries.map((item) => <option key={item.id} value={item.id}>{t(item.name)} {item.dial}</option>)}<option value="INTL">{t("Άλλη χώρα")}</option></select></label>
      <label htmlFor={`${id}-number`}>{t("Αριθμός κινητού")}<input id={`${id}-number`} type="tel" value={number} onChange={(event) => changeNumber(event.target.value)} autoComplete={countryId === 'INTL' ? 'tel' : 'tel-national'} inputMode="tel" required={required} maxLength={40} placeholder={country?.example || (countryId === 'INTL' ? t("+κωδικός και αριθμός") : t("Αριθμός κινητού"))} aria-describedby={`${id}-help`} /></label>
    </div>
    <small id={`${id}-help`}>{countryId === 'INTL' ? t("Γράψτε τον πλήρη αριθμό με τον διεθνή κωδικό, π.χ. +48…") : t('Συμπληρώστε τον αριθμό χωρίς το {dial}', { dial: country?.dial || '' })}</small>
  </fieldset>;
}
