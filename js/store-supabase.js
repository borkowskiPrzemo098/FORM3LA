// Magazyn produkcyjny — Supabase (Postgres). Ten sam interfejs co store-demo.js.
// Bezpieczeństwo egzekwuje baza (supabase/schema.sql): brak DELETE, EXCLUDE na nakładanie,
// audit_log, wersje ustawień. Ten plik to tylko cienki klient.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { UserError, SafetyError } from './store-demo.js';
import { normPhone } from './util.js';

const fromRow = (r) => r && ({
  id: r.id, token: r.token, code: r.code,
  serviceId: r.service_id, serviceName: r.service_name, price: Number(r.price), duration: r.duration,
  day: r.day, start: r.start_min, end: r.end_min,
  name: r.name, phone: r.phone, note: r.note || '', status: r.status, source: r.source,
  createdAt: r.created_at, updatedAt: r.updated_at, cancelledAt: r.cancelled_at, cancelledBy: r.cancelled_by,
});

const fail = (error) => {
  if (!error) return;
  const msg = error.message || String(error);
  if (/bookings_no_overlap|exclusion/i.test(msg)) throw new UserError('Ten termin jest już zajęty.');
  if (/zablokowane/i.test(msg)) throw new SafetyError(msg);
  throw new UserError(msg.replace(/^.*?ERROR:\s*/, ''));
};

export async function createSupabaseStore() {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true } });
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn());
  let cfgCache = null;
  let cfgRev = 0;
  let admin = false;

  async function loadCfg() {
    const { data, error } = await sb.from('app_config').select('data, rev').eq('id', 1).single();
    fail(error);
    cfgCache = data.data; cfgRev = data.rev;
    return cfgCache;
  }

  return {
    mode: 'supabase',
    async init() {
      await loadCfg();
      const { data } = await sb.auth.getSession();
      if (data.session) admin = !!(await sb.rpc('is_admin')).data;
      // Na żywo: zmiany wizyt odświeżają panel admina.
      sb.channel('bookings').on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, emit).subscribe();
      return this;
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    async getConfig() { return structuredClone(await loadCfg()); },
    async getBusy(from, to) {
      const { data, error } = await sb.rpc('public_busy', { p_from: from, p_to: to });
      fail(error);
      return data.map((r) => ({ day: r.day, start: r.start_min, end: r.end_min }));
    },
    async createBooking({ serviceId, day, start, name, phone, note }) {
      const { data, error } = await sb.rpc('create_booking', { p_service_id: serviceId, p_day: day, p_start: start, p_name: name, p_phone: phone, p_note: note || '' });
      fail(error);
      return fromRow(data);
    },
    async getByToken(token) {
      const { data, error } = await sb.rpc('get_booking', { p_token: token });
      fail(error);
      return fromRow(data);
    },
    async cancelByToken(token) {
      const { data, error } = await sb.rpc('cancel_booking', { p_token: token });
      fail(error);
      return fromRow(data);
    },
    async rescheduleByToken(token, day, start) {
      const { data, error } = await sb.rpc('reschedule_booking', { p_token: token, p_day: day, p_start: start });
      fail(error);
      return fromRow(data);
    },

    // ---------- admin ----------
    loginKind: 'email',
    async adminLogin(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new UserError('Nieprawidłowy e-mail lub hasło.');
      admin = !!(await sb.rpc('is_admin')).data;
      if (!admin) { await sb.auth.signOut(); throw new UserError('To konto nie ma uprawnień administratora.'); }
      return { defaultPin: false };
    },
    isAdmin() { return admin; },
    async adminLogout() { await sb.auth.signOut(); admin = false; },
    async setPin() { throw new UserError('Hasło zmienisz w Supabase → Authentication.'); },

    async adminData() {
      await loadCfg();
      const from = new Date(); from.setDate(from.getDate() - 120);
      const { data: rows, error } = await sb.from('bookings').select('*').gte('day', from.toISOString().slice(0, 10)).order('day').order('start_min');
      fail(error);
      const { data: log } = await sb.from('audit_log').select('*').order('id', { ascending: false }).limit(300);
      return {
        ...structuredClone(cfgCache),
        bookings: rows.map(fromRow),
        log: (log || []).reverse().map((l) => ({ id: String(l.id), at: l.at, actor: l.actor, action: l.action, summary: l.summary, bookingId: l.booking_id, before: fromRow(l.before), after: fromRow(l.after) })),
        meta: {},
      };
    },

    async adminSaveBooking(id, patch, { force = false } = {}) {
      const svc = cfgCache.services.find((s) => s.id === patch.serviceId);
      const row = {};
      if (patch.serviceId) Object.assign(row, { service_id: svc.id, service_name: svc.name });
      if (patch.duration != null) row.duration = patch.duration; else if (svc && !id) row.duration = svc.duration;
      if (patch.price != null) row.price = patch.price; else if (svc && !id) row.price = svc.price;
      if (patch.day) row.day = patch.day;
      if (patch.start != null) { row.start_min = patch.start; row.end_min = patch.start + (row.duration || patch.duration || 60); }
      if (patch.name != null) row.name = patch.name.trim();
      if (patch.phone != null) row.phone = normPhone(patch.phone);
      if (patch.note != null) row.note = patch.note;
      if (patch.status) row.status = patch.status;
      if (!force && row.day != null && row.start_min != null) {
        const { data: problem } = await sb.rpc('slot_problem', { p_day: row.day, p_start: row.start_min, p_duration: row.duration || patch.duration, p_exclude: id || null, p_client: false });
        if (problem) throw new UserError(problem);
      }
      const q = id
        ? sb.from('bookings').update(row).eq('id', id).select().single()
        : sb.from('bookings').insert({ ...row, code: Math.random().toString(36).slice(2, 8).toUpperCase(), source: 'admin' }).select().single();
      const { data, error } = await q;
      fail(error);
      emit();
      return fromRow(data);
    },
    async adminSetStatus(id, status) {
      const patch = { status };
      if (status === 'cancelled') Object.assign(patch, { cancelled_at: new Date().toISOString(), cancelled_by: 'admin' });
      const { data, error } = await sb.from('bookings').update(patch).eq('id', id).select().single();
      fail(error);
      emit();
      return fromRow(data);
    },
    async revert(logId) {
      const { data: e } = await sb.from('audit_log').select('*').eq('id', logId).single();
      if (!e?.booking_id) throw new UserError('Tej zmiany nie da się cofnąć.');
      if (!e.before) return this.adminSetStatus(e.booking_id, 'cancelled');
      const b = e.before;
      const { data, error } = await sb.from('bookings').update({
        service_id: b.service_id, service_name: b.service_name, price: b.price, duration: b.duration,
        day: b.day, start_min: b.start_min, end_min: b.end_min, name: b.name, phone: b.phone, note: b.note, status: b.status,
      }).eq('id', e.booking_id).select().single();
      fail(error);
      emit();
      return fromRow(data);
    },
    async saveConfig(part, value) {
      if (part === 'services') {
        const ids = new Set(value.map((s) => s.id));
        if (cfgCache.services.some((s) => !ids.has(s.id))) throw new SafetyError('Usług nie usuwa się — ukryj ją przełącznikiem „Widoczna”.');
      }
      const next = { ...cfgCache, [part]: value };
      const { data, error } = await sb.from('app_config').update({ data: next }).eq('id', 1).eq('rev', cfgRev).select('rev');
      fail(error);
      if (!data?.length) { await loadCfg(); throw new UserError('Ustawienia zmieniły się na innym urządzeniu — odświeżono, spróbuj ponownie.'); }
      cfgCache = next; cfgRev = data[0].rev;
      emit();
    },
    async exportAll() {
      const { data: bookings } = await sb.from('bookings').select('*').order('day');
      const { data: log } = await sb.from('audit_log').select('*').order('id');
      return { app: 'FORM3LA', exportedAt: new Date().toISOString(), data: { schema: 1, rev: cfgRev, ...cfgCache, bookings: bookings.map(fromRow), log: log || [], admin: {}, meta: {} } };
    },
    async importAll() { throw new UserError('W trybie Supabase kopie odtwarza się z kopii nocnej (README → Kopie).'); },
    async listRestorePoints() {
      const { data } = await sb.from('config_history').select('id, at, rev').order('id', { ascending: false }).limit(30);
      return (data || []).map((r) => ({ key: String(r.id), rev: r.rev, at: r.at, bookings: null, daily: false }));
    },
    async restorePoint(key) {
      const { data, error } = await sb.from('config_history').select('data').eq('id', key).single();
      fail(error);
      const { data: up, error: e2 } = await sb.from('app_config').update({ data: data.data }).eq('id', 1).select('rev');
      fail(e2);
      cfgCache = data.data; cfgRev = up[0].rev;
      emit();
    },
    health() { return { mode: 'supabase', rev: cfgRev, bookings: null, restorePoints: null, lastExport: null }; },
    async persisted() { return true; },
  };
}
