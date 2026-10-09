# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
Delegated: static HTML/CSS/vanilla JS (ES modules, no build step) hosted on GitHub Pages. Data layer behind one storage interface: `demo` adapter (browser localStorage, active now — user's choice) and a ready `supabase` adapter + SQL schema to switch on later.

## Users
- **Klient barbera** — otwiera link z Instagrama/Google/SMS na telefonie, chce w <60 s wybrać usługę, wolny dzień i godzinę, podać imię i telefon, zarezerwować i dodać wizytę do kalendarza w telefonie.
- **Barber (admin, właściciel)** — na telefonie między klientami: widzi dzień, przekłada/edytuje/odwołuje wizyty, ustawia dni i godziny pracy, przerwy, urlopy, usługi i ceny.

## Product Purpose
FORM3LA — własny kalendarz rezerwacji barbershopu, alternatywa dla Booksy bez prowizji i bez pośrednika. Sukces: klient rezerwuje bez telefonu do salonu; barber zarządza grafikiem jednym kciukiem; żadna wizyta nigdy nie ginie.

## Positioning
Jeden barber, jeden link, zero marketplace'u. Rezerwacja wygląda i działa jak natywna aplikacja iOS, a dane wizyt są chronione wielowarstwowo (brak trwałego usuwania, kosz, dziennik zmian, automatyczne kopie).

## Operating Context
Telefon w jednej ręce, często w pośpiechu. Barber używa panelu w salonie, między strzyżeniami, ręce zajęte — duże cele dotykowe.

## Capabilities and Constraints
- Sloty minimum 60 min; długość wynika z usługi (wielokrotność 30 min, min. 60).
- Klient podaje imię + telefon, bez konta. Dostaje link/kod do zarządzania wizytą.
- Dodanie do kalendarza: plik .ics (iOS/Android) + link Google Calendar.
- Admin: CRUD wizyt, przekładanie, godziny i dni pracy, wyjątki (urlop/dzień wolny), usługi.
- **Bezpieczeństwo danych jest wymaganiem nr 1**: brak twardego kasowania, kosz z przywracaniem, dziennik zmian, kopie automatyczne, eksport/import.
- Tryb demo: dane w przeglądarce — nie są współdzielone między urządzeniami. Do produkcji wymagane podłączenie Supabase.
- Admin PIN w trybie demo to tylko zasłona, nie zabezpieczenie.

## Brand Commitments
- Nazwa: FORM3LA (barbershop).
- Styl wizualny przypięty przez użytkownika: stylizowany na iOS/iPhone — prosty, przejrzysty, elegancki, przyjazna kolorystyka, eleganckie przejścia.

## Evidence on Hand
Brak prawdziwych danych: usługi, ceny, adres, godziny są przykładowe i edytowalne w panelu. Nie wymyślać opinii, liczby klientów ani ocen.

## Product Principles
1. Rezerwacja w trzech dotknięciach: usługa → termin → potwierdź.
2. Żadnej operacji, która nieodwracalnie niszczy dane.
3. Telefon jest jedynym urządzeniem, które się liczy.
4. Natywne konwencje iOS zamiast własnych wynalazków.

## Accessibility & Inclusion
Cele dotykowe ≥44 px, kontrast WCAG AA, respektowanie prefers-reduced-motion i trybu ciemnego.
