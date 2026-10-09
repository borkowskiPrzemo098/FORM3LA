// Panel barbera: kalendarz dnia, wizyty, grafik, ustawienia i bezpieczeństwo danych.
import { getStore } from './store.js';
import { MODE } from './config.js';
import { dayPlan, freeStarts, busyByDay, OCCUPYING } from './slots.js';
import {
  html, raw, h, $, $$, ymd, addDays, parseYmd, todayYmd, toMin, fmtMin, fmtDayLong, fmtDayShort, fmtPrice, fmtDuration,
  dowShort, dowName, monthName, fmtPhone, normPhone, validPhone, toDate, relDay, haptic, download, esc,
} from './util.js';
import { NavStack, viewShell, icon, openSheet, actionSheet, confirmAction, island, showError, busy, segmented, wireSegmented } from './ui.js';

const store = await getStore();
const stack = new NavStack($('#stack'));
const tabbar = $('#tabbar');
let D = null; // pełne dane
let tab = 'cal';
let selDay = todayYmd();

const STATUS = { confirmed: 'Potwierdzona', done: 'Zakończona', noshow: 'Nieobecność', cancelled: 'Odwołana' };
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const svcById = (id) => D.services.find((s) => s.id === id);
const lastLogFor = (id) => [...D.log].reverse().find((l) => l.bookingId === id);

async function reload() { D = await store.adminData(); }
function rerender() { stack.views.forEach((v) => v.render?.()); }

/** Wykonaj operację, odśwież i pokaż wyspę z Cofnij. */
async function act(fn, text, { undo = true } = {}) {
  try {
    const res = await fn();
    await reload();
    rerender();
    const log = res?.id ? lastLogFor(res.id) : null;
    island({ text, sub: res?.name ? `${res.name} · ${relDay(res.day)} ${fmtMin(res.start)}` : '', action: undo && log ? { label: 'Cofnij', fn: () => doUndo(log.id) } : null });
    return res || true;
  } catch (e) { showError(e); return null; }
}
async function doUndo(logId) {
  try { await store.revert(logId); await reload(); rerender(); island({ text: 'Cofnięto zmianę', iconName: 'undo' }); } catch (e) { showError(e); }
}

// ================================================================ LOGOWANIE
function loginView() {
  tabbar.hidden = true;
  const v = h(html`<section class="view"><div class="scroll" style="padding-top:0"><div class="login"></div></div></section>`);
  const box = v.querySelector('.login');
  const word = esc(D?.salon?.name || 'FORM3LA').replace(/3/, '<b>3</b>');
  if (store.loginKind === 'email') {
    box.innerHTML = html`<span class="wordmark">${raw(word)}</span><p>Panel barbera</p>
      <form class="group" style="text-align:left">
        <div class="row field"><label for="l-mail">E-mail</label><input id="l-mail" type="email" autocomplete="username" required></div>
        <div class="row field"><label for="l-pass">Hasło</label><input id="l-pass" type="password" autocomplete="current-password" required></div>
      </form>
      <button class="btn" style="margin-top:18px" data-go>Zaloguj</button>`;
    box.querySelector('[data-go]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      try { await store.adminLogin($('#l-mail').value, $('#l-pass').value); await start(); } catch (ex) { showError(ex); }
    }));
  } else {
    let pin = '';
    box.innerHTML = html`<span class="wordmark">${raw(word)}</span><p>Wpisz PIN, aby otworzyć panel</p>
      <div class="pin-dots" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => raw(`<button class="key" data-k="${n}">${n}</button>`))}
        <a class="key ghost" href="index.html" aria-label="Strona klienta">${raw(icon('chevronL'))}</a><button class="key" data-k="0">0</button><button class="key ghost" data-del aria-label="Usuń cyfrę">${raw(icon('undo'))}</button></div>
      <p class="fine" style="margin-top:26px">Wersja demo: PIN startowy <b>1234</b> — zmienisz go w ustawieniach.</p>`;
    const dots = $$('.pin-dots i', box);
    const paint = () => dots.forEach((d, i) => d.classList.toggle('on', i < pin.length));
    const tryPin = async () => {
      try {
        const r = await store.adminLogin(pin);
        await start();
        if (r.defaultPin) island({ text: 'Ustaw własny PIN', sub: 'Więcej → Zmień PIN', iconName: 'lock', tone: 'warn', ms: 5000 });
      } catch {
        box.querySelector('.pin-dots').classList.add('shake');
        haptic([20, 50, 20]);
        setTimeout(() => { box.querySelector('.pin-dots').classList.remove('shake'); pin = ''; paint(); }, 450);
      }
    };
    const press = (k) => {
      if (k === 'del') pin = pin.slice(0, -1); else if (pin.length < 4) pin += k;
      haptic(4); paint();
      if (pin.length === 4) setTimeout(tryPin, 120);
    };
    box.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => press(b.dataset.k)));
    box.querySelector('[data-del]').addEventListener('click', () => press('del'));
    v.tabIndex = -1;
    document.addEventListener('keydown', function onKey(e) {
      if (!v.isConnected) return document.removeEventListener('keydown', onKey);
      if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('del');
    });
  }
  return v;
}

// ================================================================ ZAKŁADKI
const TABS = [
  ['cal', 'Kalendarz', 'calendar', calendarView],
  ['list', 'Wizyty', 'list', listView],
  ['hours', 'Grafik', 'hours', hoursView],
  ['more', 'Więcej', 'gear', moreView],
];
function renderTabbar() {
  tabbar.hidden = false;
  tabbar.innerHTML = TABS.map(([id, label, ic]) => html`<button class="tab" role="tab" data-tab="${id}" aria-selected="${id === tab}">${raw(icon(ic))}<span>${label}</span></button>`).join('');
  tabbar.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.tab === tab) { stack.popToRoot(); stack.views[0]?.querySelector('.scroll')?.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    tab = b.dataset.tab;
    haptic(4);
    renderTabbar();
    stack.reset(TABS.find((t) => t[0] === tab)[3]());
  }));
}

// ================================================================ KALENDARZ
function dayHeading(day) {
  const rel = relDay(day);
  const s = (rel === 'Dziś' || rel === 'Jutro' ? `${rel}, ` : '') + fmtDayLong(day);
  return s[0].toUpperCase() + s.slice(1);
}

function calendarView() {
  const v = viewShell({
    title: 'Kalendarz', large: false, cls: 'no-large has-tabbar',
    right: `<button class="nav-btn" data-today>Dziś</button><button class="nav-btn" data-add aria-label="Nowa wizyta">${icon('plus')}</button>`,
  });
  const c = v.querySelector('.content');
  v.render = () => {
    const sel = parseYmd(selDay);
    const monday = addDays(sel, -((sel.getDay() + 6) % 7));
    const week = Array.from({ length: 7 }, (_, i) => ymd(addDays(monday, i)));
    const byDay = {};
    D.bookings.forEach((b) => { if (b.status !== 'cancelled') (byDay[b.day] ||= []).push(b); });
    const list = (byDay[selDay] || []).sort((a, b) => a.start - b.start);
    const plan = dayPlan(D, selDay);
    const active = list.filter((b) => b.status !== 'noshow');
    const revenue = active.reduce((s, b) => s + Number(b.price || 0), 0);
    const openMin = plan.open ? plan.end - plan.start - plan.breaks.reduce((s, [a, b]) => s + b - a, 0) : 0;
    const bookedMin = list.reduce((s, b) => s + b.duration, 0);
    const freeMin = Math.max(0, openMin - bookedMin);

    const hourFrom = Math.floor(Math.min(plan.open ? plan.start : 540, ...list.map((b) => b.start)) / 60);
    const hourTo = Math.ceil(Math.max(plan.open ? plan.end : 1080, ...list.map((b) => b.end)) / 60);
    const HOUR = 64;
    const y = (min) => ((min - hourFrom * 60) / 60) * HOUR;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    c.innerHTML = html`
      <div class="week-nav" style="margin-top:6px">
        <h3>${monthName(sel.getMonth())} ${sel.getFullYear()}</h3>
        <div><button class="nav-btn" data-wk="-7" aria-label="Poprzedni tydzień">${raw(icon('chevronL'))}</button><button class="nav-btn" data-wk="7" aria-label="Następny tydzień">${raw(icon('chevronR'))}</button></div>
      </div>
      <div class="week" role="group" aria-label="Tydzień">
        ${week.map((d) => {
          const dd = parseYmd(d);
          const n = (byDay[d] || []).length;
          return raw(html`<button class="wd ${d === todayYmd() ? 'today' : ''} ${dayPlan(D, d).open ? '' : 'off'}" data-d="${d}" aria-pressed="${d === selDay}" aria-label="${fmtDayLong(d)}, wizyt: ${n}">
            <small>${dowShort(dd.getDay())}</small><strong>${dd.getDate()}</strong><i>${raw('<b></b>'.repeat(Math.min(n, 3)))}</i></button>`);
        })}
      </div>
      <h1 class="large-title" style="font-size:28px;line-height:34px;margin-top:14px">${dayHeading(selDay)}</h1>
      <div class="day-sum">
        <span><b>${list.length}</b> ${list.length === 1 ? 'wizyta' : list.length > 1 && list.length < 5 ? 'wizyty' : 'wizyt'}</span>
        <span><b>${fmtPrice(revenue)}</b></span>
        ${plan.open ? raw(html`<span>wolne <b>${fmtDuration(freeMin) === '0 min' ? '0' : fmtDuration(freeMin)}</b></span>`) : raw(html`<span>${plan.note || 'Dzień wolny'}</span>`)}
      </div>
      <div class="timeline" style="height:${(hourTo - hourFrom) * HOUR}px">
        ${Array.from({ length: hourTo - hourFrom }, (_, i) => raw(html`<div class="tl-hour"><span>${hourFrom + i}:00</span></div>`))}
        ${plan.open ? raw([
          plan.start > hourFrom * 60 ? `<div class="tl-closed" style="top:0;height:${y(plan.start)}px"></div>` : '',
          plan.end < hourTo * 60 ? `<div class="tl-closed" style="top:${y(plan.end)}px;height:${y(hourTo * 60) - y(plan.end)}px"></div>` : '',
          ...plan.breaks.map(([a, b]) => `<div class="tl-break" style="top:${y(a)}px;height:${y(b) - y(a)}px">Przerwa</div>`),
        ].join('')) : raw(`<div class="tl-closed" style="top:0;height:100%"></div>`)}
        ${raw(Array.from({ length: (hourTo - hourFrom) * 2 }, (_, i) => `<button class="tl-slot" data-slot="${hourFrom * 60 + i * 30}" style="top:${i * HOUR / 2}px" aria-label="Dodaj wizytę o ${fmtMin(hourFrom * 60 + i * 30)}"></button>`).join(''))}
        ${list.map((b, i) => raw(html`<button class="tl-ev ${b.status} ${b.source === 'admin' ? 'admin-src' : ''}" data-id="${b.id}" style="top:${y(b.start) + 1}px;height:${y(b.end) - y(b.start) - 2}px;animation-delay:${i * 30}ms">
          <strong>${b.name}</strong><span>${fmtMin(b.start)}–${fmtMin(b.end)} · ${b.serviceName}</span>${b.status !== 'confirmed' ? raw(html`<span>${STATUS[b.status]}</span>`) : ''}
        </button>`))}
        ${selDay === todayYmd() && nowMin >= hourFrom * 60 && nowMin <= hourTo * 60 ? raw(`<div class="tl-now" style="top:${y(nowMin)}px"></div>`) : ''}
      </div>
      ${!list.length && plan.open ? raw(html`<p class="fine" style="text-align:center">Brak wizyt. Stuknij godzinę na osi, aby dodać wizytę z telefonu lub z ulicy.</p>`) : ''}`;

    c.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => { selDay = b.dataset.d; haptic(4); v.render(); }));
    c.querySelectorAll('[data-wk]').forEach((b) => b.addEventListener('click', () => { selDay = ymd(addDays(parseYmd(selDay), Number(b.dataset.wk))); v.render(); }));
    c.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => editBooking(D.bookings.find((x) => x.id === b.dataset.id))));
    c.querySelectorAll('[data-slot]').forEach((b) => b.addEventListener('click', () => editBooking(null, { day: selDay, start: Number(b.dataset.slot) })));
  };
  v.querySelector('[data-today]').addEventListener('click', () => { selDay = todayYmd(); v.render(); });
  v.querySelector('[data-add]').addEventListener('click', () => editBooking(null, { day: selDay }));
  v.render();
  // przewiń do bieżącej godziny / pierwszej wizyty
  requestAnimationFrame(() => {
    const target = v.querySelector('.tl-now') || v.querySelector('.tl-ev');
    const sc = v.querySelector('.scroll');
    if (!target) return;
    const y = target.offsetTop + v.querySelector('.timeline').offsetTop;
    if (y > sc.clientHeight - 160) sc.scrollTo({ top: y - sc.clientHeight / 2 });
  });
  return v;
}

// ================================================================ ARKUSZ WIZYTY
function clientStats(phone, exceptId) {
  const p = normPhone(phone);
  if (!p) return null;
  const all = D.bookings.filter((b) => normPhone(b.phone) === p && b.id !== exceptId);
  return {
    visits: all.filter((b) => b.status === 'done' || (b.status === 'confirmed' && toDate(b.day, b.end) < new Date())).length,
    noshow: all.filter((b) => b.status === 'noshow').length,
    cancelled: all.filter((b) => b.status === 'cancelled').length,
  };
}

function reminderText(b) {
  const when = relDay(b.day) === 'Jutro' ? 'jutro' : relDay(b.day) === 'Dziś' ? 'dziś' : fmtDayLong(b.day);
  const link = `${location.origin}${location.pathname.replace(/admin\.html$/, 'index.html')}#/w/${b.token}`;
  return `Cześć ${b.name.replace(/\s*\(demo\)/, '')}! Przypominamy o wizycie w ${D.salon.name} ${when} o ${fmtMin(b.start)} (${b.serviceName}). Zmiana terminu: ${link}`;
}

function timeOptions(day, duration, current, id, force) {
  const busy = (busyByDay(D.bookings.filter((b) => OCCUPYING.has(b.status)))[day] || []);
  let list;
  if (force) {
    list = [];
    for (let t = 6 * 60; t + duration <= 23 * 60; t += 15) if (!busy.some((b) => b.id !== id && t < b.end && b.start < t + duration)) list.push(t);
  } else {
    list = freeStarts(D, day, duration, busy.filter((b) => b.id !== id), { ignoreLead: true, ignoreHorizon: true });
  }
  if (current != null && !list.includes(current)) list = [...list, current].sort((a, b) => a - b);
  return list;
}

function editBooking(b, preset = {}) {
  const isNew = !b;
  const cur = b ? { ...b } : { serviceId: D.services.find((s) => s.active)?.id, day: preset.day || todayYmd(), start: preset.start ?? null, name: '', phone: '', note: '', status: 'confirmed' };
  const svc0 = svcById(cur.serviceId);
  cur.duration ??= svc0?.duration || 60;
  cur.price ??= svc0?.price || 0;
  const past = !isNew && toDate(cur.day, cur.start) < new Date();
  const stats = !isNew ? clientStats(cur.phone, cur.id) : null;
  const initial = (cur.name || '?').trim()[0]?.toUpperCase() || '?';

  const body = h(html`<form novalidate>
    ${!isNew ? raw(html`<div class="contact-head">
      <div class="avatar">${initial}</div>
      <h3>${cur.name}</h3>
      <p class="num">${fmtPhone(cur.phone)} · <span class="badge ${cur.status}">${STATUS[cur.status]}</span></p>
      ${stats ? raw(html`<p style="font-size:13px;margin-top:4px">${stats.visits ? `${stats.visits} wcześniejsz${stats.visits === 1 ? 'a wizyta' : 'e wizyty'}` : 'Pierwsza wizyta'}${stats.noshow ? ` · ${stats.noshow}× nieobecność` : ''}${stats.cancelled ? ` · ${stats.cancelled}× odwołał` : ''}</p>`) : ''}
      <div class="contact-actions">
        <a href="tel:${normPhone(cur.phone)}">${raw(icon('phone'))}Zadzwoń</a>
        <a href="sms:${normPhone(cur.phone)}">${raw(icon('message'))}SMS</a>
        <a href="sms:${normPhone(cur.phone)}?&body=${encodeURIComponent(reminderText(cur))}">${raw(icon('bolt'))}Przypomnij</a>
      </div>
    </div>`) : ''}
    ${!isNew && cur.status !== 'cancelled' ? raw(html`<div style="margin:8px 0 4px">${raw(segmented('status', [
      { value: 'confirmed', label: 'Potwierdzona' }, { value: 'done', label: 'Zakończona' }, { value: 'noshow', label: 'Nieobecność' },
    ], cur.status))}</div>`) : ''}
    <h2 class="group-label">Termin</h2>
    <div class="group">
      <div class="row field"><label for="e-svc">Usługa</label><select id="e-svc" name="serviceId">${D.services.filter((s) => s.active || s.id === cur.serviceId).map((s) => raw(html`<option value="${s.id}" ${s.id === cur.serviceId ? 'selected' : ''}>${s.name}</option>`))}</select>${raw(icon('chevronD', 'row-chev'))}</div>
      <div class="row field"><label for="e-day">Dzień</label><input id="e-day" type="date" name="day" value="${cur.day}" style="flex:0 1 auto;min-width:0"><span class="row-val" style="flex:1;text-align:right;font-size:15px;overflow:hidden" data-dayname></span></div>
      <div class="row field"><label for="e-time">Godzina</label><select id="e-time" name="start"></select>${raw(icon('chevronD', 'row-chev'))}</div>
      <div class="row field"><label for="e-dur">Czas</label><select id="e-dur" name="duration">${[60, 90, 120, 150, 180, 240].map((m) => raw(html`<option value="${m}" ${m === cur.duration ? 'selected' : ''}>${fmtDuration(m)}</option>`))}</select>${raw(icon('chevronD', 'row-chev'))}</div>
      <label class="row"><div class="row-main"><div class="row-title">Poza grafikiem</div><div class="row-sub" style="font-size:13px">Pozwól na godziny spoza grafiku i w dni wolne</div></div><span class="switch"><input type="checkbox" name="force"><span></span></span></label>
    </div>
    <h2 class="group-label">Klient</h2>
    <div class="group">
      <div class="row field" data-f="name"><label for="e-name">Imię</label><input id="e-name" name="name" value="${cur.name}" placeholder="Imię klienta" autocomplete="off" ${isNew ? 'autofocus' : ''}></div>
      <div class="row field" data-f="phone"><label for="e-phone">Telefon</label><input id="e-phone" name="phone" type="tel" inputmode="tel" value="${cur.phone ? fmtPhone(cur.phone) : ''}" placeholder="500 600 700"></div>
      <div class="row field"><label for="e-price">Cena</label><input id="e-price" name="price" type="number" inputmode="decimal" min="0" step="1" value="${cur.price}"><span class="row-val">zł</span></div>
      <div class="row field"><label for="e-note">Notatka</label><textarea id="e-note" name="note" rows="2" placeholder="np. preferuje krótko po bokach">${cur.note || ''}</textarea></div>
    </div>
    <p class="field-error" data-err hidden></p>
    <div class="btn-stack" style="margin-top:22px">
      ${!isNew && cur.status !== 'cancelled' ? raw(html`<button type="button" class="btn danger" data-cancel>${raw(icon('trash'))}Odwołaj wizytę</button>`) : ''}
      ${!isNew && cur.status === 'cancelled' ? raw(html`<button type="button" class="btn secondary" data-restore>${raw(icon('undo'))}Przywróć wizytę</button>`) : ''}
    </div>
    ${!isNew ? raw(html`<p class="fine">Kod ${cur.code} · ${cur.source === 'admin' ? 'dodana w panelu' : 'rezerwacja online'} · utworzona ${new Date(cur.createdAt).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}</p>`) : ''}
  </form>`);
  wireSegmented(body);

  const f = body;
  const fill = () => {
    const day = f.day.value;
    const duration = Number(f.duration.value);
    const opts = timeOptions(day, duration, day === cur.day && cur.start != null ? (Number(f.start.value) || cur.start) : (f.start.value ? Number(f.start.value) : null), cur.id, f.force.checked);
    const keep = f.start.value ? Number(f.start.value) : cur.start;
    f.start.innerHTML = opts.length
      ? opts.map((t) => `<option value="${t}" ${t === keep ? 'selected' : ''}>${fmtMin(t)}–${fmtMin(t + duration)}</option>`).join('')
      : '<option value="">Brak wolnych godzin</option>';
    body.querySelector('[data-dayname]').textContent = day ? dowName(parseYmd(day).getDay()) : '';
  };
  fill();
  f.serviceId.addEventListener('change', () => {
    const s = svcById(f.serviceId.value);
    f.duration.value = String(s.duration);
    f.price.value = s.price;
    fill();
  });
  [f.day, f.duration, f.force].forEach((el) => el.addEventListener('change', fill));

  const sh = openSheet({
    title: isNew ? 'Nowa wizyta' : 'Wizyta', body, done: isNew ? 'Dodaj' : 'Zapisz', tall: true,
    onDone: async (close) => {
      const err = body.querySelector('[data-err]');
      body.querySelectorAll('.row').forEach((r) => r.classList.remove('invalid'));
      const name = f.name.value.trim();
      const phone = f.phone.value;
      if (!name) { body.querySelector('[data-f="name"]').classList.add('invalid'); err.textContent = 'Podaj imię klienta.'; err.hidden = false; return; }
      if (phone && !validPhone(phone)) { body.querySelector('[data-f="phone"]').classList.add('invalid'); err.textContent = 'Numer telefonu wygląda na niepełny.'; err.hidden = false; return; }
      if (!f.start.value) { err.textContent = 'Wybierz godzinę albo włącz „Poza grafikiem”.'; err.hidden = false; return; }
      const patch = {
        serviceId: f.serviceId.value, day: f.day.value, start: Number(f.start.value), duration: Number(f.duration.value),
        price: Number(f.price.value || 0), name, phone: normPhone(phone), note: f.note.value.trim(),
      };
      const st = f.querySelector('input[name="status"]:checked');
      if (st) patch.status = st.value;
      const moved = !isNew && (patch.day !== cur.day || patch.start !== cur.start);
      const res = await act(() => store.adminSaveBooking(cur.id || null, patch, { force: f.force.checked }), isNew ? 'Dodano wizytę' : moved ? 'Przełożono wizytę' : 'Zapisano zmiany');
      if (res) {
        close();
        if (moved && cur.phone) {
          actionSheet({
            title: 'Powiadomić klienta?', message: `Nowy termin: ${fmtDayLong(res.day)}, ${fmtMin(res.start)}`,
            actions: [{ label: 'Wyślij SMS z nowym terminem', icon: 'message', handler: () => { location.href = `sms:${normPhone(res.phone)}?&body=${encodeURIComponent(`Cześć ${res.name}! Twoja wizyta w ${D.salon.name} została przełożona na ${fmtDayLong(res.day)}, ${fmtMin(res.start)}.`)}`; } }],
            cancel: 'Nie teraz',
          });
        }
        if (res.day !== selDay && tab === 'cal') { selDay = res.day; rerender(); }
      }
    },
  });
  body.querySelector('[data-cancel]')?.addEventListener('click', async () => {
    const ok = await confirmAction({ title: 'Odwołać wizytę?', message: `${cur.name}, ${fmtDayLong(cur.day)} ${fmtMin(cur.start)}. Wizyta trafi do Kosza — przywrócisz ją jednym dotknięciem.`, confirm: 'Odwołaj wizytę' });
    if (!ok) return;
    if (await act(() => store.adminSetStatus(cur.id, 'cancelled'), 'Odwołano wizytę')) sh.close();
  });
  body.querySelector('[data-restore]')?.addEventListener('click', async () => {
    if (await act(() => store.adminSetStatus(cur.id, 'confirmed'), 'Przywrócono wizytę')) sh.close();
  });
  if (past && !isNew && cur.status === 'confirmed') body.querySelector('.seg')?.scrollIntoView({ block: 'nearest' });
}

// ================================================================ LISTA WIZYT
function listView() {
  const v = viewShell({ title: 'Wizyty', cls: 'has-tabbar', right: `<button class="nav-btn" data-add aria-label="Nowa wizyta">${icon('plus')}</button>` });
  const c = v.querySelector('.content');
  let mode = 'up';
  let q = '';
  c.insertAdjacentHTML('beforeend', html`
    <label class="search">${raw(icon('search'))}<input type="search" placeholder="Szukaj: imię, telefon, kod" aria-label="Szukaj wizyt"></label>
    <div style="margin:8px 0 0">${raw(segmented('lmode', [{ value: 'up', label: 'Nadchodzące' }, { value: 'past', label: 'Historia' }, { value: 'trash', label: 'Kosz' }], mode))}</div>
    <div data-list></div>`);
  wireSegmented(c);
  const out = c.querySelector('[data-list]');
  v.render = () => {
    const now = new Date();
    const qq = q.toLowerCase().replace(/\s/g, '');
    let list = D.bookings.filter((b) => {
      if (mode === 'trash') return b.status === 'cancelled';
      if (b.status === 'cancelled') return false;
      const future = toDate(b.day, b.end) >= now;
      return mode === 'up' ? future : !future;
    });
    if (qq) list = list.filter((b) => `${b.name}${b.phone}${b.code}${b.serviceName}`.toLowerCase().replace(/\s/g, '').includes(qq));
    list.sort((a, b) => (a.day + String(a.start).padStart(4, '0')).localeCompare(b.day + String(b.start).padStart(4, '0')));
    if (mode !== 'up') list.reverse();
    if (!list.length) {
      out.innerHTML = html`<div class="empty">${raw(icon(mode === 'trash' ? 'trash' : 'calendar'))}<h4>${q ? 'Nic nie znaleziono' : mode === 'trash' ? 'Kosz jest pusty' : mode === 'up' ? 'Brak nadchodzących wizyt' : 'Brak historii'}</h4><p>${mode === 'trash' ? 'Odwołane wizyty trafiają tutaj i zawsze można je przywrócić.' : q ? 'Sprawdź pisownię albo szukaj po numerze telefonu.' : ''}</p></div>`;
      return;
    }
    const groups = {};
    list.slice(0, 300).forEach((b) => (groups[b.day] ||= []).push(b));
    out.innerHTML = Object.entries(groups).map(([day, items]) => html`
      <h2 class="group-label">${relDay(day) === 'Dziś' || relDay(day) === 'Jutro' ? `${relDay(day)} · ` : ''}${fmtDayLong(day)}</h2>
      <div class="group">${items.map((b) => raw(html`<button class="row" data-id="${b.id}">
        <span class="num" style="width:48px;font-weight:600">${fmtMin(b.start)}</span>
        <div class="row-main"><div class="row-title">${b.name}</div><div class="row-sub">${b.serviceName} · ${fmtPrice(b.price)}</div></div>
        ${b.status !== 'confirmed' ? raw(html`<span class="badge ${b.status}">${STATUS[b.status]}</span>`) : ''}
        ${raw(icon('chevronR', 'row-chev'))}</button>`))}</div>`).join('');
    out.querySelectorAll('[data-id]').forEach((el) => el.addEventListener('click', () => editBooking(D.bookings.find((x) => x.id === el.dataset.id))));
  };
  c.querySelector('input[type="search"]').addEventListener('input', (e) => { q = e.target.value; v.render(); });
  c.querySelector('.seg').addEventListener('change', (e) => { mode = e.target.value; v.render(); });
  v.querySelector('[data-add]').addEventListener('click', () => editBooking(null, { day: todayYmd() }));
  v.render();
  return v;
}

// ================================================================ GRAFIK
function hoursLabel(d) {
  if (!d.open) return 'Wolne';
  return `${fmtMin(toMin(d.start))}–${fmtMin(toMin(d.end))}${d.breakStart ? ` · przerwa ${fmtMin(toMin(d.breakStart))}–${fmtMin(toMin(d.breakEnd))}` : ''}`;
}

function hoursView() {
  const v = viewShell({ title: 'Grafik', cls: 'has-tabbar' });
  const c = v.querySelector('.content');
  const s = () => D.settings;
  v.render = () => {
    const today = todayYmd();
    const ex = D.exceptions.filter((e) => (e.to || e.from) >= today).sort((a, b) => a.from.localeCompare(b.from));
    c.innerHTML = html`<h1 class="large-title">Grafik</h1>
      <h2 class="group-label">Tydzień pracy</h2>
      <div class="group">${WEEK_ORDER.map((i) => raw(html`<button class="row" data-dow="${i}">
        <div class="row-main"><div class="row-title" style="text-transform:capitalize">${dowName(i)}</div>
        <div class="row-sub num" style="${D.hours[i].open ? '' : 'color:var(--label-3)'}">${hoursLabel(D.hours[i])}</div></div>
        ${raw(icon('chevronR', 'row-chev'))}</button>`))}</div>
      <p class="group-foot">Klienci widzą tylko godziny, w których mieści się cała usługa.</p>

      <h2 class="group-label">Urlopy i wyjątki</h2>
      <div class="group">
        ${ex.map((e) => raw(html`<button class="row has-icon" data-ex="${e.id}">
          <span class="row-icon ${e.type === 'closed' ? 'red' : 'orange'}">${raw(icon(e.type === 'closed' ? 'x' : 'clock'))}</span>
          <div class="row-main"><div class="row-title">${e.from === (e.to || e.from) ? fmtDayShort(e.from) : `${fmtDayShort(e.from)} – ${fmtDayShort(e.to)}`}</div>
          <div class="row-sub">${e.type === 'closed' ? 'Nieczynne' : `Godziny ${e.start}–${e.end}`}${e.note ? ` · ${e.note}` : ''}</div></div>${raw(icon('chevronR', 'row-chev'))}</button>`))}
        <button class="row has-icon tinted" data-ex-add><span class="row-icon">${raw(icon('plus'))}</span><div class="row-main"><div class="row-title">Dodaj urlop lub wyjątek</div></div></button>
      </div>

      <h2 class="group-label">Rezerwacje online</h2>
      <div class="group">
        <div class="row" style="display:block"><div class="row-title" style="margin-bottom:8px">Początek wizyty co</div>${raw(segmented('stepMin', [{ value: '30', label: '30 min' }, { value: '60', label: '60 min' }], String(s().stepMin)))}</div>
        ${raw(selectRow('bufferMin', 'Przerwa między wizytami', [[0, 'Brak'], [10, '10 min'], [15, '15 min'], [30, '30 min']], s().bufferMin))}
        ${raw(selectRow('leadMin', 'Najwcześniej na', [[0, 'Od zaraz'], [60, '1 h przed'], [120, '2 h przed'], [240, '4 h przed'], [720, '12 h przed'], [1440, 'Dzień przed']], s().leadMin))}
        ${raw(selectRow('horizonDays', 'Rezerwacje do przodu', [[14, '2 tygodnie'], [30, '30 dni'], [60, '60 dni'], [90, '90 dni']], s().horizonDays))}
        ${raw(selectRow('cancelHours', 'Klient odwołuje do', [[2, '2 h przed'], [6, '6 h przed'], [12, '12 h przed'], [24, '24 h przed'], [48, '48 h przed']], s().cancelHours))}
        ${raw(selectRow('maxPerPhone', 'Wizyt na 1 numer', [[1, '1'], [2, '2'], [3, '3'], [5, '5']], s().maxPerPhone))}
      </div>`;
    wireSegmented(c);
    c.querySelectorAll('[data-dow]').forEach((b) => b.addEventListener('click', () => editDay(Number(b.dataset.dow))));
    c.querySelectorAll('[data-ex]').forEach((b) => b.addEventListener('click', () => editException(D.exceptions.find((e) => e.id === b.dataset.ex))));
    c.querySelector('[data-ex-add]').addEventListener('click', () => editException(null));
    c.querySelectorAll('[data-set], input[name="stepMin"]').forEach((el) => el.addEventListener('change', async () => {
      const key = el.dataset.set || el.name;
      const next = { ...D.settings, [key]: Number(el.value) };
      await act(() => store.saveConfig('settings', next, 'Zmiana zasad rezerwacji'), 'Zapisano', { undo: false });
    }));
  };
  v.render();
  return v;
}
function selectRow(key, label, opts, val) {
  return html`<div class="row field"><span class="lbl" style="width:auto;flex:1">${label}</span>
    <select data-set="${key}" aria-label="${label}" style="flex:none;text-align:right;color:var(--label-2)">${opts.map(([v, l]) => raw(html`<option value="${v}" ${Number(v) === Number(val) ? 'selected' : ''}>${l}</option>`))}</select>${raw(icon('chevronD', 'row-chev'))}</div>`;
}

function editDay(i) {
  const d = { ...D.hours[i] };
  const body = h(html`<div>
    <div class="group" style="margin-top:8px">
      <label class="row"><div class="row-main"><div class="row-title">Dzień pracujący</div></div><span class="switch"><input type="checkbox" name="open" ${d.open ? 'checked' : ''}><span></span></span></label>
    </div>
    <div data-times ${d.open ? '' : 'hidden'}>
      <h2 class="group-label">Godziny</h2>
      <div class="group">
        <div class="row field"><span class="lbl" style="flex:1">Otwarcie</span><input type="time" name="start" value="${d.start}" step="1800"></div>
        <div class="row field"><span class="lbl" style="flex:1">Zamknięcie</span><input type="time" name="end" value="${d.end}" step="1800"></div>
      </div>
      <h2 class="group-label">Przerwa</h2>
      <div class="group">
        <label class="row"><div class="row-main"><div class="row-title">Przerwa w ciągu dnia</div></div><span class="switch"><input type="checkbox" name="hasBreak" ${d.breakStart ? 'checked' : ''}><span></span></span></label>
        <div class="row field" data-br ${d.breakStart ? '' : 'hidden'}><span class="lbl" style="flex:1">Od</span><input type="time" name="breakStart" value="${d.breakStart || '14:00'}" step="900"></div>
        <div class="row field" data-br ${d.breakStart ? '' : 'hidden'}><span class="lbl" style="flex:1">Do</span><input type="time" name="breakEnd" value="${d.breakEnd || '14:30'}" step="900"></div>
      </div>
    </div>
    <p class="field-error" data-err hidden></p>
    <p class="fine">Zmiana grafiku nie odwołuje istniejących wizyt — zobaczysz je dalej w kalendarzu.</p>
  </div>`);
  const q = (n) => body.querySelector(`[name="${n}"]`);
  q('open').addEventListener('change', () => { body.querySelector('[data-times]').hidden = !q('open').checked; });
  q('hasBreak').addEventListener('change', () => body.querySelectorAll('[data-br]').forEach((r) => { r.hidden = !q('hasBreak').checked; }));
  openSheet({
    title: dowName(i).replace(/^./, (m) => m.toUpperCase()), body, done: 'Zapisz',
    onDone: async (close) => {
      const next = {
        open: q('open').checked, start: q('start').value, end: q('end').value,
        breakStart: q('hasBreak').checked ? q('breakStart').value : '', breakEnd: q('hasBreak').checked ? q('breakEnd').value : '',
      };
      const err = body.querySelector('[data-err]');
      if (next.open && toMin(next.end) - toMin(next.start) < 60) { err.textContent = 'Dzień pracy musi trwać co najmniej godzinę.'; err.hidden = false; return; }
      if (next.breakStart && (toMin(next.breakEnd) <= toMin(next.breakStart) || toMin(next.breakStart) < toMin(next.start) || toMin(next.breakEnd) > toMin(next.end))) { err.textContent = 'Przerwa musi mieścić się w godzinach pracy.'; err.hidden = false; return; }
      if (await act(() => store.saveConfig('hours', { ...D.hours, [i]: next }, `Grafik: ${dowName(i)}`), 'Zapisano grafik', { undo: false })) close();
    },
  });
}

function editException(e) {
  const isNew = !e;
  const x = e ? { ...e } : { id: Math.random().toString(36).slice(2, 10), type: 'closed', from: todayYmd(), to: todayYmd(), start: '10:00', end: '14:00', note: '' };
  const body = h(html`<div>
    <div style="margin:8px 0 0">${raw(segmented('type', [{ value: 'closed', label: 'Nieczynne' }, { value: 'hours', label: 'Inne godziny' }], x.type))}</div>
    <div class="group" style="margin-top:16px">
      <div class="row field"><span class="lbl" style="flex:1">Od</span><input type="date" name="from" value="${x.from}"></div>
      <div class="row field"><span class="lbl" style="flex:1">Do</span><input type="date" name="to" value="${x.to || x.from}"></div>
      <div class="row field" data-h ${x.type === 'hours' ? '' : 'hidden'}><span class="lbl" style="flex:1">Otwarcie</span><input type="time" name="start" value="${x.start || '10:00'}" step="1800"></div>
      <div class="row field" data-h ${x.type === 'hours' ? '' : 'hidden'}><span class="lbl" style="flex:1">Zamknięcie</span><input type="time" name="end" value="${x.end || '14:00'}" step="1800"></div>
      <div class="row field"><label for="x-note">Opis</label><input id="x-note" name="note" value="${x.note}" placeholder="np. Urlop, Szkolenie"></div>
    </div>
    <div data-warn></div>
    ${!isNew ? raw(html`<div class="btn-stack" style="margin-top:22px"><button type="button" class="btn danger" data-del>Usuń wyjątek</button></div>`) : ''}
  </div>`);
  wireSegmented(body);
  const q = (n) => body.querySelector(`[name="${n}"]`);
  const warn = () => {
    const from = q('from').value; const to = q('to').value || from;
    const hit = D.bookings.filter((b) => b.status === 'confirmed' && b.day >= from && b.day <= to);
    body.querySelector('[data-warn]').innerHTML = hit.length && body.querySelector('input[name="type"]:checked').value === 'closed'
      ? html`<div class="demo-flag">${raw(icon('exclaim'))}<span>W tym okresie ${hit.length === 1 ? 'jest 1 wizyta' : `są wizyty (${hit.length})`}. Nie zostaną odwołane automatycznie — przełóż je lub odwołaj ręcznie.</span></div>`
      : '';
  };
  body.addEventListener('change', (ev) => {
    if (ev.target.name === 'type') body.querySelectorAll('[data-h]').forEach((r) => { r.hidden = ev.target.value !== 'hours'; });
    if (ev.target.name === 'from' && q('to').value < q('from').value) q('to').value = q('from').value;
    warn();
  });
  warn();
  const sh = openSheet({
    title: isNew ? 'Nowy wyjątek' : 'Wyjątek', body, done: 'Zapisz',
    onDone: async (close) => {
      const type = body.querySelector('input[name="type"]:checked').value;
      const next = { ...x, type, from: q('from').value, to: q('to').value || q('from').value, start: q('start').value, end: q('end').value, note: q('note').value.trim() };
      if (!next.from) return;
      const list = isNew ? [...D.exceptions, next] : D.exceptions.map((y) => (y.id === x.id ? next : y));
      if (await act(() => store.saveConfig('exceptions', list, 'Urlopy i wyjątki'), 'Zapisano', { undo: false })) close();
    },
  });
  body.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (await act(() => store.saveConfig('exceptions', D.exceptions.filter((y) => y.id !== x.id), 'Usunięto wyjątek'), 'Usunięto wyjątek', { undo: false })) sh.close();
  });
}

// ================================================================ WIĘCEJ
function daysAgo(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function moreView() {
  const v = viewShell({ title: 'Więcej', cls: 'has-tabbar' });
  const c = v.querySelector('.content');
  v.render = async () => {
    const hl = store.health();
    const persisted = await store.persisted();
    const ago = daysAgo(hl.lastExport);
    const trash = D.bookings.filter((b) => b.status === 'cancelled').length;
    const backupWarn = MODE === 'demo' && (ago == null || ago > 7);
    c.innerHTML = html`<h1 class="large-title">Więcej</h1>
      <div class="health">
        <div class="health-top"><span class="row-icon">${raw(icon('shield'))}</span><div><strong>Dane wizyt są chronione</strong><span>${MODE === 'demo' ? 'Tryb demo · dane w tej przeglądarce' : 'Baza Supabase · kopia nocna'}</span></div></div>
        <ul>
          <li>${raw(icon('check'))}<span>Usuwanie wizyt jest zablokowane — odwołane trafiają do Kosza.</span></li>
          <li>${raw(icon('check'))}<span>Każda zmiana zapisana w historii i możliwa do cofnięcia.</span></li>
          ${MODE === 'demo' ? raw(html`
          <li>${raw(icon('check'))}<span>${hl.restorePoints} automatycznych punktów przywracania.</span></li>
          <li class="${persisted ? '' : 'warn'}">${raw(icon(persisted ? 'check' : 'exclaim'))}<span>${persisted ? 'Przeglądarka nie wyczyści danych sama.' : 'Dodaj panel do ekranu początkowego, aby przeglądarka nie czyściła danych.'}</span></li>
          <li class="${backupWarn ? 'warn' : ''}">${raw(icon(backupWarn ? 'exclaim' : 'check'))}<span>${hl.lastExport ? `Ostatnia kopia w pliku: ${ago === 0 ? 'dziś' : `${ago} dni temu`}.` : 'Nie pobrano jeszcze kopii do pliku.'}</span></li>`) : raw(html`<li>${raw(icon('check'))}<span>Nakładające się wizyty blokuje sama baza danych.</span></li>`)}
        </ul>
        <div class="btn-stack" style="grid-template-columns:1fr auto">
          <button class="btn secondary" data-export>${raw(icon('download'))}Pobierz kopię</button>
          <button class="btn gray" data-import>${raw(icon('upload'))}Wczytaj</button>
        </div>
        <input type="file" accept="application/json,.json" data-file hidden>
      </div>

      <h2 class="group-label">Salon</h2>
      <div class="group">
        <button class="row has-icon" data-go="services"><span class="row-icon">${raw(icon('scissors'))}</span><div class="row-main"><div class="row-title">Usługi i ceny</div></div><span class="row-val">${D.services.filter((s) => s.active).length}</span>${raw(icon('chevronR', 'row-chev'))}</button>
        <button class="row has-icon" data-go="salon"><span class="row-icon indigo">${raw(icon('store'))}</span><div class="row-main"><div class="row-title">Dane salonu</div></div>${raw(icon('chevronR', 'row-chev'))}</button>
        <button class="row has-icon" data-go="share"><span class="row-icon blue">${raw(icon('share'))}</span><div class="row-main"><div class="row-title">Link do rezerwacji</div><div class="row-sub" style="font-size:13px">Wklej na Instagram, Google, do SMS</div></div>${raw(icon('chevronR', 'row-chev'))}</button>
      </div>

      <h2 class="group-label">Bezpieczeństwo</h2>
      <div class="group">
        <button class="row has-icon" data-go="trash"><span class="row-icon red">${raw(icon('trash'))}</span><div class="row-main"><div class="row-title">Kosz</div></div><span class="row-val">${trash}</span>${raw(icon('chevronR', 'row-chev'))}</button>
        <button class="row has-icon" data-go="log"><span class="row-icon gray">${raw(icon('history'))}</span><div class="row-main"><div class="row-title">Historia zmian</div></div>${raw(icon('chevronR', 'row-chev'))}</button>
        <button class="row has-icon" data-go="points"><span class="row-icon orange">${raw(icon('undo'))}</span><div class="row-main"><div class="row-title">Punkty przywracania</div></div>${raw(icon('chevronR', 'row-chev'))}</button>
        ${MODE === 'demo' ? raw(html`<button class="row has-icon" data-go="pin"><span class="row-icon ink">${raw(icon('lock'))}</span><div class="row-main"><div class="row-title">Zmień PIN</div></div>${raw(icon('chevronR', 'row-chev'))}</button>`) : ''}
      </div>

      <div class="group" style="margin-top:26px">
        <a class="row tinted" href="index.html"><div class="row-main"><div class="row-title">Otwórz stronę klienta</div></div>${raw(icon('chevronR', 'row-chev'))}</a>
        <button class="row destructive" data-logout><div class="row-main"><div class="row-title">Wyloguj</div></div></button>
      </div>
      <p class="group-foot" style="text-align:center;margin-top:18px">FORM3LA · ${MODE === 'demo' ? 'tryb demo' : 'Supabase'} · wersja danych ${hl.rev}</p>`;

    c.querySelector('[data-export]').addEventListener('click', (e) => busy(e.currentTarget, doExport));
    const file = c.querySelector('[data-file]');
    c.querySelector('[data-import]').addEventListener('click', () => file.click());
    file.addEventListener('change', () => doImport(file.files[0]));
    c.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => {
      const g = b.dataset.go;
      if (g === 'services') stack.push(servicesView());
      if (g === 'salon') editSalon();
      if (g === 'share') shareBookingLink();
      if (g === 'trash') { tab = 'list'; renderTabbar(); const lv = listView(); stack.reset(lv); const r = lv.querySelector('input[value="trash"]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
      if (g === 'log') stack.push(logView());
      if (g === 'points') stack.push(pointsView());
      if (g === 'pin') changePin();
    }));
    c.querySelector('[data-logout]').addEventListener('click', async () => { await store.adminLogout(); stack.reset(loginView()); });
  };
  v.render();
  return v;
}

async function doExport() {
  try {
    const data = await store.exportAll();
    download(`form3la-kopia-${todayYmd()}.json`, JSON.stringify(data, null, 1), 'application/json');
    await reload(); rerender();
    island({ text: 'Kopia pobrana', sub: 'Zachowaj plik w Plikach / na Dysku', iconName: 'download' });
  } catch (e) { showError(e); }
}
async function doImport(f) {
  if (!f) return;
  let data;
  try { data = JSON.parse(await f.text()); } catch { return showError(Object.assign(new Error('Plik nie jest kopią FORM3LA.'), { user: true })); }
  const n = data?.data?.bookings?.length ?? 0;
  const ok = await confirmAction({ title: 'Wczytać kopię?', message: `Plik z ${data?.exportedAt ? new Date(data.exportedAt).toLocaleString('pl-PL') : '?'} · ${n} wizyt. Dane zostaną scalone — nic nie zostanie usunięte.`, confirm: 'Scal z obecnymi danymi', role: 'default' });
  if (!ok) return;
  try {
    const r = await store.importAll(data);
    await reload(); rerender();
    island({ text: 'Kopia wczytana', sub: `Nowe: ${r.added}, zaktualizowane: ${r.updated}` });
  } catch (e) { showError(e); }
}

function shareBookingLink() {
  const url = `${location.origin}${location.pathname.replace(/admin\.html$/, '')}`;
  const body = h(html`<div>
    <div class="recap" style="margin-top:8px"><div style="word-break:break-all;font-weight:600">${url}</div></div>
    <div class="btn-stack" style="margin-top:16px">
      <button class="btn" data-copy>${raw(icon('copy'))}Kopiuj link</button>
      ${navigator.share ? raw(html`<button class="btn secondary" data-share>${raw(icon('share'))}Udostępnij…</button>`) : ''}
    </div>
    <p class="fine">Wklej link w bio na Instagramie, w wizytówce Google i w automatycznej odpowiedzi na telefon.</p>
  </div>`);
  openSheet({ title: 'Link do rezerwacji', body, cancel: 'Zamknij' });
  body.querySelector('[data-copy]').addEventListener('click', async () => { try { await navigator.clipboard.writeText(url); island({ text: 'Skopiowano link', iconName: 'copy' }); } catch { /* */ } });
  body.querySelector('[data-share]')?.addEventListener('click', () => navigator.share({ title: D.salon.name, text: 'Zarezerwuj wizytę', url }).catch(() => {}));
}

function editSalon() {
  const s = D.salon;
  const body = h(html`<div><div class="group" style="margin-top:8px">
    <div class="row field"><label for="s-name">Nazwa</label><input id="s-name" name="name" value="${s.name}"></div>
    <div class="row field"><label for="s-tag">Podpis</label><input id="s-tag" name="tagline" value="${s.tagline}"></div>
    <div class="row field"><label for="s-addr">Adres</label><input id="s-addr" name="address" value="${s.address}"></div>
    <div class="row field"><label for="s-tel">Telefon</label><input id="s-tel" name="phone" type="tel" value="${fmtPhone(s.phone)}"></div>
    <div class="row field"><label for="s-map">Mapa</label><input id="s-map" name="mapsUrl" type="url" value="${s.mapsUrl}" placeholder="Link do Google Maps"></div>
  </div><p class="fine">Cyfra „3” w nazwie jest wyróżniana kolorem marki.</p></div>`);
  openSheet({
    title: 'Dane salonu', body, done: 'Zapisz',
    onDone: async (close) => {
      const q = (n) => body.querySelector(`[name="${n}"]`).value.trim();
      const next = { ...s, name: q('name') || 'FORM3LA', tagline: q('tagline'), address: q('address'), phone: normPhone(q('phone')), mapsUrl: q('mapsUrl') };
      if (await act(() => store.saveConfig('salon', next, 'Dane salonu'), 'Zapisano', { undo: false })) close();
    },
  });
}

function changePin() {
  const body = h(html`<div><div class="group" style="margin-top:8px">
    <div class="row field"><label for="p1">Nowy PIN</label><input id="p1" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password" placeholder="4 cyfry" autofocus></div>
    <div class="row field"><label for="p2">Powtórz</label><input id="p2" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password"></div>
  </div><p class="field-error" data-err hidden></p>
  <p class="fine">W trybie demo PIN chroni panel przed przypadkowym otwarciem. Po podłączeniu Supabase logujesz się e-mailem i hasłem.</p></div>`);
  openSheet({
    title: 'Zmień PIN', body, done: 'Zapisz',
    onDone: async (close) => {
      const a = $('#p1', body).value; const b = $('#p2', body).value;
      const err = body.querySelector('[data-err]');
      if (!/^\d{4}$/.test(a)) { err.textContent = 'PIN musi mieć 4 cyfry.'; err.hidden = false; return; }
      if (a !== b) { err.textContent = 'PIN-y się różnią.'; err.hidden = false; return; }
      try { await store.setPin(a); await reload(); island({ text: 'PIN zmieniony', iconName: 'lock' }); close(); } catch (e) { showError(e); }
    },
  });
}

// ---------- Usługi ----------
function servicesView() {
  const v = viewShell({ title: 'Usługi i ceny', back: 'Więcej', right: `<button class="nav-btn" data-add aria-label="Dodaj usługę">${icon('plus')}</button>` });
  const c = v.querySelector('.content');
  v.render = () => {
    const act1 = D.services.filter((s) => s.active);
    const hid = D.services.filter((s) => !s.active);
    const row = (s) => html`<button class="row" data-id="${s.id}"><div class="row-main"><div class="row-title">${s.name}</div><div class="row-sub num">${fmtDuration(s.duration)}</div></div><span class="svc-price">${fmtPrice(s.price)}</span>${raw(icon('chevronR', 'row-chev'))}</button>`;
    c.innerHTML = html`<h1 class="large-title">Usługi i ceny</h1>
      <h2 class="group-label">Widoczne dla klientów</h2><div class="group">${act1.map((s) => raw(row(s)))}</div>
      ${hid.length ? raw(html`<h2 class="group-label">Ukryte</h2><div class="group">${hid.map((s) => raw(row(s)))}</div>`) : ''}
      <p class="group-foot">Usług nie usuwa się — ukryj je, a historia wizyt pozostanie spójna. Zmiana ceny nie zmienia ceny wizyt już zarezerwowanych.</p>`;
    c.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => editService(D.services.find((s) => s.id === b.dataset.id))));
  };
  v.querySelector('[data-add]').addEventListener('click', () => editService(null));
  v.querySelector('[data-back]').addEventListener('click', () => stack.pop());
  v.render();
  return v;
}

function editService(s) {
  const isNew = !s;
  const x = s ? { ...s } : { id: `srv-${Math.random().toString(36).slice(2, 8)}`, name: '', desc: '', duration: 60, price: 0, active: true };
  const body = h(html`<div><div class="group" style="margin-top:8px">
    <div class="row field"><label for="v-name">Nazwa</label><input id="v-name" name="name" value="${x.name}" placeholder="np. Strzyżenie męskie" ${isNew ? 'autofocus' : ''}></div>
    <div class="row field"><label for="v-desc">Opis</label><textarea id="v-desc" name="desc" rows="2" placeholder="Krótko: co zawiera">${x.desc}</textarea></div>
    <div class="row field"><label for="v-dur">Czas</label><select id="v-dur" name="duration">${[60, 90, 120, 150, 180, 240].map((m) => raw(html`<option value="${m}" ${m === x.duration ? 'selected' : ''}>${fmtDuration(m)}</option>`))}</select>${raw(icon('chevronD', 'row-chev'))}</div>
    <div class="row field"><label for="v-price">Cena</label><input id="v-price" name="price" type="number" inputmode="decimal" min="0" value="${x.price}"><span class="row-val">zł</span></div>
  </div>
  <div class="group" style="margin-top:22px"><label class="row"><div class="row-main"><div class="row-title">Widoczna dla klientów</div></div><span class="switch"><input type="checkbox" name="active" ${x.active ? 'checked' : ''}><span></span></span></label></div>
  <p class="field-error" data-err hidden></p>
  <p class="fine">Minimalny czas wizyty to 1 godzina.</p></div>`);
  openSheet({
    title: isNew ? 'Nowa usługa' : 'Usługa', body, done: 'Zapisz',
    onDone: async (close) => {
      const q = (n) => body.querySelector(`[name="${n}"]`);
      const next = { ...x, name: q('name').value.trim(), desc: q('desc').value.trim(), duration: Number(q('duration').value), price: Number(q('price').value || 0), active: q('active').checked };
      if (!next.name) { const e = body.querySelector('[data-err]'); e.textContent = 'Podaj nazwę usługi.'; e.hidden = false; return; }
      const list = isNew ? [...D.services, next] : D.services.map((y) => (y.id === x.id ? next : y));
      if (await act(() => store.saveConfig('services', list, `Usługa: ${next.name}`), 'Zapisano usługę', { undo: false })) close();
    },
  });
}

// ---------- Historia ----------
function logView() {
  const v = viewShell({ title: 'Historia zmian', back: 'Więcej' });
  const c = v.querySelector('.content');
  const ACTOR = { admin: 'Ty', klient: 'Klient', system: 'System' };
  v.render = () => {
    const items = [...D.log].reverse().slice(0, 200);
    c.innerHTML = html`<h1 class="large-title">Historia zmian</h1>
      <p class="group-foot" style="margin-top:0">Dziennik tylko się wydłuża — wpisów nie da się usunąć. Stuknij zmianę wizyty, aby ją cofnąć.</p>
      <div class="group" style="margin-top:14px">${items.map((l) => raw(html`<button class="row log-item" data-log="${l.id}" ${l.bookingId ? '' : 'disabled style="opacity:1;cursor:default"'}>
        <div class="row-main"><div class="row-title" style="font-size:15px">${l.summary}</div><div class="row-sub num">${new Date(l.at).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' })} · ${ACTOR[l.actor] || l.actor}</div></div>
        ${l.bookingId ? raw(icon('undo', 'row-chev')) : ''}</button>`))}</div>`;
    c.querySelectorAll('[data-log]:not([disabled])').forEach((b) => b.addEventListener('click', async () => {
      const l = D.log.find((x) => x.id === b.dataset.log);
      const ok = await confirmAction({ title: 'Cofnąć tę zmianę?', message: `${l.summary}. Wizyta wróci do stanu sprzed tej zmiany (cofnięcie też trafi do historii).`, confirm: 'Cofnij zmianę', role: 'default' });
      if (ok) doUndo(l.id);
    }));
  };
  v.querySelector('[data-back]').addEventListener('click', () => stack.pop());
  v.render();
  return v;
}

// ---------- Punkty przywracania ----------
function pointsView() {
  const v = viewShell({ title: 'Punkty przywracania', back: 'Więcej' });
  const c = v.querySelector('.content');
  v.render = async () => {
    const pts = await store.listRestorePoints();
    c.innerHTML = html`<h1 class="large-title">Punkty przywracania</h1>
      <p class="group-foot" style="margin-top:0">Zapisywane automatycznie przed każdą zmianą${MODE === 'demo' ? ' (20 ostatnich + 1 dziennie przez 30 dni)' : ' ustawień'}. Przywrócenie cofa grafik, usługi i stan wizyt — wizyty dodane później zostają.</p>
      ${pts.length ? raw(html`<div class="group" style="margin-top:14px">${pts.map((p) => raw(html`<button class="row" data-key="${p.key}">
        <div class="row-main"><div class="row-title num" style="font-size:15px">${new Date(p.at).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' })}</div>
        <div class="row-sub">${p.daily ? 'Kopia dzienna · ' : ''}wersja ${p.rev}${p.bookings != null ? ` · ${p.bookings} wizyt` : ''}</div></div>${raw(icon('chevronR', 'row-chev'))}</button>`))}</div>`)
        : raw(html`<div class="empty">${raw(icon('undo'))}<h4>Jeszcze brak punktów</h4><p>Pojawią się po pierwszej zmianie.</p></div>`)}`;
    c.querySelectorAll('[data-key]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmAction({ title: 'Przywrócić ten stan?', message: 'Obecny stan zostanie najpierw zapisany jako nowy punkt — możesz wrócić w każdej chwili.', confirm: 'Przywróć', role: 'default' });
      if (!ok) return;
      try { await store.restorePoint(b.dataset.key); await reload(); rerender(); island({ text: 'Przywrócono', iconName: 'undo' }); } catch (e) { showError(e); }
    }));
  };
  v.querySelector('[data-back]').addEventListener('click', () => stack.pop());
  v.render();
  return v;
}

// ================================================================ START
async function start() {
  await reload();
  renderTabbar();
  stack.reset(TABS.find((t) => t[0] === tab)[3]());
  const hl = store.health();
  if (hl.recoveredFrom) island({ text: 'Odtworzono dane z kopii', sub: 'Główny zapis był niedostępny — nic nie zginęło.', iconName: 'shield', tone: 'warn', ms: 6000 });
  else if (MODE === 'demo') {
    const ago = daysAgo(hl.lastExport);
    if (ago == null || ago > 7) setTimeout(() => island({ text: 'Zrób kopię zapasową', sub: ago == null ? 'Jeszcze nie pobrano kopii do pliku' : `Ostatnia ${ago} dni temu`, iconName: 'shield', tone: 'warn', action: { label: 'Pobierz', fn: doExport } }), 1200);
  }
}

store.subscribe(async () => { if (store.isAdmin()) { await reload(); rerender(); } });
setInterval(() => { if (tab === 'cal' && store.isAdmin()) stack.views[0]?.render?.(); }, 60000);

if (store.isAdmin()) await start();
else { D = { salon: (await store.getConfig()).salon }; stack.reset(loginView()); }
