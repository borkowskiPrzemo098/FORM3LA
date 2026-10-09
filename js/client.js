// Aplikacja klienta: usługa → termin → potwierdzenie → karnet + kalendarz.
import { getStore } from './store.js';
import { MODE } from './config.js';
import { dayPlan, freeStarts } from './slots.js';
import { downloadIcs, googleUrl } from './ics.js';
import {
  html, raw, h, $, ymd, addDays, parseYmd, todayYmd, fmtMin, fmtDayLong, fmtPrice, fmtDuration,
  dowShort, monthName, validPhone, fmtPhone, normPhone, toDate, relDay, haptic, esc,
} from './util.js';
import { NavStack, viewShell, icon, openSheet, actionSheet, confirmAction, island, showError, busy } from './ui.js';

const MINE = 'f3.mine';
const ME = 'f3.me';
const store = await getStore();
let cfg = await store.getConfig();
const stack = new NavStack($('#stack'));

const mine = {
  list() { try { return JSON.parse(localStorage.getItem(MINE) || '[]'); } catch { return []; } },
  add(token) { const l = mine.list().filter((t) => t !== token); l.unshift(token); localStorage.setItem(MINE, JSON.stringify(l.slice(0, 20))); },
};
const me = {
  get() { try { return JSON.parse(localStorage.getItem(ME) || '{}'); } catch { return {}; } },
  set(v) { try { localStorage.setItem(ME, JSON.stringify(v)); } catch { /* */ } },
};
const manageUrl = (b) => `${location.origin}${location.pathname}#/w/${b.token}`;

// ---------------------------------------------------------------- Ekran główny
function openStatus() {
  const now = new Date();
  const today = ymd(now);
  const mins = now.getHours() * 60 + now.getMinutes();
  const p = dayPlan(cfg, today);
  if (p.open && mins >= p.start && mins < p.end) return { open: true, text: `Otwarte do ${fmtMin(p.end)}` };
  for (let i = p.open && mins < p.start ? 0 : 1; i < 14; i++) {
    const d = ymd(addDays(now, i));
    const q = dayPlan(cfg, d);
    if (q.open) return { open: false, text: `Zamknięte · otwieramy ${i === 0 ? 'dziś' : i === 1 ? 'jutro' : relDay(d)} o ${fmtMin(q.start)}` };
  }
  return { open: false, text: 'Zamknięte' };
}

async function homeView() {
  const v = viewShell({ title: cfg.salon.name, large: false, right: `<button class="nav-btn" data-mine aria-label="Moje wizyty">${icon('calendar')}</button>` });
  const c = v.querySelector('.content');
  const st = openStatus();
  const services = cfg.services.filter((s) => s.active);
  const word = esc(cfg.salon.name).replace(/3/, '<b>3</b>');
  c.innerHTML = html`
    <div class="brand"><span class="wordmark">${raw(word)}</span><small>${cfg.salon.tagline}</small></div>
    <p class="status-line"><span class="dot ${st.open ? '' : 'closed'}"></span>${st.text}</p>
    <div class="salon-actions">
      <a class="pill-btn" href="${cfg.salon.mapsUrl}" target="_blank" rel="noopener">${raw(icon('pin'))}Dojazd</a>
      ${cfg.salon.phone ? raw(html`<a class="pill-btn" href="tel:${normPhone(cfg.salon.phone)}">${raw(icon('phone'))}Zadzwoń</a>`) : ''}
    </div>
    <div data-upcoming></div>
    <h2 class="group-label">Wybierz usługę</h2>
    <div class="group">
      ${services.map((s) => raw(html`<button class="row svc" data-svc="${s.id}">
        <div class="row-main">
          <div class="row-title">${s.name}</div>
          ${s.desc ? raw(html`<div class="row-sub clamp">${s.desc}</div>`) : ''}
          <div class="svc-meta">${raw(icon('clock'))}<span>${fmtDuration(s.duration)}</span></div>
        </div>
        <span class="svc-price">${fmtPrice(s.price)}</span>
        ${raw(icon('chevronR', 'row-chev'))}
      </button>`))}
    </div>
    <p class="group-foot">${cfg.salon.address}. Płatność na miejscu.</p>
    ${MODE === 'demo' ? raw(html`<div class="demo-flag">${raw(icon('exclaim'))}<span><b>Wersja pokazowa.</b> Rezerwacje zapisują się tylko w tej przeglądarce. Dane salonu i ceny są przykładowe.</span></div>`) : ''}
    <div class="footer-links"><a href="admin.html">Panel barbera</a></div>`;

  c.querySelectorAll('[data-svc]').forEach((b) => b.addEventListener('click', () => {
    haptic(5);
    stack.push(pickView(cfg.services.find((s) => s.id === b.dataset.svc)));
  }));
  v.querySelector('[data-mine]').addEventListener('click', openMine);
  renderUpcoming(c.querySelector('[data-upcoming]'));
  v.addEventListener('view:show', () => renderUpcoming(c.querySelector('[data-upcoming]')));
  return v;
}

async function myBookings() {
  const out = [];
  for (const t of mine.list()) {
    const b = await store.getByToken(t).catch(() => null);
    if (b) out.push(b);
  }
  return out;
}

async function renderUpcoming(slot) {
  const list = (await myBookings()).filter((b) => b.status === 'confirmed' && toDate(b.day, b.end) > new Date()).sort((a, b) => (a.day + a.start).localeCompare(b.day + b.start));
  slot.innerHTML = list.length ? html`<h2 class="group-label">Twoje wizyty</h2>${list.slice(0, 3).map((b) => raw(miniPass(b)))}` : '';
  slot.querySelectorAll('[data-token]').forEach((el) => el.addEventListener('click', () => stack.push(bookingView(el.dataset.token))));
}

function miniPass(b) {
  const d = parseYmd(b.day);
  return html`<button class="mini-pass" data-token="${b.token}">
    <span class="date-tile"><small>${dowShort(d.getDay())}</small><strong>${d.getDate()}</strong></span>
    <span class="row-main"><span class="row-title" style="display:block;font-weight:600">${b.serviceName}</span>
    <span class="row-sub num" style="display:block">${relDay(b.day)}, ${fmtMin(b.start)}–${fmtMin(b.end)}</span></span>
    ${raw(icon('chevronR', 'row-chev'))}
  </button>`;
}

async function openMine() {
  const list = (await myBookings()).sort((a, b) => (b.day + b.start).localeCompare(a.day + a.start));
  const now = new Date();
  const up = list.filter((b) => b.status === 'confirmed' && toDate(b.day, b.end) > now).reverse();
  const past = list.filter((b) => !up.includes(b));
  const body = h(html`<div>
    ${up.length ? raw(html`<h2 class="group-label">Nadchodzące</h2>${up.map((b) => raw(miniPass(b)))}`) : raw(html`<div class="empty">${raw(icon('calendar'))}<h4>Brak zaplanowanych wizyt</h4><p>Wizyty zarezerwowane na tym telefonie pojawią się tutaj.</p></div>`)}
    ${past.length ? raw(html`<h2 class="group-label">Wcześniejsze i odwołane</h2>${past.slice(0, 8).map((b) => raw(miniPass(b)))}`) : ''}
    <p class="fine">Wizyta zarezerwowana na innym urządzeniu? Otwórz link „Zarządzaj wizytą” z kalendarza.</p>
  </div>`);
  const sh = openSheet({ title: 'Moje wizyty', body, cancel: 'Zamknij' });
  body.querySelectorAll('[data-token]').forEach((el) => el.addEventListener('click', () => { sh.close(); stack.push(bookingView(el.dataset.token)); }));
}

// ---------------------------------------------------------------- Wybór terminu
function pickView(service, reschedule = null) {
  const v = viewShell({ title: reschedule ? 'Nowy termin' : 'Termin', back: reschedule ? 'Wizyta' : 'Usługi', cls: 'no-large', large: false });
  const c = v.querySelector('.content');
  const horizon = cfg.settings.horizonDays || 30;
  const days = Array.from({ length: horizon + 1 }, (_, i) => ymd(addDays(new Date(), i)));
  let busyMap = {};
  let selDay = null;

  c.innerHTML = html`
    <div class="summary-chip" style="margin-top:8px">
      <span class="row-icon">${raw(icon('scissors'))}</span>
      <div class="row-main"><div class="row-title" style="font-weight:600">${service.name}</div>
      <div class="row-sub num">${fmtDuration(service.duration)} · ${fmtPrice(service.price)}</div></div>
    </div>
    <div class="month-head"><h3 data-month></h3></div>
    <div class="daystrip" role="group" aria-label="Wybierz dzień"></div>
    <div data-slots aria-live="polite"></div>`;
  const strip = c.querySelector('.daystrip');
  const slotsEl = c.querySelector('[data-slots]');
  const monthEl = c.querySelector('[data-month]');

  const startsFor = (day) => freeStarts(cfg, day, service.duration, (busyMap[day] || []).filter((b) => !reschedule || !(b.day === reschedule.day && b.start === reschedule.start)));

  function renderStrip() {
    strip.innerHTML = days.map((d) => {
      const date = parseYmd(d);
      const plan = dayPlan(cfg, d);
      const n = plan.open ? startsFor(d).length : 0;
      const cls = !plan.open ? 'off' : n ? '' : 'full';
      return html`<button class="day ${cls} ${d === todayYmd() ? 'today' : ''}" data-day="${d}" aria-pressed="${d === selDay}" ${!plan.open || !n ? 'aria-disabled="true"' : ''}
        aria-label="${fmtDayLong(d)}${!plan.open ? ', nieczynne' : !n ? ', brak wolnych godzin' : `, ${n} wolnych godzin`}">
        <small>${dowShort(date.getDay())}</small><strong>${date.getDate()}</strong><i></i></button>`;
    }).join('');
    strip.querySelectorAll('.day').forEach((b) => b.addEventListener('click', () => select(b.dataset.day, true)));
  }

  function select(day, user) {
    selDay = day;
    haptic(4);
    strip.querySelectorAll('.day').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.day === day)));
    const d = parseYmd(day);
    monthEl.textContent = `${monthName(d.getMonth())} ${d.getFullYear()}`;
    const el = strip.querySelector(`[data-day="${day}"]`);
    if (user && el) el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    renderSlots(day);
  }

  function renderSlots(day) {
    const plan = dayPlan(cfg, day);
    const starts = plan.open ? startsFor(day) : [];
    if (!starts.length) {
      const next = days.find((d) => d > day && dayPlan(cfg, d).open && startsFor(d).length);
      slotsEl.innerHTML = html`<div class="empty">${raw(icon(plan.open ? 'clock' : 'calendar'))}
        <h4>${plan.open ? 'Wszystkie godziny zajęte' : plan.note || 'Ten dzień jest wolny'}</h4>
        <p>${plan.open ? 'Spróbuj innego dnia — poniżej najbliższy wolny termin.' : 'Wybierz inny dzień z paska powyżej.'}</p>
        ${next ? raw(html`<button class="pill-btn" data-jump="${next}">Najbliższy: ${relDay(next)}, ${fmtMin(startsFor(next)[0])}</button>`) : ''}
      </div>`;
      slotsEl.querySelector('[data-jump]')?.addEventListener('click', (e) => select(e.currentTarget.dataset.jump, true));
      return;
    }
    const parts = [
      ['Rano', starts.filter((t) => t < 720)],
      ['Popołudnie', starts.filter((t) => t >= 720 && t < 1020)],
      ['Wieczór', starts.filter((t) => t >= 1020)],
    ].filter(([, l]) => l.length);
    let k = 0;
    slotsEl.innerHTML = parts.map(([label, list]) => html`
      <div class="slot-head"><h4>${label}</h4><span>${list.length} ${list.length === 1 ? 'termin' : list.length < 5 ? 'terminy' : 'terminów'}</span></div>
      <div class="slots slots-enter">${list.map((t) => raw(html`<button class="slot" style="--k:${k++}" data-t="${t}" aria-pressed="false" aria-label="${fmtMin(t)} do ${fmtMin(t + service.duration)}">${fmtMin(t)}</button>`))}</div>`).join('');
    slotsEl.querySelectorAll('.slot').forEach((b) => b.addEventListener('click', () => {
      slotsEl.querySelectorAll('.slot').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
      haptic(6);
      const t = Number(b.dataset.t);
      if (reschedule) confirmReschedule(reschedule, day, t, () => b.setAttribute('aria-pressed', 'false'));
      else confirmSheet(service, day, t, () => b.setAttribute('aria-pressed', 'false'));
    }));
  }

  async function load(keepDay) {
    const busy = await store.getBusy(days[0], days[days.length - 1]);
    busyMap = {};
    for (const b of busy) (busyMap[b.day] ||= []).push(b);
    renderStrip();
    const first = keepDay || days.find((d) => dayPlan(cfg, d).open && startsFor(d).length) || days[0];
    select(first, false);
    requestAnimationFrame(() => strip.querySelector(`[data-day="${first}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest' }));
  }
  v.reload = () => load(selDay);
  load();
  v.querySelector('[data-back]').addEventListener('click', () => stack.pop());
  return v;
}

// ---------------------------------------------------------------- Potwierdzenie
function confirmSheet(service, day, start, onCancel) {
  const saved = me.get();
  const body = h(html`<form novalidate>
    <div class="recap">
      <div class="recap-row">${raw(icon('scissors'))}<div><b>${service.name}</b><br><span>${fmtDuration(service.duration)}</span></div></div>
      <div class="recap-row">${raw(icon('calendar'))}<div><b>${fmtDayLong(day)}</b><br><span class="num">${fmtMin(start)}–${fmtMin(start + service.duration)}</span></div></div>
      <div class="recap-row">${raw(icon('pin'))}<div><span>${cfg.salon.address}</span></div></div>
      <div class="recap-total"><span>Do zapłaty na miejscu</span><strong>${fmtPrice(service.price)}</strong></div>
    </div>
    <h2 class="group-label">Twoje dane</h2>
    <div class="group">
      <div class="row field" data-f="name"><label for="f-name">Imię</label><input id="f-name" name="name" autocomplete="given-name" placeholder="np. Kuba" value="${saved.name || ''}" maxlength="60" required ${saved.name ? '' : 'autofocus'}></div>
      <div class="row field" data-f="phone"><label for="f-phone">Telefon</label><input id="f-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="500 600 700" value="${saved.phone ? fmtPhone(saved.phone) : ''}" required></div>
      <div class="row field"><label for="f-note">Uwagi</label><textarea id="f-note" name="note" rows="2" placeholder="Opcjonalnie" maxlength="300"></textarea></div>
    </div>
    <p class="field-error" data-err hidden></p>
    <p class="fine">Odwołasz lub przełożysz wizytę sam do ${cfg.settings.cancelHours} h przed terminem. Numer telefonu służy tylko do kontaktu w sprawie wizyty.</p>
    <button class="btn" type="submit">Zarezerwuj · ${fmtPrice(service.price)}</button>
  </form>`);
  let booked = false;
  const sh = openSheet({ title: 'Potwierdź wizytę', body, onClose: () => { if (!booked) onCancel(); } });
  const err = body.querySelector('[data-err]');
  body.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(body);
    const name = String(f.get('name') || '').trim();
    const phone = String(f.get('phone') || '');
    body.querySelectorAll('.row').forEach((r) => r.classList.remove('invalid'));
    const bad = [];
    if (!name) bad.push(['name', 'Podaj imię.']);
    if (!validPhone(phone)) bad.push(['phone', 'Podaj 9-cyfrowy numer telefonu.']);
    if (bad.length) {
      bad.forEach(([k]) => body.querySelector(`[data-f="${k}"]`).classList.add('invalid'));
      err.textContent = bad.map(([, m]) => m).join(' ');
      err.hidden = false;
      haptic([10, 40, 10]);
      body.querySelector(`[data-f="${bad[0][0]}"] input`).focus();
      return;
    }
    err.hidden = true;
    await busy(body.querySelector('.btn'), async () => {
      try {
        const b = await store.createBooking({ serviceId: service.id, day, start, name, phone, note: f.get('note') });
        booked = true;
        me.set({ name, phone: normPhone(phone) });
        mine.add(b.token);
        sh.close();
        stack.reset(doneView(b));
        history.replaceState(null, '', `#/w/${b.token}`);
      } catch (ex) {
        showError(ex);
        if (/zajęty|krótki/.test(ex.message)) { sh.close(); stack.views.at(-1).reload?.(); }
      }
    });
  });
}

function confirmReschedule(b, day, start, onCancel) {
  confirmAction({
    title: 'Przełożyć wizytę?',
    message: `${fmtDayLong(b.day)}, ${fmtMin(b.start)} → ${fmtDayLong(day)}, ${fmtMin(start)}`,
    confirm: 'Przełóż na ten termin', role: 'default',
  }).then(async (ok) => {
    if (!ok) return onCancel();
    try {
      const nb = await store.rescheduleByToken(b.token, day, start);
      island({ text: 'Przełożono wizytę', sub: `${relDay(nb.day)}, ${fmtMin(nb.start)}` });
      stack.reset(doneView(nb, true));
    } catch (e) { showError(e); onCancel(); stack.views.at(-1).reload?.(); }
  });
}

// ---------------------------------------------------------------- Karnet
function passMarkup(b, anim) {
  const stamp = b.status === 'cancelled' ? 'Odwołana' : b.status === 'done' ? 'Zakończona' : b.status === 'noshow' ? 'Nieobecność' : '';
  const word = esc(cfg.salon.name).replace(/3/, '<b>3</b>');
  return html`<article class="pass ${b.status === 'cancelled' ? 'cancelled' : ''} ${anim ? 'pass-in' : ''}" aria-label="Karnet wizyty">
    <div class="pass-top"><span class="wordmark">${raw(word)}</span><div class="pass-code">Kod<strong>${b.code}</strong></div></div>
    ${stamp ? raw(html`<span class="pass-stamp">${stamp}</span>`) : ''}
    <div class="pass-when"><small>${fmtDayLong(b.day)}</small><strong>${fmtMin(b.start)}</strong><span class="num">do ${fmtMin(b.end)}</span></div>
    <div class="pass-tear"></div>
    <div class="pass-grid">
      <div><small>Usługa</small>${b.serviceName}</div><div class="r"><small>Cena</small><span class="num">${fmtPrice(b.price)}</span></div>
      <div><small>Klient</small>${b.name}</div><div class="r"><small>Czas</small>${fmtDuration(b.duration)}</div>
      <div style="grid-column:1/-1"><small>Adres</small>${cfg.salon.address}</div>
    </div>
  </article>`;
}

async function addToCalendar(b) {
  const isApple = /iPhone|iPad|Macintosh/.test(navigator.userAgent);
  await actionSheet({
    title: 'Dodaj do kalendarza',
    message: 'Przypomnienie dzień wcześniej i 2 godziny przed wizytą.',
    actions: [
      { label: isApple ? 'Kalendarz iPhone' : 'Kalendarz w telefonie (.ics)', icon: 'calPlus', handler: () => downloadIcs(b, cfg.salon, manageUrl(b)) },
      { label: 'Kalendarz Google', icon: 'calendar', handler: () => window.open(googleUrl(b, cfg.salon, manageUrl(b)), '_blank', 'noopener') },
    ],
  });
}

async function shareLink(b) {
  const url = manageUrl(b);
  try {
    if (navigator.share) { await navigator.share({ title: `Wizyta ${cfg.salon.name}`, text: `${b.serviceName}, ${fmtDayLong(b.day)} ${fmtMin(b.start)}`, url }); return; }
    await navigator.clipboard.writeText(url);
    island({ text: 'Skopiowano link', sub: 'Zapisz go, aby zarządzać wizytą', iconName: 'copy' });
  } catch { /* anulowano udostępnianie */ }
}

function doneView(b, rescheduled = false) {
  const v = viewShell({ title: 'Zarezerwowano', large: false, cls: 'no-large', right: '<button class="nav-btn strong" data-home>Gotowe</button>' });
  const c = v.querySelector('.content');
  c.innerHTML = html`
    <div class="done-mark" aria-hidden="true"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="29"/><path d="M20 33l8 8 17-17"/></svg></div>
    <h1 class="done-title">${rescheduled ? 'Nowy termin zapisany' : 'Do zobaczenia!'}</h1>
    <p class="done-sub">${rescheduled ? 'Zaktualizuj wizytę w kalendarzu.' : 'Wizyta potwierdzona. Dodaj ją do kalendarza, żeby nie zapomnieć.'}</p>
    ${raw(passMarkup(b, true))}
    <div class="btn-stack" style="margin-top:20px">
      <button class="btn" data-cal>${raw(icon('calPlus'))}Dodaj do kalendarza</button>
      <button class="btn secondary" data-share>${raw(icon('share'))}Zapisz link do wizyty</button>
    </div>
    <p class="fine" style="text-align:center">Link pozwala odwołać lub przełożyć wizytę z dowolnego urządzenia.</p>`;
  c.querySelector('[data-cal]').addEventListener('click', () => addToCalendar(b));
  c.querySelector('[data-share]').addEventListener('click', () => shareLink(b));
  v.querySelector('[data-home]').addEventListener('click', goHome);
  return v;
}

async function goHome() {
  history.replaceState(null, '', location.pathname);
  cfg = await store.getConfig();
  stack.reset(await homeView());
}

function bookingView(token) {
  const v = viewShell({ title: 'Twoja wizyta', back: 'Wróć', large: false, cls: 'no-large' });
  const c = v.querySelector('.content');
  v.querySelector('[data-back]').addEventListener('click', () => (stack.views.length > 1 ? stack.pop() : goHome()));
  (async () => {
    const b = await store.getByToken(token);
    if (!b) {
      c.innerHTML = html`<div class="empty" style="margin-top:24px">${raw(icon('exclaim'))}<h4>Nie znaleziono wizyty</h4><p>Link mógł zostać skopiowany niepełny. Zadzwoń do salonu, jeśli potrzebujesz pomocy.</p></div>`;
      return;
    }
    mine.add(b.token);
    const active = b.status === 'confirmed' && toDate(b.day, b.end) > new Date();
    const late = toDate(b.day, b.start) - Date.now() < cfg.settings.cancelHours * 3600000;
    c.innerHTML = html`<div style="margin-top:12px">${raw(passMarkup(b, false))}</div>
      ${active ? raw(html`
        <div class="btn-stack" style="margin-top:20px">
          <button class="btn" data-cal>${raw(icon('calPlus'))}Dodaj do kalendarza</button>
        </div>
        <div class="group" style="margin-top:22px">
          <button class="row has-icon" data-move ${late ? 'disabled' : ''}><span class="row-icon blue">${raw(icon('calendar'))}</span><div class="row-main"><div class="row-title">Przełóż wizytę</div></div>${raw(icon('chevronR', 'row-chev'))}</button>
          <button class="row has-icon" data-share><span class="row-icon gray">${raw(icon('share'))}</span><div class="row-main"><div class="row-title">Udostępnij link</div></div>${raw(icon('chevronR', 'row-chev'))}</button>
          <button class="row has-icon destructive" data-cancel ${late ? 'disabled' : ''}><span class="row-icon red">${raw(icon('x'))}</span><div class="row-main"><div class="row-title">Odwołaj wizytę</div></div></button>
        </div>
        ${late ? raw(html`<p class="group-foot">Do wizyty zostało mniej niż ${cfg.settings.cancelHours} h — zmiany tylko telefonicznie: <a href="tel:${normPhone(cfg.salon.phone)}">${fmtPhone(cfg.salon.phone)}</a>.</p>`) : ''}`)
        : raw(html`<div class="btn-stack" style="margin-top:20px"><button class="btn secondary" data-again>Zarezerwuj ponownie</button></div>`)}`;
    c.querySelector('[data-cal]')?.addEventListener('click', () => addToCalendar(b));
    c.querySelector('[data-share]')?.addEventListener('click', () => shareLink(b));
    c.querySelector('[data-again]')?.addEventListener('click', () => {
      const s = cfg.services.find((x) => x.id === b.serviceId && x.active);
      if (s) stack.push(pickView(s)); else goHome();
    });
    c.querySelector('[data-move]')?.addEventListener('click', () => {
      const s = { id: b.serviceId, name: b.serviceName, duration: b.duration, price: b.price };
      stack.push(pickView(s, b));
    });
    c.querySelector('[data-cancel]')?.addEventListener('click', async () => {
      const ok = await confirmAction({ title: 'Odwołać wizytę?', message: `${b.serviceName}, ${fmtDayLong(b.day)} o ${fmtMin(b.start)}. Termin zwolni się dla innych.`, confirm: 'Odwołaj wizytę' });
      if (!ok) return;
      try {
        await store.cancelByToken(b.token);
        island({ text: 'Wizyta odwołana', sub: 'Pamiętaj, by usunąć ją z kalendarza', iconName: 'checkCircle' });
        stack.reset(bookingView(token));
      } catch (e) { showError(e); }
    });
  })();
  return v;
}

// ---------------------------------------------------------------- Start
async function route() {
  const m = location.hash.match(/^#\/w\/([a-f0-9]+)/);
  if (m) {
    stack.reset(await homeView());
    stack.push(bookingView(m[1]), { animate: false });
  } else stack.reset(await homeView());
}
store.subscribe(async () => { cfg = await store.getConfig(); });
await route();
document.documentElement.classList.add('ready');
