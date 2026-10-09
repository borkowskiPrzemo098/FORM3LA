// Magazyn trybu DEMO — dane w przeglądarce, ale z wielowarstwową ochroną:
//
//  1. Wizyt NIGDY nie da się usunąć: każdy zapis, po którym lista wizyt byłaby krótsza
//     albo zniknąłby choć jeden identyfikator, jest odrzucany (SafetyError).
//  2. Odwołanie = status „cancelled” (kosz) — zawsze do przywrócenia.
//  3. Przed każdym zapisem bieżący stan trafia do pierścienia 20 punktów przywracania
//     + jedna kopia dzienna (30 dni).
//  4. Zapis jest weryfikowany odczytem; przy błędzie wraca poprzedni stan.
//  5. Lustro w IndexedDB (osobny magazyn) — przy starcie wybierany jest najnowszy poprawny stan
//     ze wszystkich źródeł; uszkodzony plik jest odkładany na bok, nie nadpisywany.
//  6. Dziennik zmian (append-only) z „przed/po” — każdą zmianę można cofnąć.
//  7. Blokada między kartami (Web Locks) — dwie karty nie nadpiszą sobie zmian.
//  8. Prośba o trwały magazyn (navigator.storage.persist) — przeglądarka nie wyczyści danych sama.

import { seedConfig, seedBookings } from './seed.js';
import { rid, shortCode, ymd, addDays, sha256, normPhone, toDate } from './util.js';
import { slotProblem, busyByDay, OCCUPYING } from './slots.js';

const KEY = 'f3.db';
const SNAP = 'f3.snap.';
const DAILY = 'f3.daily.';
const RING = 20;
const DAILY_KEEP = 30;
const BULK_CANCEL_LIMIT = 3;

export class SafetyError extends Error {
  constructor(msg) { super(msg); this.name = 'SafetyError'; this.safety = true; }
}
export class UserError extends Error {
  constructor(msg) { super(msg); this.name = 'UserError'; this.user = true; }
}

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { localStorage.setItem(k, v); },
  del(k) { try { localStorage.removeItem(k); } catch { /* */ } },
  keys(prefix) {
    const out = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(prefix)) out.push(k); } } catch { /* */ }
    return out;
  },
};

export function validDb(db) {
  return !!db && db.schema === 1 && typeof db.rev === 'number'
    && db.salon && db.settings && db.hours
    && Array.isArray(db.services) && Array.isArray(db.bookings)
    && Array.isArray(db.exceptions) && Array.isArray(db.log)
    && db.bookings.every((b) => b && b.id && b.day && Number.isInteger(b.start) && Number.isInteger(b.end));
}

function parse(raw) {
  if (!raw) return null;
  try { const o = JSON.parse(raw); return validDb(o) ? o : null; } catch { return null; }
}

// ---------- IndexedDB lustro ----------
const idb = {
  open() {
    return new Promise((res, rej) => {
      if (!('indexedDB' in window)) return rej(new Error('no idb'));
      const r = indexedDB.open('form3la', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async get(k) {
    try {
      const db = await this.open();
      return await new Promise((res) => {
        const q = db.transaction('kv').objectStore('kv').get(k);
        q.onsuccess = () => res(q.result ?? null);
        q.onerror = () => res(null);
      });
    } catch { return null; }
  },
  async put(k, v) {
    try {
      const db = await this.open();
      await new Promise((res) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(v, k);
        tx.oncomplete = res; tx.onerror = res;
      });
    } catch { /* lustro jest dodatkiem, nie warunkiem */ }
  },
};

function withLock(fn) {
  if (navigator.locks?.request) return navigator.locks.request('form3la-db', fn);
  return fn();
}

function freshSeed() {
  const cfg = seedConfig();
  return {
    schema: 1, rev: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...cfg,
    admin: { pinHash: '', pinSalt: rid(8) },
    bookings: seedBookings(cfg),
    log: [{ id: rid(6), at: new Date().toISOString(), actor: 'system', action: 'init', summary: 'Utworzono bazę z danymi przykładowymi' }],
    meta: { lastExport: null, recoveredFrom: null },
  };
}

const publicCfg = (db) => ({
  salon: db.salon, settings: db.settings, hours: db.hours, exceptions: db.exceptions,
  services: db.services,
});

const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

export function createDemoStore() {
  let db = null;
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn());

  function writeMain(next) {
    const raw = JSON.stringify(next);
    try {
      ls.set(KEY, raw);
    } catch (e) {
      // Brak miejsca: zwolnij najstarsze punkty przywracania (nigdy głównej bazy) i spróbuj raz jeszcze.
      const snaps = ls.keys(SNAP).sort((a, b) => (parse(ls.get(a))?.rev || 0) - (parse(ls.get(b))?.rev || 0));
      snaps.slice(0, Math.ceil(snaps.length / 2)).forEach(ls.del);
      ls.set(KEY, raw);
    }
    const back = parse(ls.get(KEY));
    if (!back || back.rev !== next.rev) throw new SafetyError('Zapis nie został potwierdzony — zmiany wycofane.');
  }

  function snapshot(cur) {
    try {
      const slot = SNAP + (cur.rev % RING);
      ls.set(slot, JSON.stringify(cur));
      const dkey = DAILY + ymd(new Date());
      if (!ls.get(dkey)) ls.set(dkey, JSON.stringify(cur));
      const cut = DAILY + ymd(addDays(new Date(), -DAILY_KEEP));
      ls.keys(DAILY).filter((k) => k < cut).forEach(ls.del);
    } catch { /* brak miejsca na kopię nie blokuje — lustro IDB nadal działa */ }
  }

  function readFresh() { return parse(ls.get(KEY)) || db; }

  /**
   * Jedyna droga zapisu. mutate(next) zmienia kopię; strażnicy sprawdzają niezmienniki.
   */
  async function commit(actor, action, mutate, opts = {}) {
    return withLock(async () => {
      const cur = readFresh();
      const next = clone(cur);
      const ret = mutate(next) || {};

      // --- strażnicy bezpieczeństwa ---
      const nextIds = new Set(next.bookings.map((b) => b.id));
      if (next.bookings.length < cur.bookings.length || cur.bookings.some((b) => !nextIds.has(b.id)))
        throw new SafetyError('Blokada bezpieczeństwa: ta operacja usunęłaby wizyty. Nic nie zostało zmienione.');
      const prev = new Map(cur.bookings.map((b) => [b.id, b]));
      const newlyCancelled = next.bookings.filter((b) => b.status === 'cancelled' && prev.get(b.id) && prev.get(b.id).status !== 'cancelled').length;
      if (newlyCancelled > BULK_CANCEL_LIMIT && !opts.bulk)
        throw new SafetyError(`Blokada bezpieczeństwa: próba odwołania ${newlyCancelled} wizyt naraz.`);
      if (next.log.length < cur.log.length) throw new SafetyError('Dziennik zmian nie może się skracać.');
      if (!validDb(next)) throw new SafetyError('Dane po zmianie są niepoprawne — zapis zatrzymany.');

      next.rev = cur.rev + 1;
      next.updatedAt = new Date().toISOString();
      if (ret.log !== false) {
        next.log.push({
          id: rid(6), at: next.updatedAt, actor, action,
          summary: ret.summary || action,
          bookingId: ret.bookingId || null,
          before: ret.before ?? null, after: ret.after ?? null,
        });
      }

      snapshot(cur);
      try {
        writeMain(next);
      } catch (e) {
        try { ls.set(KEY, JSON.stringify(cur)); } catch { /* */ }
        throw e;
      }
      db = next;
      idb.put(KEY, next);
      emit();
      return ret.value;
    });
  }

  const findBooking = (d, id) => {
    const b = d.bookings.find((x) => x.id === id);
    if (!b) throw new UserError('Nie znaleziono wizyty.');
    return b;
  };

  const occupying = (d, day) => (busyByDay(d.bookings.filter((b) => OCCUPYING.has(b.status)))[day] || []);

  return {
    mode: 'demo',

    async init() {
      // Najnowszy poprawny stan z: głównego klucza, punktów przywracania, kopii dziennych, IndexedDB.
      const main = parse(ls.get(KEY));
      const candidates = [main, ...ls.keys(SNAP).map((k) => parse(ls.get(k))), ...ls.keys(DAILY).map((k) => parse(ls.get(k)))];
      const mirror = await idb.get(KEY);
      if (validDb(mirror)) candidates.push(mirror);
      const best = candidates.filter(Boolean).sort((a, b) => b.rev - a.rev)[0];

      if (!main && ls.get(KEY)) ls.set('f3.corrupt.' + Date.now(), ls.get(KEY)); // uszkodzony plik zostaje
      if (best) {
        db = best;
        if (!main || main.rev !== best.rev) {
          db.meta = { ...(db.meta || {}), recoveredFrom: main ? 'newer-copy' : 'backup', recoveredAt: new Date().toISOString() };
          writeMain(db);
        }
      } else {
        db = freshSeed();
        writeMain(db);
      }
      idb.put(KEY, db);
      try { navigator.storage?.persist?.(); } catch { /* */ }

      window.addEventListener('storage', (e) => {
        if (e.key === KEY) { const n = parse(e.newValue); if (n && n.rev > db.rev) { db = n; emit(); } }
      });
      return this;
    },

    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    // ================= KLIENT =================
    async getConfig() { return clone(publicCfg(db)); },

    async getBusy(fromDay, toDay) {
      return db.bookings
        .filter((b) => OCCUPYING.has(b.status) && b.day >= fromDay && b.day <= toDay)
        .map((b) => ({ day: b.day, start: b.start, end: b.end }));
    },

    async createBooking({ serviceId, day, start, name, phone, note }) {
      return commit('klient', 'create', (d) => {
        const s = d.services.find((x) => x.id === serviceId && x.active);
        if (!s) throw new UserError('Ta usługa nie jest już dostępna.');
        if (!String(name || '').trim()) throw new UserError('Podaj imię.');
        const p = normPhone(phone);
        const mine = d.bookings.filter((b) => normPhone(b.phone) === p && b.status === 'confirmed' && toDate(b.day, b.end) > new Date());
        if (mine.length >= (d.settings.maxPerPhone || 3)) throw new UserError('Masz już zaplanowane wizyty — odwołaj którąś, aby zarezerwować kolejną.');
        const problem = slotProblem(d, day, start, s.duration, occupying(d, day));
        if (problem) throw new UserError(problem);
        const now = new Date().toISOString();
        const b = {
          id: rid(8), token: rid(16), code: shortCode(),
          serviceId: s.id, serviceName: s.name, price: s.price, duration: s.duration,
          day, start, end: start + s.duration,
          name: String(name).trim().slice(0, 60), phone: p, note: String(note || '').trim().slice(0, 300),
          status: 'confirmed', source: 'online', createdAt: now, updatedAt: now,
        };
        d.bookings.push(b);
        return { value: clone(b), summary: `Nowa rezerwacja: ${b.name}, ${s.name}`, bookingId: b.id, after: b };
      });
    },

    async getByToken(token) {
      const b = db.bookings.find((x) => x.token === token);
      return b ? clone(b) : null;
    },

    async cancelByToken(token) {
      return commit('klient', 'cancel', (d) => {
        const b = d.bookings.find((x) => x.token === token);
        if (!b) throw new UserError('Nie znaleziono wizyty.');
        if (b.status !== 'confirmed') throw new UserError('Ta wizyta nie jest już aktywna.');
        if (toDate(b.day, b.start) - Date.now() < d.settings.cancelHours * 3600000)
          throw new UserError(`Odwołać online można najpóźniej ${d.settings.cancelHours} h przed wizytą. Zadzwoń do salonu.`);
        const before = clone(b);
        Object.assign(b, { status: 'cancelled', cancelledAt: new Date().toISOString(), cancelledBy: 'klient', updatedAt: new Date().toISOString() });
        return { value: clone(b), summary: `Klient odwołał: ${b.name}`, bookingId: b.id, before, after: clone(b) };
      });
    },

    async rescheduleByToken(token, day, start) {
      return commit('klient', 'reschedule', (d) => {
        const b = d.bookings.find((x) => x.token === token);
        if (!b || b.status !== 'confirmed') throw new UserError('Ta wizyta nie jest już aktywna.');
        if (toDate(b.day, b.start) - Date.now() < d.settings.cancelHours * 3600000)
          throw new UserError(`Przełożyć online można najpóźniej ${d.settings.cancelHours} h przed wizytą.`);
        const problem = slotProblem(d, day, start, b.duration, occupying(d, day), { excludeId: b.id });
        if (problem) throw new UserError(problem);
        const before = clone(b);
        Object.assign(b, { day, start, end: start + b.duration, updatedAt: new Date().toISOString() });
        return { value: clone(b), summary: `Klient przełożył: ${b.name}`, bookingId: b.id, before, after: clone(b) };
      });
    },

    // ================= ADMIN =================
    async adminLogin(pin) {
      const a = db.admin;
      if (!a.pinHash) {
        if (pin !== '1234') throw new UserError('Nieprawidłowy PIN.');
      } else if ((await sha256(a.pinSalt + pin)) !== a.pinHash) throw new UserError('Nieprawidłowy PIN.');
      sessionStorage.setItem('f3.admin', '1');
      return { defaultPin: !a.pinHash };
    },
    isAdmin() { return sessionStorage.getItem('f3.admin') === '1'; },
    async adminLogout() { sessionStorage.removeItem('f3.admin'); },
    async setPin(pin) {
      if (!/^\d{4,8}$/.test(pin)) throw new UserError('PIN musi mieć 4–8 cyfr.');
      const hash = await sha256(db.admin.pinSalt + pin);
      return commit('admin', 'pin', (d) => { d.admin.pinHash = hash; return { summary: 'Zmieniono PIN' }; });
    },

    async adminData() { return clone(db); },

    async adminSaveBooking(id, patch, { force = false } = {}) {
      return commit('admin', id ? 'edit' : 'create', (d) => {
        const now = new Date().toISOString();
        let b;
        let before = null;
        if (id) { b = findBooking(d, id); before = clone(b); } else {
          b = { id: rid(8), token: rid(16), code: shortCode(), status: 'confirmed', source: 'admin', createdAt: now, note: '' };
          d.bookings.push(b);
        }
        const s = d.services.find((x) => x.id === (patch.serviceId ?? b.serviceId));
        if (!s) throw new UserError('Wybierz usługę.');
        const duration = patch.duration ?? (patch.serviceId && patch.serviceId !== b.serviceId ? s.duration : b.duration ?? s.duration);
        const next = { ...b, ...patch, serviceName: s.name, duration, end: (patch.start ?? b.start) + duration, updatedAt: now };
        if (!next.price && next.price !== 0) next.price = s.price;
        if (patch.serviceId && patch.serviceId !== b.serviceId && patch.price == null) next.price = s.price;
        if (!String(next.name || '').trim()) throw new UserError('Podaj imię klienta.');
        if (next.status !== 'cancelled') {
          const problem = slotProblem(d, next.day, next.start, duration, occupying(d, next.day), {
            excludeId: b.id, ignoreLead: true, ignoreHorizon: true, ignoreHours: force,
          });
          if (problem && !(force && problem !== 'Ten termin jest już zajęty.')) throw new UserError(problem);
        }
        Object.assign(b, next, { phone: normPhone(next.phone) });
        return {
          value: clone(b), bookingId: b.id, before, after: clone(b),
          summary: id ? `Edycja: ${b.name}` : `Dodano wizytę: ${b.name}`,
        };
      });
    },

    async adminSetStatus(id, status) {
      return commit('admin', 'status', (d) => {
        const b = findBooking(d, id);
        const before = clone(b);
        if (status === 'confirmed' && b.status === 'cancelled') {
          const problem = slotProblem(d, b.day, b.start, b.duration, occupying(d, b.day), { excludeId: b.id, ignoreLead: true, ignoreHorizon: true, ignoreHours: true });
          if (problem) throw new UserError(`Nie można przywrócić: ${problem.toLowerCase()} Przełóż wizytę na inny termin.`);
        }
        b.status = status;
        b.updatedAt = new Date().toISOString();
        if (status === 'cancelled') { b.cancelledAt = b.updatedAt; b.cancelledBy = 'admin'; }
        const label = { cancelled: 'Odwołano', confirmed: 'Przywrócono', done: 'Zakończono', noshow: 'Nieobecność' }[status];
        return { value: clone(b), bookingId: b.id, before, after: clone(b), summary: `${label}: ${b.name}` };
      });
    },

    /** Cofnięcie wpisu z dziennika — sam też jest nowym wpisem (nic nie znika). */
    async revert(logId) {
      return commit('admin', 'undo', (d) => {
        const e = d.log.find((x) => x.id === logId);
        if (!e || !e.bookingId) throw new UserError('Tej zmiany nie da się cofnąć.');
        const b = findBooking(d, e.bookingId);
        const before = clone(b);
        if (e.before) {
          const problem = e.before.status !== 'cancelled'
            ? slotProblem(d, e.before.day, e.before.start, e.before.duration, occupying(d, e.before.day), { excludeId: b.id, ignoreLead: true, ignoreHorizon: true, ignoreHours: true })
            : null;
          if (problem) throw new UserError(`Nie można cofnąć: ${problem.toLowerCase()}`);
          Object.assign(b, clone(e.before), { updatedAt: new Date().toISOString() });
        } else {
          Object.assign(b, { status: 'cancelled', cancelledAt: new Date().toISOString(), cancelledBy: 'admin' });
        }
        return { value: clone(b), bookingId: b.id, before, after: clone(b), summary: `Cofnięto: ${e.summary}` };
      });
    },

    async saveConfig(part, value, summary) {
      const allowed = ['salon', 'settings', 'hours', 'exceptions', 'services'];
      if (!allowed.includes(part)) throw new Error('bad part');
      return commit('admin', 'config', (d) => {
        if (part === 'services') {
          // usług też nie kasujemy — tylko archiwizacja (active=false)
          const ids = new Set(value.map((s) => s.id));
          if (d.services.some((s) => !ids.has(s.id))) throw new SafetyError('Usług nie usuwa się — ukryj ją przełącznikiem „Widoczna”.');
        }
        d[part] = clone(value);
        return { summary: summary || 'Zmiana ustawień' };
      });
    },

    // ---------- Kopie ----------
    async exportAll() {
      await commit('admin', 'export', (d) => { d.meta = { ...(d.meta || {}), lastExport: new Date().toISOString() }; return { summary: 'Wyeksportowano kopię' }; });
      return { app: 'FORM3LA', exportedAt: new Date().toISOString(), data: clone(db) };
    },

    /** Import scala dane: niczego nie usuwa; nowsza wersja wizyty (updatedAt) wygrywa. */
    async importAll(file) {
      const data = file?.data;
      if (file?.app !== 'FORM3LA' || !validDb(data)) throw new UserError('To nie jest poprawna kopia FORM3LA.');
      return commit('admin', 'import', (d) => {
        let added = 0; let updated = 0;
        const map = new Map(d.bookings.map((b) => [b.id, b]));
        for (const b of data.bookings) {
          const cur = map.get(b.id);
          if (!cur) { d.bookings.push(clone(b)); added++; } else if ((b.updatedAt || '') > (cur.updatedAt || '')) { Object.assign(cur, clone(b)); updated++; }
        }
        const sids = new Set(d.services.map((s) => s.id));
        data.services.forEach((s) => { if (!sids.has(s.id)) d.services.push({ ...clone(s), active: false }); });
        return { value: { added, updated }, summary: `Import kopii: +${added} nowych, ${updated} zaktualizowanych`, bulk: true };
      }, { bulk: true });
    },

    async listRestorePoints() {
      const keys = [...ls.keys(SNAP), ...ls.keys(DAILY)];
      return keys.map((k) => {
        const o = parse(ls.get(k));
        return o && { key: k, rev: o.rev, at: o.updatedAt, bookings: o.bookings.length, daily: k.startsWith(DAILY) };
      }).filter(Boolean).sort((a, b) => b.rev - a.rev);
    },

    /** Przywraca ustawienia i stan wizyt z punktu — wizyty utworzone później zostają. */
    async restorePoint(key) {
      const snap = parse(ls.get(key));
      if (!snap) throw new UserError('Ten punkt przywracania jest niedostępny.');
      return commit('admin', 'restore', (d) => {
        for (const k of ['salon', 'settings', 'hours', 'exceptions']) d[k] = clone(snap[k]);
        const sids = new Set(snap.services.map((s) => s.id));
        d.services = [...clone(snap.services), ...d.services.filter((s) => !sids.has(s.id)).map((s) => ({ ...s, active: false }))];
        const map = new Map(snap.bookings.map((b) => [b.id, b]));
        d.bookings = d.bookings.map((b) => (map.has(b.id) ? clone(map.get(b.id)) : b));
        return { summary: `Przywrócono stan z ${new Date(snap.updatedAt).toLocaleString('pl-PL')}` };
      }, { bulk: true });
    },

    health() {
      return {
        mode: 'demo',
        rev: db.rev,
        bookings: db.bookings.length,
        restorePoints: ls.keys(SNAP).length + ls.keys(DAILY).length,
        lastExport: db.meta?.lastExport || null,
        recoveredFrom: db.meta?.recoveredAt && Date.now() - new Date(db.meta.recoveredAt).getTime() < 60000 ? db.meta.recoveredFrom : null,
      };
    },
    async persisted() { try { return !!(await navigator.storage?.persisted?.()); } catch { return false; } },
  };
}
