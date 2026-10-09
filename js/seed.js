// Dane startowe trybu demo. Wszystko edytowalne w panelu barbera.
import { ymd, addDays, rid, shortCode } from './util.js';

export function seedConfig() {
  return {
    salon: {
      name: 'FORM3LA',
      tagline: 'Barbershop',
      address: 'ul. Przykładowa 12, Warszawa',
      phone: '+48500000000',
      mapsUrl: 'https://maps.google.com/?q=Warszawa',
      instagram: '',
    },
    settings: {
      stepMin: 30, // co ile minut można zacząć wizytę
      bufferMin: 0, // przerwa między wizytami
      leadMin: 120, // najwcześniej X min od teraz
      horizonDays: 30, // rezerwacje na ile dni do przodu
      cancelHours: 12, // klient może odwołać / przełożyć do X h przed
      maxPerPhone: 3, // maks. nadchodzących wizyt na jeden numer
    },
    services: [
      { id: 'srv-cut', name: 'Strzyżenie męskie', desc: 'Konsultacja, mycie, strzyżenie nożyczkami i maszynką, stylizacja.', duration: 60, price: 90, active: true },
      { id: 'srv-combo', name: 'Strzyżenie + broda', desc: 'Pełny pakiet: włosy i broda, gorący ręcznik na koniec.', duration: 90, price: 140, active: true },
      { id: 'srv-beard', name: 'Broda', desc: 'Trymowanie, konturowanie brzytwą, olejek.', duration: 60, price: 70, active: true },
      { id: 'srv-shave', name: 'Golenie brzytwą', desc: 'Klasyczne golenie z gorącym ręcznikiem.', duration: 60, price: 80, active: true },
      { id: 'srv-buzz', name: 'Strzyżenie maszynką', desc: 'Jedna długość na całej głowie, wykończenie konturów.', duration: 60, price: 60, active: true },
      { id: 'srv-kid', name: 'Strzyżenie dziecięce', desc: 'Dla dzieci do 12 lat.', duration: 60, price: 60, active: true },
      { id: 'srv-duo', name: 'Ojciec + syn', desc: 'Dwa strzyżenia jedno po drugim.', duration: 120, price: 150, active: true },
    ],
    // klucz = Date.getDay(): 0 niedziela … 6 sobota
    hours: {
      0: { open: false, start: '10:00', end: '16:00', breakStart: '', breakEnd: '' },
      1: { open: true, start: '10:00', end: '18:00', breakStart: '14:00', breakEnd: '14:30' },
      2: { open: true, start: '10:00', end: '19:00', breakStart: '14:00', breakEnd: '14:30' },
      3: { open: true, start: '10:00', end: '19:00', breakStart: '14:00', breakEnd: '14:30' },
      4: { open: true, start: '10:00', end: '19:00', breakStart: '14:00', breakEnd: '14:30' },
      5: { open: true, start: '10:00', end: '19:00', breakStart: '14:00', breakEnd: '14:30' },
      6: { open: true, start: '09:00', end: '15:00', breakStart: '', breakEnd: '' },
    },
    exceptions: [],
  };
}

/** Kilka przykładowych wizyt, żeby kalendarz admina nie był pusty w demo. */
export function seedBookings(cfg) {
  const names = [
    ['Kuba (demo)', '600100200', 'srv-cut', 600],
    ['Marek (demo)', '600100201', 'srv-combo', 690],
    ['Tomasz (demo)', '600100202', 'srv-beard', 900],
    ['Paweł (demo)', '600100203', 'srv-cut', 960],
    ['Adam (demo)', '600100204', 'srv-shave', 630],
    ['Bartek (demo)', '600100205', 'srv-buzz', 780],
  ];
  const out = [];
  let dayOffset = 1;
  for (const [i, [name, phone, sid, start]] of names.entries()) {
    let d = addDays(new Date(), dayOffset + Math.floor(i / 2));
    while (!cfg.hours[d.getDay()].open) d = addDays(d, 1);
    const s = cfg.services.find((x) => x.id === sid);
    const now = new Date().toISOString();
    out.push({
      id: rid(8), token: rid(16), code: shortCode(),
      serviceId: s.id, serviceName: s.name, price: s.price, duration: s.duration,
      day: ymd(d), start, end: start + s.duration,
      name, phone, note: '', status: 'confirmed', source: 'online',
      createdAt: now, updatedAt: now,
    });
  }
  return out;
}
