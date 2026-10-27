import common from './locales/en/common.js';
import customer from './locales/en/customer.js';
import booking from './locales/en/booking.js';
import account from './locales/en/account.js';
import business from './locales/en/business.js';
import admin from './locales/en/admin.js';
const catalog = { ...common, ...customer, ...booking, ...account, ...business, ...admin };
const runtime = new Map();
const listeners = new Set();
const initialLanguage = () => { try { return localStorage.getItem('eneres-language') === 'el' ? 'el' : 'en'; } catch { return 'en'; } };
let language = initialLanguage();
export const getLanguage = () => language;
export const getLocale = () => language === 'el' ? 'el-GR' : 'en-GB';
export const subscribeLanguage = listener => { listeners.add(listener); return () => listeners.delete(listener); };
function updateDocument() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = language;
  document.title = language === 'en' ? 'Eneres | Beauty & wellness appointments in Greece & Cyprus' : 'Eneres | Ραντεβού ομορφιάς σε Ελλάδα & Κύπρο';
}
export function setLanguage(next) {
  if (!['en', 'el'].includes(next)) return;
  language = next;
  try { localStorage.setItem('eneres-language', next); } catch { /* The selection still works for this visit. */ }
  updateDocument();
  for (const listener of listeners) listener();
}
const interpolate = (template, values) => String(template).replace(/\{(\w+)\}/g, (match, key) => Object.hasOwn(values, key) ? String(values[key]) : match);
// Greek source keys keep database values unchanged. The optional English argument
// supports copy close to a component; dictionaries cover shared/dynamic labels.
export function t(source, englishOrValues, values = {}) {
  if (source === null || source === undefined) return '';
  const key = String(source);
  let english = typeof englishOrValues === 'string' ? englishOrValues : catalog[key] || runtime.get(key);
  const params = typeof englishOrValues === 'object' && englishOrValues !== null ? englishOrValues : values;
  if (typeof englishOrValues === 'string') runtime.set(key, english);
  if (english) runtime.set(interpolate(key, params), interpolate(english, params));
  if (language === 'en') return interpolate(english || key, params);
  // Localised notices can already be in state when the visitor changes language.
  const original = english ? key : Object.keys(catalog).find(item => catalog[item] === key) || [...runtime].find(([, translated]) => translated === key)?.[0] || key;
  return interpolate(original, params);
}
updateDocument();
