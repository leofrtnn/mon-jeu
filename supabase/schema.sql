-- =====================================================================
-- Coach de Poche — base de données Supabase
-- À coller UNE FOIS dans Supabase → SQL Editor → New query → Run.
-- (Relançable sans risque : tout est en « if not exists » / « or replace ».)
-- =====================================================================

-- ---------- Profils (pseudo public de chaque compte) ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_username_lower on public.profiles (lower(username));

-- Création automatique du profil à l'inscription (pseudo passé dans les métadonnées).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, coalesce(nullif(new.raw_user_meta_data ->> 'username', ''), split_part(new.email, '@', 1)));
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Sauvegardes de carrière solo (copie cloud, 3 emplacements) ----------
create table if not exists public.saves (
  user_id uuid not null references auth.users (id) on delete cascade,
  slot int not null check (slot between 1 and 3),
  meta jsonb,
  data text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, slot)
);

-- ---------- Carrières en ligne ----------
create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  host uuid not null references auth.users (id) on delete cascade,
  max_players int not null default 4 check (max_players between 2 and 8),
  status text not null default 'lobby' check (status in ('lobby', 'running', 'ended')),
  version int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.game_players (
  game_id uuid not null references public.games (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  username text not null,
  club_id int,
  ready boolean not null default false,
  version int not null default 0,
  slice text,
  joined_at timestamptz not null default now(),
  primary key (game_id, user_id)
);
create unique index if not exists game_players_one_club on public.game_players (game_id, club_id) where club_id is not null;

-- Appartenance à une partie (fonction « security definer » : évite la récursion des règles RLS).
create or replace function public.is_member(g uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.game_players where game_id = g and user_id = auth.uid());
$$;
create or replace function public.is_host(g uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.games where id = g and host = auth.uid());
$$;

-- ---------- Règles d'accès (RLS) ----------
alter table public.profiles enable row level security;
alter table public.saves enable row level security;
alter table public.games enable row level security;
alter table public.game_players enable row level security;

drop policy if exists "profils lisibles" on public.profiles;
create policy "profils lisibles" on public.profiles for select to anon, authenticated using (true); -- pseudos publics (vérifier qu'un pseudo est libre)
drop policy if exists "mon profil" on public.profiles;
create policy "mon profil" on public.profiles for update to authenticated using (id = auth.uid());

drop policy if exists "mes sauvegardes" on public.saves;
create policy "mes sauvegardes" on public.saves for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Une partie est visible par tout compte connecté (pour la rejoindre avec son code).
drop policy if exists "parties lisibles" on public.games;
create policy "parties lisibles" on public.games for select to authenticated using (true);
drop policy if exists "créer une partie" on public.games;
create policy "créer une partie" on public.games for insert to authenticated with check (host = auth.uid());
drop policy if exists "l'hôte gère la partie" on public.games;
create policy "l'hôte gère la partie" on public.games for update to authenticated using (host = auth.uid());
drop policy if exists "l'hôte supprime la partie" on public.games;
create policy "l'hôte supprime la partie" on public.games for delete to authenticated using (host = auth.uid());

drop policy if exists "joueurs visibles des membres" on public.game_players;
create policy "joueurs visibles des membres" on public.game_players for select to authenticated using (public.is_member(game_id) or public.is_host(game_id) or user_id = auth.uid());
drop policy if exists "rejoindre" on public.game_players;
create policy "rejoindre" on public.game_players for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "ma ligne ou l'hôte" on public.game_players;
create policy "ma ligne ou l'hôte" on public.game_players for update to authenticated using (user_id = auth.uid() or public.is_host(game_id));
drop policy if exists "quitter" on public.game_players;
create policy "quitter" on public.game_players for delete to authenticated using (user_id = auth.uid() or public.is_host(game_id));

-- ---------- Temps réel (prêts, nouvelles journées) ----------
do $$ begin
  begin alter publication supabase_realtime add table public.games; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.game_players; exception when duplicate_object then null; end;
end $$;

-- ---------- Stockage de l'état des parties (fichier de ~1 à 2 Mo par partie) ----------
insert into storage.buckets (id, name, public) values ('games', 'games', false) on conflict (id) do nothing;
drop policy if exists "parties : lecture des membres" on storage.objects;
create policy "parties : lecture des membres" on storage.objects for select to authenticated
  using (bucket_id = 'games' and public.is_member((storage.foldername(name))[1]::uuid));
drop policy if exists "parties : écriture de l'hôte" on storage.objects;
create policy "parties : écriture de l'hôte" on storage.objects for insert to authenticated
  with check (bucket_id = 'games' and public.is_host((storage.foldername(name))[1]::uuid));
drop policy if exists "parties : mise à jour de l'hôte" on storage.objects;
create policy "parties : mise à jour de l'hôte" on storage.objects for update to authenticated
  using (bucket_id = 'games' and public.is_host((storage.foldername(name))[1]::uuid));
