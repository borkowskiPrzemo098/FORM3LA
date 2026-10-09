// Wspólne pomocniki: daty, formatowanie, DOM.

export const pad = (n) => String(n).padStart(2, '0');

/** Date -> 'YYYY-MM-DD' (czas lokalny). */
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 'YYYY-MM-DD' -> Date o północy czasu lokalnego. */
export const parseYmd = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

export const todayYmd = () => ymd(new Date());

/** '09:30' -> 570 */
export const toMin = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
};

/** 570 -> '9:30' (lub '09:30' gdy pad=true) */
export const fmtMin = (min, padH = false) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${padH ? pad(h) : h}:${pad(m)}`;
};

/** Date wizyty (lokalny) z dnia i minut. */
export const toDate = (day, min) => {
  const d = parseYmd(day);
  d.setMinutes(min);
  return d;
};

const DOW = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
const DOW_SHORT = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'];
const MONTH_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
const MONTH_NOM = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];

export const dowName = (i) => DOW[i];
export const dowShort = (i) => DOW_SHORT[i];
export const monthName = (i) => MONTH_NOM[i];

/** 'czwartek, 16 października' */
export const fmtDayLong = (day) => {
  const d = parseYmd(day);
  return `${DOW[d.getDay()]}, ${d.getDate()} ${MONTH_GEN[d.getMonth()]}`;
};

/** 'cz 16 paź' */
export const fmtDayShort = (day) => {
  const d = parseYmd(day);
  return `${DOW_SHORT[d.getDay()]} ${d.getDate()} ${MONTH_GEN[d.getMonth()].slice(0, 3)}`;
};

/** 'Dziś', 'Jutro' albo krótka data. */
export const relDay = (day) => {
  const t = todayYmd();
  if (day === t) return 'Dziś';
  if (day === ymd(addDays(new Date(), 1))) return 'Jutro';
  return fmtDayShort(day);
};

export const fmtPrice = (p) => `${Number(p).toLocaleString('pl-PL', { maximumFractionDigits: 2 })} zł`;

export const fmtDuration = (min) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
};

/** Losowy identyfikator / token (kryptograficznie). */
export const rid = (bytes = 12) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');

/** Krótki kod wizyty bez mylących znaków. */
export const shortCode = () => {
  const abc = 'ABCDEFGHJKLMNPRSTUWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => abc[b % abc.length]).join('');
};

export const normPhone = (s) => String(s || '').replace(/[^\d+]/g, '');

export const validPhone = (s) => {
  const d = normPhone(s).replace(/^\+?48/, '');
  return /^\d{9}$/.test(d) || /^\+\d{10,15}$/.test(normPhone(s));
};

export const fmtPhone = (s) => {
  const n = normPhone(s);
  const d = n.replace(/^\+?48/, '');
  if (/^\d{9}$/.test(d)) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  return n;
};

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Tagged template: escapuje interpolacje, chyba że to raw(). */
const RAW = Symbol('raw');
export const raw = (s) => ({ [RAW]: true, s: String(s) });
export const html = (strings, ...vals) =>
  strings.reduce((out, str, i) => {
    if (i === 0) return str;
    const v = vals[i - 1];
    const s = Array.isArray(v) ? v.map((x) => (x && x[RAW] ? x.s : esc(x))).join('') : v && v[RAW] ? v.s : esc(v ?? '');
    return out + s + str;
  }, '');

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const h = (markup) => {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Lekka wibracja (Android); iOS ignoruje. */
export const haptic = (ms = 8) => {
  try { if (navigator.userActivation?.hasBeenActive !== false) navigator.vibrate?.(ms); } catch { /* brak */ }
};

export const download = (filename, content, type) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
};

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}
