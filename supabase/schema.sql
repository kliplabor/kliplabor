-- =====================================================================
-- KlipLabor – adatbázis séma (Supabase / PostgreSQL 15+)
--
-- Hogyan használd: Supabase → SQL Editor → New query → másold be az
-- egész fájlt → Run. Egyszer kell lefuttatni. Ha véletlenül még egyszer
-- lefut, az sem baj: a táblákat nem törli, a szabályokat újra beállítja.
--
-- Biztonság: a weboldal csak a nyilvános (publishable) kulccsal
-- dolgozik, ezért minden védelmet a Row Level Security (RLS) szabályok
-- és a jogosultságok adnak. A secret / service_role kulcsot soha ne
-- tedd a weboldalba, és ne add oda senkinek.
--
-- Bankszámlaszámot, lakcímet, adóazonosítót ez a rendszer szándékosan
-- NEM tárol. Ezeket privát úton kéred be.
-- =====================================================================

-- Belső segédfüggvények saját sémában, hogy ne legyenek az API-n
-- keresztül hívhatók (a "public" séma függvényei RPC-ként elérhetők).
create schema if not exists kl_private;
revoke all on schema kl_private from public;
grant usage on schema kl_private to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 1. Táblák
-- ---------------------------------------------------------------------

create table if not exists public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  role              text not null default 'clipper' check (role in ('clipper', 'admin')),
  full_name         text check (full_name is null or char_length(full_name) <= 120),
  tiktok_url        text check (tiktok_url is null or (tiktok_url ~ '^https://[^[:space:]]+$' and char_length(tiktok_url) <= 300)),
  instagram_url     text check (instagram_url is null or (instagram_url ~ '^https://[^[:space:]]+$' and char_length(instagram_url) <= 300)),
  youtube_url       text check (youtube_url is null or (youtube_url ~ '^https://[^[:space:]]+$' and char_length(youtube_url) <= 300)),
  -- Csak a bankszámla TULAJDONOSÁNAK neve. Számlaszám sehol nincs a rendszerben.
  payout_name       text check (payout_name is null or char_length(payout_name) <= 120),
  adult_confirmed   boolean not null default false,
  rules_accepted_at timestamptz,
  created_at        timestamptz not null default now()
);

create table if not exists public.app_settings (
  id              boolean primary key default true check (id),   -- mindig csak egy sor
  viral_bonus     integer not null default 5000   check (viral_bonus >= 0),
  viral_threshold integer not null default 100000 check (viral_threshold > 0),
  updated_at      timestamptz not null default now()
);
insert into public.app_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.streamer_applications (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null check (char_length(btrim(name)) between 2 and 120),
  channel_url text not null check (channel_url ~* '^https?://[^[:space:]]+$' and char_length(channel_url) <= 300),
  email       text not null check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and char_length(email) <= 254),
  budget_band text not null check (budget_band in ('proba', '50_100', '100_250', '250_500', '500_felett', 'nem_tudom')),
  message     text check (message is null or char_length(message) <= 2000),
  consent     boolean not null check (consent),                  -- elfogadta az adatkezelési tájékoztatót
  status      text not null default 'uj' check (status in ('uj', 'kapcsolat', 'elfogadva', 'elutasitva')),
  admin_note  text check (admin_note is null or char_length(admin_note) <= 2000)
);

create table if not exists public.campaigns (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  title            text not null check (char_length(btrim(title)) between 2 and 120),
  creator_name     text not null check (char_length(btrim(creator_name)) between 1 and 120),
  creator_platform text check (creator_platform is null or char_length(creator_platform) <= 60),
  description      text check (description is null or char_length(description) <= 5000),
  rules            text check (rules is null or char_length(rules) <= 10000),
  clipper_rate     integer not null default 150   check (clipper_rate >= 0),    -- Ft / 1000 megtekintés a clippernek
  creator_rate     integer not null default 300   check (creator_rate >= 0),    -- Ft / 1000 megtekintés a tartalomgyártónak
  management_fee   integer          default 30000 check (management_fee is null or management_fee >= 0),
  budget           integer not null check (budget > 0),                         -- megtekintési keret, Ft
  starts_on        date,
  ends_on          date,
  status           text not null default 'aktiv' check (status in ('aktiv', 'szunetel', 'lezart')),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create table if not exists public.campaign_members (
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  clipper_id  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  joined_at   timestamptz not null default now(),
  primary key (campaign_id, clipper_id)
);

create table if not exists public.clips (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  campaign_id    uuid not null references public.campaigns (id) on delete restrict,
  clipper_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  platform       text not null check (platform in ('tiktok', 'instagram', 'youtube')),
  post_url       text not null unique check (post_url ~ '^https://[^[:space:]]+$' and char_length(post_url) <= 500),
  status         text not null default 'bekuldve' check (status in ('bekuldve', 'jovahagyva', 'elutasitva')),
  verified_views integer not null default 0 check (verified_views >= 0),
  reject_reason  text check (reject_reason is null or char_length(reject_reason) <= 1000),
  reviewed_at    timestamptz,
  -- a link domainje illeszkedjen a platformhoz
  check (
       (platform = 'tiktok'    and post_url ~* '^https://([a-z0-9-]+\.)*tiktok\.com/')
    or (platform = 'instagram' and post_url ~* '^https://([a-z0-9-]+\.)*instagram\.com/')
    or (platform = 'youtube'   and post_url ~* '^https://(([a-z0-9-]+\.)*youtube\.com|youtu\.be)/')
  )
);
create index if not exists clips_clipper_idx  on public.clips (clipper_id);
create index if not exists clips_campaign_idx on public.clips (campaign_id);

create table if not exists public.clip_stats (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  clip_id         uuid not null references public.clips (id) on delete cascade,
  views           integer not null check (views >= 0),
  screenshot_path text not null check (char_length(screenshot_path) <= 300)
);
create index if not exists clip_stats_clip_idx on public.clip_stats (clip_id);

create table if not exists public.payouts (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  clipper_id   uuid not null references public.profiles (id) on delete restrict,
  amount       integer not null check (amount > 0),
  period_label text check (period_label is null or char_length(period_label) <= 120),
  note         text check (note is null or char_length(note) <= 1000),
  paid_at      date not null default current_date
);
create index if not exists payouts_clipper_idx on public.payouts (clipper_id);

-- ---------------------------------------------------------------------
-- 2. Segédfüggvények
-- ---------------------------------------------------------------------

-- Admin-e a bejelentkezett felhasználó. SECURITY DEFINER, így a profiles
-- tábla RLS szabályai nem hívják meg önmagukat (nincs rekurzió).
create or replace function kl_private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;
revoke all on function kl_private.is_admin() from public;
grant execute on function kl_private.is_admin() to anon, authenticated, service_role;

-- Tagja-e a bejelentkezett felhasználó a kampánynak (RLS-ben használjuk,
-- definer jogon, hogy a táblák szabályai ne hivatkozzanak körbe egymásra).
create or replace function kl_private.is_member(p_campaign uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.campaign_members m
    where m.campaign_id = p_campaign and m.clipper_id = auth.uid()
  );
$$;
revoke all on function kl_private.is_member(uuid) from public;
grant execute on function kl_private.is_member(uuid) to authenticated, service_role;

-- Van-e a bejelentkezett felhasználónak klipje a kampányban.
create or replace function kl_private.has_clip_in(p_campaign uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clips c
    where c.campaign_id = p_campaign and c.clipper_id = auth.uid()
  );
$$;
revoke all on function kl_private.has_clip_in(uuid) from public;
grant execute on function kl_private.has_clip_in(uuid) to authenticated, service_role;

create or replace function kl_private.campaign_is_active(p_campaign uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.campaigns c where c.id = p_campaign and c.status = 'aktiv');
$$;
revoke all on function kl_private.campaign_is_active(uuid) from public;
grant execute on function kl_private.campaign_is_active(uuid) to authenticated, service_role;

-- A felhasználó a saját profilja szerint jelentkezhet-e kampányra.
create or replace function kl_private.can_participate()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.adult_confirmed and p.rules_accepted_at is not null
  );
$$;
revoke all on function kl_private.can_participate() from public;
grant execute on function kl_private.can_participate() to authenticated, service_role;

-- Igaz, ha a hívás a weboldalról / API-ról jön (bejelentkezett vagy
-- névtelen felhasználó), és nem az SQL Editorból.
create or replace function kl_private.is_api_call()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user in ('anon', 'authenticated');
$$;
revoke all on function kl_private.is_api_call() from public;
grant execute on function kl_private.is_api_call() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. Triggerek
-- ---------------------------------------------------------------------

-- Regisztrációkor profil létrehozása a regisztrációs adatokból.
create or replace function kl_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, full_name, adult_confirmed, rules_accepted_at)
  values (
    new.id,
    nullif(left(btrim(coalesce(meta ->> 'full_name', '')), 120), ''),
    coalesce(meta ->> 'adult_confirmed', '') = 'true',
    case when coalesce(meta ->> 'rules_accepted', '') = 'true' then now() else null end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function kl_private.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function kl_private.handle_new_user();

-- Profil védelme: a szerepkört (role), a 18+ nyilatkozatot és a szabályzat
-- elfogadását a weboldalról senki nem írhatja át – a saját szerepkörét
-- az admin sem. Szerepkört csak az SQL Editorból lehet módosítani.
create or replace function kl_private.protect_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if kl_private.is_api_call() then
    if new.role is distinct from old.role then
      raise exception 'A szerepkört nem lehet módosítani.' using errcode = '42501';
    end if;
    if new.id is distinct from old.id
       or new.created_at is distinct from old.created_at
       or new.adult_confirmed is distinct from old.adult_confirmed
       or new.rules_accepted_at is distinct from old.rules_accepted_at then
      raise exception 'Ez a mező nem módosítható.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function kl_private.protect_profile() from public, anon, authenticated;

drop trigger if exists protect_profile on public.profiles;
create trigger protect_profile
  before update on public.profiles
  for each row execute function kl_private.protect_profile();

-- Klip beküldésekor a clipper nem állíthatja be az állapotot, a
-- megtekintést és az elutasítás okát; ezeket mindig alaphelyzetbe tesszük.
-- Módosítani csak admin tud (és ő is csak ezeket a mezőket).
create or replace function kl_private.guard_clip()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if kl_private.is_api_call() then
      new.status := 'bekuldve';
      new.verified_views := 0;
      new.reject_reason := null;
      new.reviewed_at := null;
      new.created_at := now();
      if new.clipper_id is null then
        new.clipper_id := auth.uid();
      elsif new.clipper_id is distinct from auth.uid() then
        raise exception 'Klipet csak a saját nevedre küldhetsz be.' using errcode = '42501';
      end if;
    end if;
  elsif tg_op = 'UPDATE' then
    if kl_private.is_api_call() then
      if not kl_private.is_admin() then
        raise exception 'Klipet csak admin módosíthat.' using errcode = '42501';
      end if;
      if new.id is distinct from old.id
         or new.clipper_id is distinct from old.clipper_id
         or new.campaign_id is distinct from old.campaign_id
         or new.platform is distinct from old.platform
         or new.post_url is distinct from old.post_url
         or new.created_at is distinct from old.created_at then
        raise exception 'Ez a mező nem módosítható.' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function kl_private.guard_clip() from public, anon, authenticated;

drop trigger if exists guard_clip on public.clips;
create trigger guard_clip
  before insert or update on public.clips
  for each row execute function kl_private.guard_clip();

-- ---------------------------------------------------------------------
-- 4. Row Level Security – minden táblán bekapcsolva
-- ---------------------------------------------------------------------

alter table public.profiles              enable row level security;
alter table public.app_settings          enable row level security;
alter table public.streamer_applications enable row level security;
alter table public.campaigns             enable row level security;
alter table public.campaign_members      enable row level security;
alter table public.clips                 enable row level security;
alter table public.clip_stats            enable row level security;
alter table public.payouts               enable row level security;

-- Az alapértelmezett (túl bő) jogosultságok visszavonása, majd csak a
-- ténylegesen használt műveletek engedélyezése.
revoke all on public.profiles, public.app_settings, public.streamer_applications,
              public.campaigns, public.campaign_members, public.clips,
              public.clip_stats, public.payouts
  from anon, authenticated;

-- profiles --------------------------------------------------------------
grant select on public.profiles to authenticated;
grant update (full_name, tiktok_url, instagram_url, youtube_url, payout_name)
  on public.profiles to authenticated;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or kl_private.is_admin());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid() or kl_private.is_admin())
  with check (id = auth.uid() or kl_private.is_admin());

-- app_settings ------------------------------------------------------------
grant select on public.app_settings to authenticated;
grant update (viral_bonus, viral_threshold, updated_at) on public.app_settings to authenticated;

drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings
  for select to authenticated using (true);

drop policy if exists app_settings_update on public.app_settings;
create policy app_settings_update on public.app_settings
  for update to authenticated
  using (kl_private.is_admin()) with check (kl_private.is_admin());

-- streamer_applications ---------------------------------------------------
-- Bárki (bejelentkezés nélkül is) beküldhet jelentkezést, de csak ezeket
-- a mezőket töltheti; olvasni, módosítani, törölni csak admin tud.
grant insert (name, channel_url, email, budget_band, message, consent)
  on public.streamer_applications to anon, authenticated;
grant select, delete on public.streamer_applications to authenticated;
grant update (status, admin_note) on public.streamer_applications to authenticated;

drop policy if exists streamer_app_insert on public.streamer_applications;
create policy streamer_app_insert on public.streamer_applications
  for insert to anon, authenticated
  with check (status = 'uj' and admin_note is null and consent);

drop policy if exists streamer_app_select on public.streamer_applications;
create policy streamer_app_select on public.streamer_applications
  for select to authenticated using (kl_private.is_admin());

drop policy if exists streamer_app_update on public.streamer_applications;
create policy streamer_app_update on public.streamer_applications
  for update to authenticated
  using (kl_private.is_admin()) with check (kl_private.is_admin());

drop policy if exists streamer_app_delete on public.streamer_applications;
create policy streamer_app_delete on public.streamer_applications
  for delete to authenticated using (kl_private.is_admin());

-- campaigns -----------------------------------------------------------------
grant select, insert, update, delete on public.campaigns to authenticated;

drop policy if exists campaigns_select on public.campaigns;
create policy campaigns_select on public.campaigns
  for select to authenticated
  using (
    status = 'aktiv'
    or kl_private.is_admin()
    or kl_private.is_member(id)
    or kl_private.has_clip_in(id)
  );

drop policy if exists campaigns_admin_insert on public.campaigns;
create policy campaigns_admin_insert on public.campaigns
  for insert to authenticated with check (kl_private.is_admin());

drop policy if exists campaigns_admin_update on public.campaigns;
create policy campaigns_admin_update on public.campaigns
  for update to authenticated
  using (kl_private.is_admin()) with check (kl_private.is_admin());

drop policy if exists campaigns_admin_delete on public.campaigns;
create policy campaigns_admin_delete on public.campaigns
  for delete to authenticated using (kl_private.is_admin());

-- campaign_members --------------------------------------------------------
grant select, delete on public.campaign_members to authenticated;
grant insert (campaign_id, clipper_id) on public.campaign_members to authenticated;

drop policy if exists members_select on public.campaign_members;
create policy members_select on public.campaign_members
  for select to authenticated
  using (clipper_id = auth.uid() or kl_private.is_admin());

-- Csak saját magát, csak aktív kampányba, és csak ha 18+ és elfogadta a szabályzatot.
drop policy if exists members_insert_self on public.campaign_members;
create policy members_insert_self on public.campaign_members
  for insert to authenticated
  with check (
    clipper_id = auth.uid()
    and kl_private.campaign_is_active(campaign_id)
    and kl_private.can_participate()
  );

drop policy if exists members_admin_delete on public.campaign_members;
create policy members_admin_delete on public.campaign_members
  for delete to authenticated using (kl_private.is_admin());

-- clips -------------------------------------------------------------------
grant select on public.clips to authenticated;
grant insert (campaign_id, clipper_id, platform, post_url) on public.clips to authenticated;
grant update (status, verified_views, reject_reason, reviewed_at) on public.clips to authenticated;
grant delete on public.clips to authenticated;

drop policy if exists clips_select on public.clips;
create policy clips_select on public.clips
  for select to authenticated
  using (clipper_id = auth.uid() or kl_private.is_admin());

-- Csak saját névre, csak olyan aktív kampányba, aminek tagja.
drop policy if exists clips_insert_own on public.clips;
create policy clips_insert_own on public.clips
  for insert to authenticated
  with check (
    clipper_id = auth.uid()
    and status = 'bekuldve'
    and verified_views = 0
    and reject_reason is null
    and kl_private.is_member(campaign_id)
    and kl_private.campaign_is_active(campaign_id)
  );

drop policy if exists clips_admin_update on public.clips;
create policy clips_admin_update on public.clips
  for update to authenticated
  using (kl_private.is_admin()) with check (kl_private.is_admin());

drop policy if exists clips_admin_delete on public.clips;
create policy clips_admin_delete on public.clips
  for delete to authenticated using (kl_private.is_admin());

-- clip_stats --------------------------------------------------------------
grant select on public.clip_stats to authenticated;
grant insert (clip_id, views, screenshot_path) on public.clip_stats to authenticated;
grant delete on public.clip_stats to authenticated;

drop policy if exists clip_stats_select on public.clip_stats;
create policy clip_stats_select on public.clip_stats
  for select to authenticated
  using (
    kl_private.is_admin()
    or exists (select 1 from public.clips c where c.id = clip_id and c.clipper_id = auth.uid())
  );

-- Csak saját klipjéhez, és a képernyőkép útvonala a saját mappájára mutasson:
-- {felhasználó azonosító}/{klip azonosító}/...
drop policy if exists clip_stats_insert_own on public.clip_stats;
create policy clip_stats_insert_own on public.clip_stats
  for insert to authenticated
  with check (
    exists (select 1 from public.clips c where c.id = clip_id and c.clipper_id = auth.uid())
    and screenshot_path like (auth.uid()::text || '/' || clip_id::text || '/%')
    and screenshot_path !~ '\.\.'
  );

drop policy if exists clip_stats_admin_delete on public.clip_stats;
create policy clip_stats_admin_delete on public.clip_stats
  for delete to authenticated using (kl_private.is_admin());

-- payouts -------------------------------------------------------------------
grant select, insert, update, delete on public.payouts to authenticated;

drop policy if exists payouts_select on public.payouts;
create policy payouts_select on public.payouts
  for select to authenticated
  using (clipper_id = auth.uid() or kl_private.is_admin());

drop policy if exists payouts_admin_insert on public.payouts;
create policy payouts_admin_insert on public.payouts
  for insert to authenticated with check (kl_private.is_admin());

drop policy if exists payouts_admin_update on public.payouts;
create policy payouts_admin_update on public.payouts
  for update to authenticated
  using (kl_private.is_admin()) with check (kl_private.is_admin());

drop policy if exists payouts_admin_delete on public.payouts;
create policy payouts_admin_delete on public.payouts
  for delete to authenticated using (kl_private.is_admin());

-- ---------------------------------------------------------------------
-- 5. Szabályzat elfogadása utólag (ha valaki a regisztrációnál nem
--    tudta megtenni, vagy új szabályzatverziót kell elfogadni).
-- ---------------------------------------------------------------------
create or replace function public.accept_rules()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Bejelentkezés szükséges.' using errcode = '42501';
  end if;
  -- Definer jogon fut, ezért a profilvédő trigger engedi; csak a saját
  -- sorát és csak ezt a két mezőt módosítja.
  update public.profiles
     set adult_confirmed = true,
         rules_accepted_at = now()
   where id = auth.uid();
end;
$$;
revoke all on function public.accept_rules() from public, anon;
grant execute on function public.accept_rules() to authenticated;

-- ---------------------------------------------------------------------
-- 6. Nézetek (security_invoker = true → a hívó RLS szabályai érvényesek)
-- ---------------------------------------------------------------------

-- Klipenkénti kereset. Csak jóváhagyott klip után jár pénz.
-- Alap: lefelé kerekítve forintra; bónusz: klipenként egyszer, ha a
-- hitelesített megtekintés eléri a határt.
create or replace view public.clip_earnings
with (security_invoker = true) as
select
  c.id                                    as clip_id,
  c.clipper_id,
  c.campaign_id,
  c.platform,
  c.status,
  c.verified_views,
  cp.clipper_rate,
  case when c.status = 'jovahagyva'
       then floor(c.verified_views * cp.clipper_rate / 1000.0)::integer else 0 end as base_amount,
  case when c.status = 'jovahagyva' and c.verified_views >= s.viral_threshold
       then s.viral_bonus else 0 end                                               as bonus_amount,
  (case when c.status = 'jovahagyva'
        then floor(c.verified_views * cp.clipper_rate / 1000.0)::integer else 0 end
   + case when c.status = 'jovahagyva' and c.verified_views >= s.viral_threshold
          then s.viral_bonus else 0 end)                                           as total_amount
from public.clips c
join public.campaigns cp on cp.id = c.campaign_id
cross join public.app_settings s;

-- Clipperenkénti egyenleg: megkeresett, kifizetett, kifizetésre vár.
create or replace view public.clipper_balances
with (security_invoker = true) as
select
  p.id                                              as clipper_id,
  p.full_name,
  coalesce(e.approved_views, 0)::bigint             as approved_views,
  coalesce(e.approved_clips, 0)::bigint             as approved_clips,
  coalesce(e.earned, 0)::bigint                     as earned,
  coalesce(pa.paid, 0)::bigint                      as paid,
  (coalesce(e.earned, 0) - coalesce(pa.paid, 0))::bigint as owed
from public.profiles p
left join (
  select clipper_id,
         sum(verified_views) filter (where status = 'jovahagyva') as approved_views,
         count(*)            filter (where status = 'jovahagyva') as approved_clips,
         sum(total_amount)                                         as earned
  from public.clip_earnings
  group by clipper_id
) e on e.clipper_id = p.id
left join (
  select clipper_id, sum(amount) as paid
  from public.payouts
  group by clipper_id
) pa on pa.clipper_id = p.id;

-- Kampányok pénzügyi állása – csak adminnak (a WHERE feltétel miatt
-- mindenki más üres eredményt kap).
create or replace view public.campaign_usage
with (security_invoker = true) as
select
  cp.id                                                            as campaign_id,
  cp.title,
  cp.creator_name,
  cp.status,
  cp.budget,
  cp.creator_rate,
  cp.clipper_rate,
  coalesce(cp.management_fee, 0)                                   as management_fee,
  coalesce(x.approved_clips, 0)::bigint                            as approved_clips,
  coalesce(x.pending_clips, 0)::bigint                             as pending_clips,
  coalesce(x.verified_views, 0)::bigint                            as verified_views,
  floor(coalesce(x.verified_views, 0) * cp.creator_rate / 1000.0)::bigint as used_budget,
  least(floor(coalesce(x.verified_views, 0) * cp.creator_rate / 1000.0), cp.budget)::bigint as billable_budget,
  (cp.budget - floor(coalesce(x.verified_views, 0) * cp.creator_rate / 1000.0))::bigint      as remaining_budget,
  coalesce(x.clipper_cost, 0)::bigint                              as clipper_cost,
  (least(floor(coalesce(x.verified_views, 0) * cp.creator_rate / 1000.0), cp.budget)
     + coalesce(cp.management_fee, 0) - coalesce(x.clipper_cost, 0))::bigint as margin
from public.campaigns cp
left join (
  select e.campaign_id,
         count(*)            filter (where e.status = 'jovahagyva') as approved_clips,
         count(*)            filter (where e.status = 'bekuldve')   as pending_clips,
         sum(e.verified_views) filter (where e.status = 'jovahagyva') as verified_views,
         sum(e.total_amount)                                         as clipper_cost
  from public.clip_earnings e
  group by e.campaign_id
) x on x.campaign_id = cp.id
where kl_private.is_admin();

revoke all on public.clip_earnings, public.clipper_balances, public.campaign_usage from anon, authenticated;
grant select on public.clip_earnings, public.clipper_balances, public.campaign_usage to authenticated;

-- ---------------------------------------------------------------------
-- 7. Tárhely: privát "screenshots" bucket a heti statisztika képeinek
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('screenshots', 'screenshots', false, 5242880,
        array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Feltölteni csak a saját mappába lehet: screenshots/{felhasználó azonosító}/...
drop policy if exists kl_screenshots_insert_own on storage.objects;
create policy kl_screenshots_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
    and lower(name) ~ '\.(png|jpe?g|webp)$'
  );

-- Olvasni a sajátját lehet, az admin mindent.
drop policy if exists kl_screenshots_select on storage.objects;
create policy kl_screenshots_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'screenshots'
    and ((storage.foldername(name))[1] = auth.uid()::text or kl_private.is_admin())
  );

-- Törölni csak admin tud (a beküldött bizonyíték ne tűnjön el).
drop policy if exists kl_screenshots_admin_delete on storage.objects;
create policy kl_screenshots_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'screenshots' and kl_private.is_admin());

-- ---------------------------------------------------------------------
-- 8. Admin jog beállítása – a SAJÁT regisztrációd UTÁN futtasd,
--    a saját e-mail címeddel (vedd ki elöle a két kötőjelet):
-- ---------------------------------------------------------------------
-- update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'IDE@AZ-EMAILED.hu');
