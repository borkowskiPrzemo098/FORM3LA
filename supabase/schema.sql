-- =====================================================================
-- FORM3LA — schemat bazy Supabase (Postgres)
-- Uruchom raz w: Supabase → SQL Editor → New query → Run.
--
-- Ochrona danych na poziomie BAZY (działa nawet przy błędzie w aplikacji):
--   • DELETE i TRUNCATE na wizytach są zablokowane wyzwalaczem — dla wszystkich ról.
--   • Nakładające się aktywne wizyty są fizycznie niemożliwe (EXCLUDE constraint).
--   • Każda zmiana wizyty i ustawień trafia do dziennika audit_log (tylko dopisywanie).
--   • Klient anonimowy nie widzi cudzych danych: rezerwuje i zarządza tylko przez funkcje RPC.
--   • Wersjonowanie ustawień (config_history) — każdą wersję można przywrócić.
-- =====================================================================

create extension if not exists btree_gist;
create extension if not exists pgcrypto;

-- ---------- Administratorzy ----------
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id)
);
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ---------- Ustawienia (jeden wiersz JSON) ----------
create table if not exists public.app_config (
  id int primary key default 1 check (id = 1),
  data jsonb not null,
  rev int not null default 1,
  updated_at timestamptz not null default now()
);
create table if not exists public.config_history (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor uuid,
  rev int,
  data jsonb not null
);

-- ---------- Wizyty ----------
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default encode(gen_random_bytes(16), 'hex'),
  code text not null,
  service_id text not null,
  service_name text not null,
  price numeric(10,2) not null,
  duration int not null check (duration >= 60),
  day date not null,
  start_min int not null check (start_min between 0 and 1439),
  end_min int not null check (end_min > start_min and end_min <= 1440),
  starts_at timestamptz,
  ends_at timestamptz,
  name text not null check (length(trim(name)) between 1 and 60),
  phone text not null check (length(phone) between 9 and 16),
  note text not null default '' check (length(note) <= 300),
  status text not null default 'confirmed' check (status in ('confirmed','cancelled','done','noshow')),
  source text not null default 'online',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by text
);
create index if not exists bookings_day_idx on public.bookings(day);
create index if not exists bookings_phone_idx on public.bookings(phone);

create or replace function public.bookings_fill() returns trigger language plpgsql as $$
begin
  new.end_min   := new.start_min + new.duration;
  new.starts_at := (new.day + make_interval(mins => new.start_min)) at time zone 'Europe/Warsaw';
  new.ends_at   := (new.day + make_interval(mins => new.end_min))   at time zone 'Europe/Warsaw';
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists bookings_fill on public.bookings;
create trigger bookings_fill before insert or update on public.bookings
  for each row execute function public.bookings_fill();

-- Brak nakładania się aktywnych wizyt — gwarantowane przez bazę.
alter table public.bookings drop constraint if exists bookings_no_overlap;
alter table public.bookings add constraint bookings_no_overlap
  exclude using gist (tstzrange(starts_at, ends_at, '[)') with &&) where (status in ('confirmed','done','noshow'));

-- ---------- Blokada usuwania ----------
create or replace function public.forbid_delete() returns trigger language plpgsql as $$
begin
  raise exception 'FORM3LA: usuwanie danych z tabeli % jest zablokowane. Użyj statusu cancelled.', tg_table_name;
end $$;
drop trigger if exists bookings_no_delete on public.bookings;
create trigger bookings_no_delete before delete on public.bookings for each row execute function public.forbid_delete();
drop trigger if exists bookings_no_truncate on public.bookings;
create trigger bookings_no_truncate before truncate on public.bookings for each statement execute function public.forbid_delete();

-- ---------- Dziennik zmian ----------
create table if not exists public.audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  booking_id uuid,
  before jsonb,
  after jsonb,
  summary text
);
drop trigger if exists audit_no_delete on public.audit_log;
create trigger audit_no_delete before delete or update on public.audit_log for each row execute function public.forbid_delete();
drop trigger if exists audit_no_truncate on public.audit_log;
create trigger audit_no_truncate before truncate on public.audit_log for each statement execute function public.forbid_delete();
drop trigger if exists history_no_delete on public.config_history;
create trigger history_no_delete before delete or update on public.config_history for each row execute function public.forbid_delete();

create or replace function public.bookings_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log(actor, action, booking_id, before, after, summary)
  values (
    coalesce(current_setting('form3la.actor', true), case when public.is_admin() then 'admin' else 'klient' end),
    lower(tg_op), new.id,
    case when tg_op = 'UPDATE' then to_jsonb(old) - 'token' end,
    to_jsonb(new) - 'token',
    coalesce(current_setting('form3la.summary', true), tg_op || ': ' || new.name)
  );
  return new;
end $$;
drop trigger if exists bookings_audit on public.bookings;
create trigger bookings_audit after insert or update on public.bookings
  for each row execute function public.bookings_audit();

create or replace function public.config_version() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.config_history(actor, rev, data) values (auth.uid(), old.rev, old.data);
  new.rev := old.rev + 1;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists config_version on public.app_config;
create trigger config_version before update on public.app_config
  for each row execute function public.config_version();
drop trigger if exists config_no_delete on public.app_config;
create trigger config_no_delete before delete on public.app_config for each row execute function public.forbid_delete();

-- ---------- RLS ----------
alter table public.admins enable row level security;
alter table public.app_config enable row level security;
alter table public.config_history enable row level security;
alter table public.bookings enable row level security;
alter table public.audit_log enable row level security;

drop policy if exists admins_self on public.admins;
create policy admins_self on public.admins for select using (user_id = auth.uid());

drop policy if exists config_read on public.app_config;
create policy config_read on public.app_config for select using (true);
drop policy if exists config_write on public.app_config;
create policy config_write on public.app_config for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists history_read on public.config_history;
create policy history_read on public.config_history for select using (public.is_admin());

drop policy if exists bookings_admin_read on public.bookings;
create policy bookings_admin_read on public.bookings for select using (public.is_admin());
drop policy if exists bookings_admin_insert on public.bookings;
create policy bookings_admin_insert on public.bookings for insert with check (public.is_admin());
drop policy if exists bookings_admin_update on public.bookings;
create policy bookings_admin_update on public.bookings for update using (public.is_admin()) with check (public.is_admin());
-- celowo BRAK polityki DELETE

drop policy if exists audit_admin_read on public.audit_log;
create policy audit_admin_read on public.audit_log for select using (public.is_admin());

revoke delete, truncate on public.bookings, public.audit_log, public.config_history, public.app_config from anon, authenticated;

-- ---------- Walidacja terminu (lustro js/slots.js) ----------
create or replace function public.slot_problem(p_day date, p_start int, p_duration int, p_exclude uuid, p_client boolean)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  cfg jsonb := (select data from public.app_config where id = 1);
  s jsonb := cfg->'settings';
  ex jsonb;
  h jsonb;
  o_start int; o_end int; b_start int; b_end int;
  v_end int := p_start + p_duration;
  buf int := coalesce((s->>'bufferMin')::int, 0);
  at_ts timestamptz := (p_day + make_interval(mins => p_start)) at time zone 'Europe/Warsaw';
begin
  if p_duration < 60 then return 'Nieprawidłowy czas wizyty.'; end if;
  select e into ex from jsonb_array_elements(coalesce(cfg->'exceptions','[]'::jsonb)) e
    where p_day between (e->>'from')::date and coalesce(nullif(e->>'to','')::date, (e->>'from')::date) limit 1;
  if ex is not null then
    if ex->>'type' = 'closed' then return 'Ten dzień jest wolny.'; end if;
    o_start := split_part(ex->>'start',':',1)::int*60 + split_part(ex->>'start',':',2)::int;
    o_end   := split_part(ex->>'end',':',1)::int*60 + split_part(ex->>'end',':',2)::int;
  else
    h := cfg->'hours'->(extract(dow from p_day)::int::text);
    if h is null or not (h->>'open')::boolean then return 'Ten dzień jest wolny.'; end if;
    o_start := split_part(h->>'start',':',1)::int*60 + split_part(h->>'start',':',2)::int;
    o_end   := split_part(h->>'end',':',1)::int*60 + split_part(h->>'end',':',2)::int;
    if coalesce(h->>'breakStart','') <> '' and coalesce(h->>'breakEnd','') <> '' then
      b_start := split_part(h->>'breakStart',':',1)::int*60 + split_part(h->>'breakStart',':',2)::int;
      b_end   := split_part(h->>'breakEnd',':',1)::int*60 + split_part(h->>'breakEnd',':',2)::int;
      if p_start < b_end and b_start < v_end then return 'Koliduje z przerwą.'; end if;
    end if;
  end if;
  if p_start < o_start or v_end > o_end then return 'Poza godzinami pracy.'; end if;
  if exists (select 1 from public.bookings b where b.day = p_day and b.status in ('confirmed','done','noshow')
             and (p_exclude is null or b.id <> p_exclude)
             and p_start < b.end_min + buf and b.start_min - buf < v_end) then
    return 'Ten termin jest już zajęty.';
  end if;
  if p_client then
    if at_ts < now() + make_interval(mins => coalesce((s->>'leadMin')::int, 0)) then return 'Za krótki czas do wizyty.'; end if;
    if p_day > (now() at time zone 'Europe/Warsaw')::date + coalesce((s->>'horizonDays')::int, 30) then return 'Za daleki termin.'; end if;
  end if;
  return null;
end $$;

-- ---------- API klienta (anon) ----------
create or replace function public.public_busy(p_from date, p_to date)
returns table(day date, start_min int, end_min int)
language sql stable security definer set search_path = public as $$
  select day, start_min, end_min from public.bookings
  where day between p_from and least(p_to, p_from + 62) and status in ('confirmed','done','noshow');
$$;

create or replace function public.create_booking(p_service_id text, p_day date, p_start int, p_name text, p_phone text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb := (select data from public.app_config where id = 1);
  svc jsonb;
  problem text;
  b public.bookings;
  v_phone text := regexp_replace(coalesce(p_phone,''), '[^0-9+]', '', 'g');
begin
  select e into svc from jsonb_array_elements(cfg->'services') e where e->>'id' = p_service_id and (e->>'active')::boolean limit 1;
  if svc is null then raise exception 'Ta usługa nie jest już dostępna.'; end if;
  if length(trim(coalesce(p_name,''))) = 0 then raise exception 'Podaj imię.'; end if;
  if (select count(*) from public.bookings where phone = v_phone and status = 'confirmed' and ends_at > now())
     >= coalesce((cfg->'settings'->>'maxPerPhone')::int, 3) then
    raise exception 'Masz już zaplanowane wizyty — odwołaj którąś, aby zarezerwować kolejną.';
  end if;
  perform pg_advisory_xact_lock(hashtext('form3la:' || p_day::text));
  problem := public.slot_problem(p_day, p_start, (svc->>'duration')::int, null, true);
  if problem is not null then raise exception '%', problem; end if;
  perform set_config('form3la.actor', 'klient', true);
  perform set_config('form3la.summary', 'Nowa rezerwacja: ' || trim(p_name) || ', ' || (svc->>'name'), true);
  insert into public.bookings(code, service_id, service_name, price, duration, day, start_min, end_min, name, phone, note, source)
  values (upper(substr(encode(gen_random_bytes(6),'hex'),1,6)), svc->>'id', svc->>'name', (svc->>'price')::numeric,
          (svc->>'duration')::int, p_day, p_start, p_start + (svc->>'duration')::int,
          left(trim(p_name), 60), v_phone, left(coalesce(p_note,''), 300), 'online')
  returning * into b;
  return to_jsonb(b);
end $$;

create or replace function public.get_booking(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(b) from public.bookings b where b.token = p_token;
$$;

create or replace function public.cancel_booking(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.bookings; hrs int := coalesce(((select data from public.app_config where id=1)->'settings'->>'cancelHours')::int, 12);
begin
  select * into b from public.bookings where token = p_token for update;
  if b.id is null or b.status <> 'confirmed' then raise exception 'Ta wizyta nie jest już aktywna.'; end if;
  if b.starts_at - now() < make_interval(hours => hrs) then
    raise exception 'Odwołać online można najpóźniej % h przed wizytą. Zadzwoń do salonu.', hrs;
  end if;
  perform set_config('form3la.actor', 'klient', true);
  perform set_config('form3la.summary', 'Klient odwołał: ' || b.name, true);
  update public.bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = 'klient' where id = b.id returning * into b;
  return to_jsonb(b);
end $$;

create or replace function public.reschedule_booking(p_token text, p_day date, p_start int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.bookings; problem text; hrs int := coalesce(((select data from public.app_config where id=1)->'settings'->>'cancelHours')::int, 12);
begin
  select * into b from public.bookings where token = p_token for update;
  if b.id is null or b.status <> 'confirmed' then raise exception 'Ta wizyta nie jest już aktywna.'; end if;
  if b.starts_at - now() < make_interval(hours => hrs) then
    raise exception 'Przełożyć online można najpóźniej % h przed wizytą.', hrs;
  end if;
  perform pg_advisory_xact_lock(hashtext('form3la:' || p_day::text));
  problem := public.slot_problem(p_day, p_start, b.duration, b.id, true);
  if problem is not null then raise exception '%', problem; end if;
  perform set_config('form3la.actor', 'klient', true);
  perform set_config('form3la.summary', 'Klient przełożył: ' || b.name, true);
  update public.bookings set day = p_day, start_min = p_start where id = b.id returning * into b;
  return to_jsonb(b);
end $$;

grant execute on function public.public_busy(date, date), public.create_booking(text, date, int, text, text, text),
  public.get_booking(text), public.cancel_booking(text), public.reschedule_booking(text, date, int) to anon, authenticated;
grant execute on function public.slot_problem(date, int, int, uuid, boolean) to authenticated;

-- ---------- Dane startowe ustawień ----------
insert into public.app_config(id, data) values (1, '{
  "salon": {"name":"FORM3LA","tagline":"Barbershop","address":"ul. Przykładowa 12, Warszawa","phone":"+48500000000","mapsUrl":"https://maps.google.com/?q=Warszawa","instagram":""},
  "settings": {"stepMin":30,"bufferMin":0,"leadMin":120,"horizonDays":30,"cancelHours":12,"maxPerPhone":3},
  "services": [
    {"id":"srv-cut","name":"Strzyżenie męskie","desc":"Konsultacja, mycie, strzyżenie nożyczkami i maszynką, stylizacja.","duration":60,"price":90,"active":true},
    {"id":"srv-combo","name":"Strzyżenie + broda","desc":"Pełny pakiet: włosy i broda, gorący ręcznik na koniec.","duration":90,"price":140,"active":true},
    {"id":"srv-beard","name":"Broda","desc":"Trymowanie, konturowanie brzytwą, olejek.","duration":60,"price":70,"active":true},
    {"id":"srv-shave","name":"Golenie brzytwą","desc":"Klasyczne golenie z gorącym ręcznikiem.","duration":60,"price":80,"active":true},
    {"id":"srv-buzz","name":"Strzyżenie maszynką","desc":"Jedna długość na całej głowie, wykończenie konturów.","duration":60,"price":60,"active":true},
    {"id":"srv-kid","name":"Strzyżenie dziecięce","desc":"Dla dzieci do 12 lat.","duration":60,"price":60,"active":true},
    {"id":"srv-duo","name":"Ojciec + syn","desc":"Dwa strzyżenia jedno po drugim.","duration":120,"price":150,"active":true}
  ],
  "hours": {
    "0":{"open":false,"start":"10:00","end":"16:00","breakStart":"","breakEnd":""},
    "1":{"open":true,"start":"10:00","end":"18:00","breakStart":"14:00","breakEnd":"14:30"},
    "2":{"open":true,"start":"10:00","end":"19:00","breakStart":"14:00","breakEnd":"14:30"},
    "3":{"open":true,"start":"10:00","end":"19:00","breakStart":"14:00","breakEnd":"14:30"},
    "4":{"open":true,"start":"10:00","end":"19:00","breakStart":"14:00","breakEnd":"14:30"},
    "5":{"open":true,"start":"10:00","end":"19:00","breakStart":"14:00","breakEnd":"14:30"},
    "6":{"open":true,"start":"09:00","end":"15:00","breakStart":"","breakEnd":""}
  },
  "exceptions": []
}'::jsonb) on conflict (id) do nothing;

-- ---------- Na koniec: nadaj sobie rolę admina ----------
-- 1) Supabase → Authentication → Users → Add user (Twój e-mail + hasło).
-- 2) Uruchom (podmień e-mail):
-- insert into public.admins(user_id) select id from auth.users where email = 'twoj@email.pl';
