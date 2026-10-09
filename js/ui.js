// Komponenty w gramatyce iOS: stos nawigacji (push/pop), arkusze (sheet) z przeciąganiem,
// action sheet, „wyspa” powiadomień z Cofnij, ikony rysowane w jednej grubości kreski.
import { h, html, raw, reducedMotion, haptic, $ } from './util.js';

// ---------------- Ikony ----------------
const P = {
  chevronR: '<path d="M9 5l7 7-7 7"/>',
  chevronL: '<path d="M15 5l-7 7 7 7"/>',
  chevronD: '<path d="M6 9l6 6 6-6"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  calPlus: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4M12 13v5M9.5 15.5h5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  scissors: '<circle cx="6.5" cy="6.5" r="2.8"/><circle cx="6.5" cy="17.5" r="2.8"/><path d="M8.6 8.4L20 18M8.6 15.6L20 6"/>',
  phone: '<path d="M6.6 3.5h2.6l1.6 4.2-2 1.4a11 11 0 006.1 6.1l1.4-2 4.2 1.6v2.6a2 2 0 01-2.2 2A16.5 16.5 0 014.6 5.7a2 2 0 012-2.2z"/>',
  message: '<path d="M4 6.5A2.5 2.5 0 016.5 4h11A2.5 2.5 0 0120 6.5v8a2.5 2.5 0 01-2.5 2.5H10l-4.5 3.5V17h0A2.5 2.5 0 014 14.5z"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0113 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  checkCircle: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12.3l2.8 2.8L16.2 9.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 10.5v6M14 10.5v6"/>',
  undo: '<path d="M8.5 5L4 9.5 8.5 14"/><path d="M4 9.5h10a5.5 5.5 0 010 11h-3"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z"/><path d="M8.8 12l2.3 2.3 4.2-4.3"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
  upload: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 19.5h14"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.8" cy="6.5" r="1"/><circle cx="4.8" cy="12" r="1"/><circle cx="4.8" cy="17.5" r="1"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8"/>',
  hours: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12h4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2L5.5 5.5"/>',
  person: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20.5c1.2-3.9 4.1-5.8 7.5-5.8s6.3 1.9 7.5 5.8"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="M15.5 15.5L20 20"/>',
  more: '<circle cx="5.5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18.5" cy="12" r="1.4"/>',
  share: '<path d="M12 3.5V15M8 7.5l4-4 4 4M6 11H5v9.5h14V11h-1"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5"/>',
  history: '<path d="M4 12a8 8 0 102.4-5.7M4 4v4h4"/><path d="M12 8v4.3l3 1.7"/>',
  store: '<path d="M4 9.5l1.5-5h13l1.5 5M4 9.5v10h16v-10M4 9.5c0 1.7 1.3 2.5 2.7 2.5s2.6-.8 2.6-2.5c0 1.7 1.3 2.5 2.7 2.5s2.7-.8 2.7-2.5c0 1.7 1.2 2.5 2.6 2.5S20 11.2 20 9.5M10 19.5v-4.5h4v4.5"/>',
  sliders: '<path d="M5 6h9M18 6h1M5 12h3M12 12h7M5 18h11M20 18h-1"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
  logout: '<path d="M14 4.5H6.5v15H14M10.5 12H20M16.5 8.5L20 12l-3.5 3.5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>',
  sparkle: '<path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8z"/>',
  exclaim: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.5M12 16.2v.3"/>',
};
export const icon = (name, cls = '') =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;

// ---------------- Stos nawigacji ----------------
export class NavStack {
  constructor(root) {
    this.root = root;
    this.views = [];
    window.addEventListener('popstate', () => {
      if (this.views.length > 1) this.pop({ fromHistory: true });
    });
  }

  /** view: {el, title, onShow?} — el zawiera .navbar i .scroll */
  push(el, { replace = false, animate = true } = {}) {
    const prev = this.views[this.views.length - 1];
    this.root.appendChild(el);
    wireLargeTitle(el);
    const anim = animate && prev && !reducedMotion();
    if (replace && prev) {
      this.views.pop();
      el.classList.add('fade-in');
      setTimeout(() => prev.remove(), 300);
    } else if (prev) {
      history.pushState({ depth: this.views.length + 1 }, '');
      if (anim) {
        el.classList.add('enter');
        prev.classList.add('behind');
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('enter')));
      } else prev.classList.add('behind');
      prev.setAttribute('inert', '');
    }
    this.views.push(el);
    enableSwipeBack(el, this);
    return el;
  }

  pop({ fromHistory = false } = {}) {
    if (this.views.length < 2) return;
    const el = this.views.pop();
    const prev = this.views[this.views.length - 1];
    prev.removeAttribute('inert');
    prev.classList.remove('behind');
    prev.dispatchEvent(new CustomEvent('view:show'));
    if (reducedMotion()) el.remove();
    else {
      el.classList.add('leave');
      el.addEventListener('transitionend', () => el.remove(), { once: true });
      setTimeout(() => el.remove(), 600);
    }
    if (!fromHistory) history.back();
  }

  popToRoot() {
    while (this.views.length > 1) this.pop();
  }

  /** Zastępuje cały stos jednym widokiem (np. po rezerwacji). */
  reset(el) {
    const old = this.views.splice(0);
    this.root.appendChild(el);
    wireLargeTitle(el);
    el.classList.add('fade-in');
    this.views.push(el);
    setTimeout(() => old.forEach((v) => v.remove()), 320);
  }
}

function enableSwipeBack(el, stack) {
  if (stack.views.length < 2) return;
  let x0 = null; let y0 = 0; let dx = 0; let tracking = false;
  el.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    if (t.clientX > 28) return;
    x0 = t.clientX; y0 = t.clientY; dx = 0; tracking = false;
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (x0 == null) return;
    const t = e.touches[0];
    dx = Math.max(0, t.clientX - x0);
    if (!tracking && Math.abs(t.clientY - y0) > 14 && dx < 14) { x0 = null; return; }
    if (dx > 6) tracking = true;
    if (tracking) { el.style.transition = 'none'; el.style.transform = `translateX(${dx}px)`; }
  }, { passive: true });
  el.addEventListener('touchend', () => {
    if (x0 == null) return;
    el.style.transition = ''; el.style.transform = '';
    if (tracking && dx > window.innerWidth * 0.33) stack.pop();
    x0 = null;
  });
}

function wireLargeTitle(view) {
  const lt = view.querySelector('.large-title');
  const nav = view.querySelector('.navbar');
  const scroller = view.querySelector('.scroll');
  if (!nav || !scroller) return;
  const update = () => {
    const limit = lt ? lt.offsetTop + lt.offsetHeight - nav.offsetHeight : 4;
    nav.classList.toggle('scrolled', scroller.scrollTop > Math.max(4, limit));
  };
  scroller.addEventListener('scroll', update, { passive: true });
  update();
}

/** Szkielet widoku z paskiem nawigacji. */
export function viewShell({ title, back = null, right = '', large = true, cls = '' }) {
  return h(html`<section class="view ${cls}">
    <header class="navbar">
      <div class="nav-left">${back ? raw(`<button class="nav-back" data-back>${icon('chevronL')}<span>${back}</span></button>`) : ''}</div>
      <div class="nav-title">${title}</div>
      <div class="nav-right">${raw(right)}</div>
    </header>
    <div class="scroll"><div class="content">${large ? raw(`<h1 class="large-title">${title}</h1>`) : ''}</div></div>
  </section>`);
}

// ---------------- Arkusze ----------------
let sheetDepth = 0;
const layerRoot = () => $('#overlays');

export function openSheet({ title = '', body, cancel = 'Anuluj', done = null, onDone, onClose, tall = false }) {
  const layer = h(html`<div class="sheet-layer">
    <div class="scrim"></div>
    <div class="sheet ${tall ? 'tall' : ''}" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="grabber" aria-hidden="true"></div>
      <header class="sheet-head">
        <button class="sheet-btn" data-cancel>${cancel}</button>
        <h2>${title}</h2>
        ${done ? raw(`<button class="sheet-btn strong" data-done>${done}</button>`) : raw('<span class="sheet-btn ghost"></span>')}
      </header>
      <div class="sheet-body"></div>
    </div>
  </div>`);
  const sheet = layer.querySelector('.sheet');
  const bodyEl = layer.querySelector('.sheet-body');
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
  layerRoot().appendChild(layer);
  sheetDepth++;
  document.body.classList.add('sheet-open');
  document.body.dataset.sheets = sheetDepth;
  const lastFocus = document.activeElement;
  requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add('open')));

  let closed = false;
  const close = (reason) => {
    if (closed) return;
    closed = true;
    layer.classList.remove('open');
    sheet.style.transform = '';
    sheetDepth--;
    document.body.dataset.sheets = sheetDepth;
    if (!sheetDepth) document.body.classList.remove('sheet-open');
    const rm = () => layer.remove();
    if (reducedMotion()) rm(); else { sheet.addEventListener('transitionend', rm, { once: true }); setTimeout(rm, 600); }
    document.removeEventListener('keydown', onKey);
    lastFocus?.focus?.({ preventScroll: true });
    onClose?.(reason);
  };
  const onKey = (e) => { if (e.key === 'Escape' && layer === layerRoot().lastElementChild) close('esc'); };
  document.addEventListener('keydown', onKey);
  layer.querySelector('.scrim').addEventListener('click', () => close('scrim'));
  layer.querySelector('[data-cancel]').addEventListener('click', () => close('cancel'));
  layer.querySelector('[data-done]')?.addEventListener('click', () => onDone?.(close));

  // przeciągnij w dół, by zamknąć
  let y0 = null; let dy = 0; let t0 = 0;
  const startDrag = (e) => {
    if (e.target.closest('button,input,select,textarea,a')) return;
    if (e.currentTarget === bodyEl && bodyEl.scrollTop > 0) return;
    y0 = e.touches ? e.touches[0].clientY : e.clientY; dy = 0; t0 = performance.now();
  };
  const moveDrag = (e) => {
    if (y0 == null) return;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    dy = y - y0;
    if (dy <= 0) { sheet.style.transform = ''; return; }
    sheet.style.transition = 'none';
    sheet.style.transform = `translateY(${dy}px)`;
    if (e.cancelable && e.currentTarget !== bodyEl) e.preventDefault();
  };
  const endDrag = () => {
    if (y0 == null) return;
    sheet.style.transition = '';
    const v = dy / (performance.now() - t0);
    if (dy > 140 || (dy > 40 && v > 0.6)) close('drag'); else sheet.style.transform = '';
    y0 = null;
  };
  for (const zone of [layer.querySelector('.grabber'), layer.querySelector('.sheet-head'), bodyEl]) {
    zone.addEventListener('touchstart', startDrag, { passive: true });
    zone.addEventListener('touchmove', moveDrag, { passive: false });
    zone.addEventListener('touchend', endDrag);
  }
  setTimeout(() => {
    const f = bodyEl.querySelector('[autofocus]');
    if (f && matchMedia('(pointer:fine)').matches) f.focus();
  }, 380);
  return { el: layer, body: bodyEl, close };
}

/** Action sheet iOS. actions: [{label, role?: 'destructive'|'default', handler}] */
export function actionSheet({ title = '', message = '', actions = [], cancel = 'Anuluj' }) {
  return new Promise((resolve) => {
    const layer = h(html`<div class="sheet-layer action">
      <div class="scrim"></div>
      <div class="asheet" role="dialog" aria-modal="true">
        <div class="asheet-group">
          ${title || message ? raw(html`<div class="asheet-head">${title ? raw(`<strong>${html`${title}`}</strong>`) : ''}${message ? raw(`<p>${html`${message}`}</p>`) : ''}</div>`) : ''}
          ${actions.map((a, i) => raw(html`<button class="asheet-btn ${a.role || ''}" data-i="${i}">${a.icon ? raw(icon(a.icon)) : ''}<span>${a.label}</span></button>`))}
        </div>
        <button class="asheet-btn cancel" data-cancel>${cancel}</button>
      </div>
    </div>`);
    layerRoot().appendChild(layer);
    requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add('open')));
    const done = (val) => {
      layer.classList.remove('open');
      setTimeout(() => layer.remove(), 380);
      resolve(val);
    };
    layer.querySelector('.scrim').addEventListener('click', () => done(null));
    layer.querySelector('[data-cancel]').addEventListener('click', () => done(null));
    layer.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', async () => {
      haptic();
      const a = actions[Number(b.dataset.i)];
      done(a);
      await a.handler?.();
    }));
    layer.querySelector('[data-i], [data-cancel]')?.focus({ preventScroll: true });
  });
}

export const confirmAction = (opts) =>
  new Promise((resolve) => {
    actionSheet({ ...opts, actions: [{ label: opts.confirm, role: opts.role || 'destructive', handler: () => resolve(true) }] })
      .then((a) => { if (!a) resolve(false); });
  });

// ---------------- Wyspa (toast) ----------------
let islandTimer;
export function island({ text, sub = '', iconName = 'checkCircle', tone = 'ok', action = null, ms = 3200 }) {
  const el = $('#island');
  clearTimeout(islandTimer);
  el.className = `island tone-${tone}`;
  el.innerHTML = html`<span class="island-ic">${raw(icon(iconName))}</span><span class="island-txt"><strong>${text}</strong>${sub ? raw(`<small>${html`${sub}`}</small>`) : ''}</span>${action ? raw(`<button class="island-act">${html`${action.label}`}</button>`) : ''}`;
  el.querySelector('.island-act')?.addEventListener('click', () => { hide(); action.fn(); });
  requestAnimationFrame(() => el.classList.add('show'));
  haptic(tone === 'error' ? [10, 40, 10] : 8);
  const hide = () => el.classList.remove('show');
  islandTimer = setTimeout(hide, action ? Math.max(ms, 6000) : ms);
  el.onclick = (e) => { if (!e.target.closest('.island-act')) hide(); };
}

export function showError(e) {
  console.error(e);
  const msg = e?.user || e?.safety ? e.message : 'Coś poszło nie tak. Nic nie zostało utracone — spróbuj ponownie.';
  island({ text: e?.safety ? 'Zatrzymano dla bezpieczeństwa' : 'Nie udało się', sub: msg, iconName: e?.safety ? 'shield' : 'exclaim', tone: 'error', ms: 5200 });
}

/** Przycisk w stanie ładowania na czas obietnicy. */
export async function busy(btn, fn) {
  if (btn.disabled) return;
  btn.disabled = true;
  btn.classList.add('loading');
  try { return await fn(); } finally { btn.disabled = false; btn.classList.remove('loading'); }
}

/** Segmented control. */
export function segmented(name, options, value) {
  return html`<div class="seg" role="radiogroup" style="--n:${options.length}; --i:${Math.max(0, options.findIndex((o) => o.value === value))}">
    <span class="seg-thumb" aria-hidden="true"></span>
    ${options.map((o) => raw(html`<label class="seg-opt"><input type="radio" name="${name}" value="${o.value}" ${o.value === value ? 'checked' : ''}><span>${o.label}</span></label>`))}
  </div>`;
}
export function wireSegmented(root) {
  root.querySelectorAll('.seg').forEach((seg) => {
    seg.addEventListener('change', () => {
      const opts = [...seg.querySelectorAll('input')];
      seg.style.setProperty('--i', opts.findIndex((i) => i.checked));
      haptic(5);
    });
  });
}
