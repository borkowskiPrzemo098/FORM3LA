// Logika dostępności — jedno źródło prawdy dla klienta, admina i walidacji zapisu.
// Ta sama logika jest powtórzona po stronie serwera w supabase/schema.sql (slot_ok).

import { parseYmd, toMin, ymd, addDays } from './util.js';

/**
 * Plan dnia: godziny otwarcia i przerwy, z uwzględnieniem wyjątków (urlop / inne godziny).
 * @returns {{open:boolean, start?:number, end?:number, breaks:number[][], note?:string}}
 */
export function dayPlan(cfg, day) {
  const ex = (cfg.exceptions || []).find((e) => day >= e.from && day <= (e.to || e.from));
  if (ex) {
    if (ex.type === 'closed') return { open: false, breaks: [], note: ex.note || 'Nieczynne' };
    return { open: true, start: toMin(ex.start), end: toMin(ex.end), breaks: [], note: ex.note };
  }
  const d = cfg.hours[parseYmd(day).getDay()];
  if (!d || !d.open) return { open: false, breaks: [] };
  const breaks = d.breakStart && d.breakEnd ? [[toMin(d.breakStart), toMin(d.breakEnd)]] : [];
  return { open: true, start: toMin(d.start), end: toMin(d.end), breaks };
}

const overlaps = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;

/**
 * Czy wizyta [start, start+duration) mieści się w dniu.
 * @param busy  [{start,end,id?}] zajęte przedziały w tym dniu
 * @param opts  {now, ignoreLead, ignoreHorizon, excludeId, ignoreHours}
 * @returns {string|null} powód odrzucenia albo null gdy OK
 */
export function slotProblem(cfg, day, start, duration, busy, opts = {}) {
  const s = cfg.settings;
  const now = opts.now || new Date();
  if (!Number.isInteger(start) || duration < 60) return 'Nieprawidłowy czas wizyty.';
  const end = start + duration;
  if (!opts.ignoreHours) {
    const plan = dayPlan(cfg, day);
    if (!plan.open) return 'Ten dzień jest wolny.';
    if (start < plan.start || end > plan.end) return 'Poza godzinami pracy.';
    if (plan.breaks.some(([b1, b2]) => overlaps(start, end, b1, b2))) return 'Koliduje z przerwą.';
  }
  const buf = s.bufferMin || 0;
  const clash = busy.find((b) => (opts.excludeId == null || b.id !== opts.excludeId) && overlaps(start, end, b.start - buf, b.end + buf));
  if (clash) return 'Ten termin jest już zajęty.';
  const at = parseYmd(day);
  at.setMinutes(start);
  if (!opts.ignoreLead && at.getTime() < now.getTime() + (s.leadMin || 0) * 60000) return 'Za krótki czas do wizyty.';
  if (!opts.ignoreHorizon) {
    const last = ymd(addDays(now, s.horizonDays || 30));
    if (day > last) return 'Za daleki termin.';
  }
  return null;
}

/** Wolne godziny rozpoczęcia w danym dniu dla usługi o długości `duration`. */
export function freeStarts(cfg, day, duration, busy, opts = {}) {
  const plan = dayPlan(cfg, day);
  if (!plan.open) return [];
  const step = cfg.settings.stepMin || 30;
  const out = [];
  for (let t = plan.start; t + duration <= plan.end; t += step) {
    if (!slotProblem(cfg, day, t, duration, busy, opts)) out.push(t);
  }
  return out;
}

/** Zajętości jako mapa dzień -> [{start,end,id}] (tylko wizyty zajmujące czas). */
export function busyByDay(bookings) {
  const map = {};
  for (const b of bookings) {
    if (b.status === 'cancelled') continue;
    (map[b.day] ||= []).push({ start: b.start, end: b.end, id: b.id });
  }
  return map;
}

export const OCCUPYING = new Set(['confirmed', 'done', 'noshow']);
