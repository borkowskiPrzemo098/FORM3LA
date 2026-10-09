// Dodawanie wizyty do kalendarza w telefonie: plik .ics (iPhone / Android / Outlook) i link Google.
import { toDate, pad, download } from './util.js';

const utc = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
const escIcs = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`);

function details(b, salon, manageUrl) {
  return [
    `${b.serviceName} · ${b.price} zł`,
    `Kod wizyty: ${b.code}`,
    salon.phone ? `Telefon: ${salon.phone}` : '',
    manageUrl ? `Zarządzaj wizytą: ${manageUrl}` : '',
  ].filter(Boolean).join('\n');
}

export function icsFor(b, salon, manageUrl) {
  const start = toDate(b.day, b.start);
  const end = toDate(b.day, b.end);
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FORM3LA//Rezerwacje//PL', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${b.id}@form3la`,
    `DTSTAMP:${utc(new Date())}`,
    `DTSTART:${utc(start)}`,
    `DTEND:${utc(end)}`,
    `SUMMARY:${escIcs(`${salon.name} — ${b.serviceName}`)}`,
    `LOCATION:${escIcs(salon.address)}`,
    `DESCRIPTION:${escIcs(details(b, salon, manageUrl))}`,
    manageUrl ? `URL:${manageUrl}` : '',
    'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', `DESCRIPTION:${escIcs(`Wizyta w ${salon.name} za 2 godziny`)}`, 'END:VALARM',
    'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', `DESCRIPTION:${escIcs(`Jutro wizyta w ${salon.name}`)}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean);
  return lines.join('\r\n');
}

export function downloadIcs(b, salon, manageUrl) {
  download(`wizyta-${salon.name.toLowerCase()}-${b.day}.ics`, icsFor(b, salon, manageUrl), 'text/calendar;charset=utf-8');
}

export function googleUrl(b, salon, manageUrl) {
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${salon.name} — ${b.serviceName}`,
    dates: `${utc(toDate(b.day, b.start))}/${utc(toDate(b.day, b.end))}`,
    location: salon.address,
    details: details(b, salon, manageUrl),
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}
