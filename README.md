# FORM3LA — rezerwacje dla barbershopu

Własny kalendarz rezerwacji (alternatywa dla Booksy) działający jak aplikacja iPhone'a w przeglądarce.

- **Klient:** `index.html` — usługa → dzień → godzina → imię i telefon → karnet wizyty → *Dodaj do kalendarza* (iPhone / Android / Google). Może sam odwołać lub przełożyć wizytę (link w kalendarzu).
- **Barber:** `admin.html` — kalendarz dnia, dodawanie wizyt z telefonu, przekładanie, statusy (zakończona / nieobecność), grafik tygodnia, urlopy, usługi i ceny, kopie zapasowe, kosz, historia zmian.

Bez frameworków i bez budowania — czyste HTML/CSS/JS, hostowane na GitHub Pages.

## Tryby pracy

| | **Demo (teraz)** | **Produkcja (Supabase)** |
|---|---|---|
| Gdzie są wizyty | w przeglądarce tego urządzenia | w bazie Postgres w chmurze |
| Klient i barber widzą to samo | tylko na tym samym urządzeniu | tak, na żywo |
| Logowanie barbera | PIN (start: `1234`) | e-mail + hasło |
| Koszt | 0 zł | 0 zł (darmowy plan Supabase) |

Tryb wybiera się w `js/config.js` — puste pola = demo.

## Ochrona przed utratą wizyt

Najważniejsze wymaganie projektu. Zabezpieczenia są warstwowe — awaria jednej nie powoduje utraty danych.

**Tryb demo (`js/store-demo.js`):**
1. **Wizyt nie da się usunąć.** Każdy zapis, po którym zniknęłaby choć jedna wizyta, jest odrzucany. Odwołanie = przeniesienie do Kosza.
2. **Blokada masowych zmian** — odwołanie więcej niż 3 wizyt naraz jest zatrzymywane.
3. **20 punktów przywracania + kopia dzienna (30 dni)** zapisywane automatycznie przed każdą zmianą.
4. **Lustro w IndexedDB** — przy starcie wybierany jest najnowszy poprawny stan ze wszystkich kopii. Przetestowane: uszkodzony zapis główny i wyczyszczony localStorage → dane odtworzone.
5. **Weryfikacja zapisu** — po każdym zapisie dane są odczytywane i porównywane; przy błędzie wraca poprzedni stan.
6. **Historia zmian (tylko dopisywanie)** — każdą zmianę wizyty można cofnąć; po każdej akcji pojawia się „Cofnij”.
7. **Import kopii scala, nigdy nie zastępuje.** Przywrócenie punktu nie usuwa wizyt dodanych później.
8. **Blokada między kartami** (Web Locks) i prośba o trwały magazyn.
9. Panel przypomina o pobraniu kopii do pliku, jeśli nie było jej od 7 dni.

**Tryb Supabase (`supabase/schema.sql`) — ochrona w samej bazie, niezależnie od aplikacji:**
- wyzwalacze blokują `DELETE` i `TRUNCATE` na wizytach i dzienniku (dla każdej roli),
- `EXCLUDE` constraint — nakładające się wizyty są fizycznie niemożliwe,
- `audit_log` z pełnym stanem „przed/po” każdej zmiany,
- `config_history` — każda wersja grafiku/usług do przywrócenia,
- klient anonimowy nie widzi danych innych klientów (RLS + funkcje RPC),
- **nocna zaszyfrowana kopia** do gałęzi `backups` (GitHub Action `.github/workflows/backup.yml`).

> ⚠️ Tryb demo trzyma dane w jednej przeglądarce. Do prawdziwej pracy z klientami podłącz Supabase (niżej). Do tego czasu regularnie pobieraj kopię (Więcej → Pobierz kopię) i dodaj panel do ekranu początkowego iPhone'a (Safari → Udostępnij → Do ekranu początkowego) — wtedy iOS nie czyści jego danych.

## Podłączenie Supabase (ok. 10 minut)

1. Załóż konto na [supabase.com](https://supabase.com) → **New project** (region: Frankfurt).
2. **SQL Editor** → wklej całe `supabase/schema.sql` → **Run**.
3. **Authentication → Users → Add user** — Twój e-mail i hasło.
4. W SQL Editor uruchom (z Twoim e-mailem):
   ```sql
   insert into public.admins(user_id) select id from auth.users where email = 'twoj@email.pl';
   ```
5. **Project Settings → API** → skopiuj `Project URL` i klucz `anon public` do `js/config.js`.
6. (Kopia nocna) GitHub → repozytorium → **Settings → Secrets → Actions**: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (klucz `service_role`), `BACKUP_PASSPHRASE` (długie hasło — zapisz w menedżerze haseł).

## Pliki

```
index.html, admin.html     strony klienta i barbera
css/app.css                system wizualny (iOS: listy inset, arkusze, karnet)
js/slots.js                logika wolnych terminów (wspólna dla klienta i admina)
js/store-demo.js           magazyn demo z zabezpieczeniami
js/store-supabase.js       magazyn produkcyjny
js/ics.js                  plik kalendarza .ics + link Google Calendar
supabase/schema.sql        baza, reguły bezpieczeństwa, funkcje
.github/workflows/backup.yml  nocna zaszyfrowana kopia
```

Uruchomienie lokalne: dowolny serwer statyczny w tym folderze (np. `npx serve`).
