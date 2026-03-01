create extension if not exists pgcrypto;

create type public.mp_lobby_status as enum ('waiting', 'running', 'finished', 'closed');
create type public.mp_player_role as enum ('host', 'player');
create type public.mp_player_state as enum (
  'joined',
  'ready',
  'in_match',
  'disconnected',
  'forfeited',
  'finished',
  'kicked'
);
create type public.mp_anti_perk_status as enum ('applied', 'rejected');

create table public.mp_lobbies (
  id uuid primary key default gen_random_uuid(),
  invite_code text not null unique,
  host_user_id uuid not null,
  host_machine_id_hash text not null,
  name text not null,
  status public.mp_lobby_status not null default 'waiting',
  is_open boolean not null default true,
  allow_late_join boolean not null default true,
  server_label text,
  playlist_snapshot_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.mp_lobby_players (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null references public.mp_lobbies(id) on delete cascade,
  user_id uuid not null,
  machine_id_hash text not null,
  display_name text not null,
  role public.mp_player_role not null default 'player',
  state public.mp_player_state not null default 'joined',
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  finish_at timestamptz,
  final_score integer,
  unique (lobby_id, user_id)
);

create table public.mp_bans (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null,
  banned_user_id uuid,
  banned_machine_id_hash text,
  reason text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (banned_user_id is not null or banned_machine_id_hash is not null)
);

create table public.mp_player_progress (
  lobby_id uuid not null references public.mp_lobbies(id) on delete cascade,
  player_id uuid not null references public.mp_lobby_players(id) on delete cascade,
  position_node_id text,
  position_index integer not null default 0,
  money integer not null default 0,
  score integer not null default 0,
  stats_json jsonb not null default '{}'::jsonb,
  active_effects_json jsonb not null default '[]'::jsonb,
  last_roll integer,
  updated_at timestamptz not null default now(),
  primary key (lobby_id, player_id)
);

create table public.mp_anti_perk_events (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null references public.mp_lobbies(id) on delete cascade,
  sender_player_id uuid not null references public.mp_lobby_players(id) on delete cascade,
  target_player_id uuid not null references public.mp_lobby_players(id) on delete cascade,
  perk_id text not null,
  cost integer not null,
  cooldown_until timestamptz not null,
  status public.mp_anti_perk_status not null default 'applied',
  created_at timestamptz not null default now()
);

create table public.mp_playlist_resolution (
  lobby_id uuid not null references public.mp_lobbies(id) on delete cascade,
  player_id uuid not null references public.mp_lobby_players(id) on delete cascade,
  resolved boolean not null default false,
  mapping_json jsonb not null default '{}'::jsonb,
  unresolved_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (lobby_id, player_id)
);

create table public.mp_match_history (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null unique references public.mp_lobbies(id) on delete cascade,
  finished_at timestamptz not null default now(),
  results_json jsonb not null,
  playlist_snapshot_json jsonb not null,
  participants_json jsonb not null
);

create table public.mp_match_history_participants (
  match_id uuid not null references public.mp_match_history(id) on delete cascade,
  user_id uuid not null,
  primary key (match_id, user_id)
);

create index mp_lobby_players_lobby_idx on public.mp_lobby_players(lobby_id);
create index mp_lobby_players_user_idx on public.mp_lobby_players(user_id);
create index mp_player_progress_lobby_idx on public.mp_player_progress(lobby_id);
create index mp_anti_perk_events_lobby_idx on public.mp_anti_perk_events(lobby_id, created_at desc);
create index mp_anti_perk_events_sender_idx on public.mp_anti_perk_events(sender_player_id, cooldown_until desc);
create index mp_bans_host_idx on public.mp_bans(host_user_id, revoked_at);

alter table public.mp_lobbies replica identity full;
alter table public.mp_lobby_players replica identity full;
alter table public.mp_player_progress replica identity full;
alter table public.mp_anti_perk_events replica identity full;
alter table public.mp_playlist_resolution replica identity full;

create or replace function public.mp_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger mp_lobbies_touch_updated_at
before update on public.mp_lobbies
for each row
execute function public.mp_touch_updated_at();

create trigger mp_playlist_resolution_touch_updated_at
before update on public.mp_playlist_resolution
for each row
execute function public.mp_touch_updated_at();

create or replace function public.mp_generate_invite_code()
returns text
language plpgsql
as $$
declare
  candidate text;
begin
  loop
    candidate := upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8));
    exit when not exists(select 1 from public.mp_lobbies where invite_code = candidate);
  end loop;
  return candidate;
end;
$$;

create or replace function public.mp_is_lobby_member(p_lobby_id uuid)
returns boolean
language sql
stable
as $$
  select exists(
    select 1
    from public.mp_lobby_players p
    where p.lobby_id = p_lobby_id
      and p.user_id = auth.uid()
      and p.state <> 'kicked'
  );
$$;

create or replace function public.mp_is_lobby_host(p_lobby_id uuid)
returns boolean
language sql
stable
as $$
  select exists(
    select 1
    from public.mp_lobbies l
    where l.id = p_lobby_id
      and l.host_user_id = auth.uid()
  );
$$;

create or replace function public.mp_is_banned(
  p_host_user_id uuid,
  p_user_id uuid,
  p_machine_id_hash text
)
returns boolean
language sql
stable
as $$
  select exists(
    select 1
    from public.mp_bans b
    where b.host_user_id = p_host_user_id
      and b.revoked_at is null
      and (
        (b.banned_user_id is not null and b.banned_user_id = p_user_id)
        or (b.banned_machine_id_hash is not null and b.banned_machine_id_hash = p_machine_id_hash)
      )
  );
$$;

create or replace function public.mp_create_lobby(
  p_name text,
  p_playlist_snapshot_json jsonb,
  p_machine_id_hash text,
  p_display_name text,
  p_allow_late_join boolean default true,
  p_server_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_lobby public.mp_lobbies;
  v_player_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  insert into public.mp_lobbies (
    invite_code,
    host_user_id,
    host_machine_id_hash,
    name,
    status,
    is_open,
    allow_late_join,
    server_label,
    playlist_snapshot_json
  )
  values (
    public.mp_generate_invite_code(),
    v_user_id,
    p_machine_id_hash,
    trim(p_name),
    'waiting',
    true,
    coalesce(p_allow_late_join, true),
    p_server_label,
    p_playlist_snapshot_json
  )
  returning * into v_lobby;

  insert into public.mp_lobby_players (
    lobby_id,
    user_id,
    machine_id_hash,
    display_name,
    role,
    state
  )
  values (
    v_lobby.id,
    v_user_id,
    p_machine_id_hash,
    trim(p_display_name),
    'host',
    'joined'
  )
  returning id into v_player_id;

  return jsonb_build_object(
    'lobby_id', v_lobby.id,
    'invite_code', v_lobby.invite_code,
    'player_id', v_player_id,
    'status', v_lobby.status
  );
end;
$$;

grant execute on function public.mp_create_lobby(text, jsonb, text, text, boolean, text) to authenticated;

create or replace function public.mp_join_lobby(
  p_invite_code text,
  p_machine_id_hash text,
  p_display_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_lobby public.mp_lobbies;
  v_player_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_lobby
  from public.mp_lobbies
  where invite_code = upper(trim(p_invite_code));

  if v_lobby.id is null then
    raise exception 'Lobby not found';
  end if;

  if not v_lobby.is_open then
    raise exception 'Lobby is locked';
  end if;

  if v_lobby.status = 'running' and not v_lobby.allow_late_join then
    raise exception 'Late join is disabled for this lobby';
  end if;

  if public.mp_is_banned(v_lobby.host_user_id, v_user_id, p_machine_id_hash) then
    raise exception 'You are banned from this host';
  end if;

  insert into public.mp_lobby_players (
    lobby_id,
    user_id,
    machine_id_hash,
    display_name,
    role,
    state,
    last_seen_at
  )
  values (
    v_lobby.id,
    v_user_id,
    p_machine_id_hash,
    trim(p_display_name),
    'player',
    case when v_lobby.status = 'running' then 'in_match' else 'joined' end,
    now()
  )
  on conflict (lobby_id, user_id)
  do update set
    machine_id_hash = excluded.machine_id_hash,
    display_name = excluded.display_name,
    state = case
      when public.mp_lobby_players.state = 'kicked' then public.mp_lobby_players.state
      when v_lobby.status = 'running' then 'in_match'::public.mp_player_state
      else 'joined'::public.mp_player_state
    end,
    last_seen_at = now()
  returning id into v_player_id;

  if (select state from public.mp_lobby_players where id = v_player_id) = 'kicked' then
    raise exception 'You have been kicked';
  end if;

  return jsonb_build_object(
    'lobby_id', v_lobby.id,
    'invite_code', v_lobby.invite_code,
    'player_id', v_player_id,
    'status', v_lobby.status,
    'is_open', v_lobby.is_open
  );
end;
$$;

grant execute on function public.mp_join_lobby(text, text, text) to authenticated;

create or replace function public.mp_set_ready(
  p_lobby_id uuid,
  p_player_id uuid,
  p_mapping_json jsonb,
  p_unresolved_count integer default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_lobby public.mp_lobbies;
  v_unresolved integer := greatest(0, coalesce(p_unresolved_count, 0));
  v_pending_count integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_lobby from public.mp_lobbies where id = p_lobby_id;
  if v_lobby.id is null then
    raise exception 'Lobby not found';
  end if;

  if not exists(
    select 1 from public.mp_lobby_players p
    where p.id = p_player_id and p.lobby_id = p_lobby_id and p.user_id = v_user_id and p.state <> 'kicked'
  ) then
    raise exception 'Player not in lobby';
  end if;

  if v_unresolved > 0 then
    raise exception 'Playlist conflicts unresolved';
  end if;

  insert into public.mp_playlist_resolution (
    lobby_id,
    player_id,
    resolved,
    mapping_json,
    unresolved_count
  )
  values (
    p_lobby_id,
    p_player_id,
    true,
    coalesce(p_mapping_json, '{}'::jsonb),
    v_unresolved
  )
  on conflict (lobby_id, player_id)
  do update set
    resolved = true,
    mapping_json = excluded.mapping_json,
    unresolved_count = excluded.unresolved_count,
    updated_at = now();

  update public.mp_lobby_players
  set state = case when state = 'joined' then 'ready' else state end,
      last_seen_at = now()
  where id = p_player_id and lobby_id = p_lobby_id;

  if v_lobby.status = 'waiting' then
    select count(*) into v_pending_count
    from public.mp_lobby_players p
    where p.lobby_id = p_lobby_id
      and p.state not in ('ready', 'in_match', 'finished', 'forfeited', 'kicked');

    if v_pending_count = 0 then
      update public.mp_lobbies
      set status = 'running'
      where id = p_lobby_id;

      update public.mp_lobby_players
      set state = 'in_match'
      where lobby_id = p_lobby_id
        and state = 'ready';
    end if;
  end if;
end;
$$;

grant execute on function public.mp_set_ready(uuid, uuid, jsonb, integer) to authenticated;

create or replace function public.mp_set_lobby_open(
  p_lobby_id uuid,
  p_is_open boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.mp_is_lobby_host(p_lobby_id) then
    raise exception 'Host only';
  end if;

  update public.mp_lobbies
  set is_open = p_is_open
  where id = p_lobby_id;
end;
$$;

grant execute on function public.mp_set_lobby_open(uuid, boolean) to authenticated;

create or replace function public.mp_kick_player(
  p_lobby_id uuid,
  p_target_player_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.mp_is_lobby_host(p_lobby_id) then
    raise exception 'Host only';
  end if;

  update public.mp_lobby_players
  set state = 'kicked',
      last_seen_at = now()
  where id = p_target_player_id
    and lobby_id = p_lobby_id
    and role <> 'host';
end;
$$;

grant execute on function public.mp_kick_player(uuid, uuid) to authenticated;

create or replace function public.mp_ban_player(
  p_lobby_id uuid,
  p_target_player_id uuid,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lobby public.mp_lobbies;
  v_target public.mp_lobby_players;
  v_ban_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.mp_is_lobby_host(p_lobby_id) then
    raise exception 'Host only';
  end if;

  select * into v_lobby from public.mp_lobbies where id = p_lobby_id;
  select * into v_target from public.mp_lobby_players where id = p_target_player_id and lobby_id = p_lobby_id;

  if v_lobby.id is null or v_target.id is null then
    raise exception 'Lobby or player not found';
  end if;

  if v_target.role = 'host' then
    raise exception 'Cannot ban host';
  end if;

  insert into public.mp_bans (
    host_user_id,
    banned_user_id,
    banned_machine_id_hash,
    reason
  )
  values (
    v_lobby.host_user_id,
    v_target.user_id,
    v_target.machine_id_hash,
    p_reason
  )
  returning id into v_ban_id;

  update public.mp_lobby_players
  set state = 'kicked',
      last_seen_at = now()
  where id = v_target.id;

  return v_ban_id;
end;
$$;

grant execute on function public.mp_ban_player(uuid, uuid, text) to authenticated;

create or replace function public.mp_unban(
  p_ban_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  update public.mp_bans
  set revoked_at = now()
  where id = p_ban_id
    and host_user_id = auth.uid()
    and revoked_at is null;
end;
$$;

grant execute on function public.mp_unban(uuid) to authenticated;

create or replace function public.mp_send_anti_perk(
  p_lobby_id uuid,
  p_sender_player_id uuid,
  p_target_player_id uuid,
  p_perk_id text,
  p_cost integer default 50,
  p_cooldown_seconds integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender public.mp_lobby_players;
  v_target public.mp_lobby_players;
  v_money integer;
  v_cooldown_until timestamptz;
  v_event public.mp_anti_perk_events;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_sender
  from public.mp_lobby_players
  where id = p_sender_player_id and lobby_id = p_lobby_id and user_id = auth.uid();

  if v_sender.id is null then
    raise exception 'Sender not found';
  end if;

  select * into v_target
  from public.mp_lobby_players
  where id = p_target_player_id and lobby_id = p_lobby_id;

  if v_target.id is null then
    raise exception 'Target not found';
  end if;

  if v_sender.id = v_target.id then
    raise exception 'Cannot target self';
  end if;

  if v_sender.state in ('kicked', 'forfeited') then
    raise exception 'Sender inactive';
  end if;

  if v_target.state in ('kicked', 'forfeited') then
    raise exception 'Target inactive';
  end if;

  select money
  into v_money
  from public.mp_player_progress
  where lobby_id = p_lobby_id and player_id = p_sender_player_id;

  if v_money is null then
    raise exception 'Sender progress missing';
  end if;

  select max(cooldown_until)
  into v_cooldown_until
  from public.mp_anti_perk_events
  where lobby_id = p_lobby_id
    and sender_player_id = p_sender_player_id
    and status = 'applied';

  if v_cooldown_until is not null and v_cooldown_until > now() then
    raise exception 'Anti-perk cooldown active';
  end if;

  if v_money < greatest(0, p_cost) then
    raise exception 'Not enough money';
  end if;

  update public.mp_player_progress
  set money = money - greatest(0, p_cost),
      updated_at = now()
  where lobby_id = p_lobby_id and player_id = p_sender_player_id;

  insert into public.mp_anti_perk_events (
    lobby_id,
    sender_player_id,
    target_player_id,
    perk_id,
    cost,
    cooldown_until,
    status
  )
  values (
    p_lobby_id,
    p_sender_player_id,
    p_target_player_id,
    p_perk_id,
    greatest(0, p_cost),
    now() + make_interval(secs => greatest(1, p_cooldown_seconds)),
    'applied'
  )
  returning * into v_event;

  return jsonb_build_object(
    'id', v_event.id,
    'lobby_id', v_event.lobby_id,
    'sender_player_id', v_event.sender_player_id,
    'target_player_id', v_event.target_player_id,
    'perk_id', v_event.perk_id,
    'cost', v_event.cost,
    'cooldown_until', v_event.cooldown_until,
    'status', v_event.status,
    'created_at', v_event.created_at
  );
end;
$$;

grant execute on function public.mp_send_anti_perk(uuid, uuid, uuid, text, integer, integer) to authenticated;

create or replace function public.mp_update_progress(
  p_lobby_id uuid,
  p_player_id uuid,
  p_position_node_id text,
  p_position_index integer,
  p_money integer,
  p_score integer,
  p_stats_json jsonb,
  p_active_effects_json jsonb,
  p_last_roll integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not exists(
    select 1
    from public.mp_lobby_players p
    where p.id = p_player_id
      and p.lobby_id = p_lobby_id
      and p.user_id = auth.uid()
      and p.state <> 'kicked'
  ) then
    raise exception 'Player not allowed to update progress';
  end if;

  insert into public.mp_player_progress (
    lobby_id,
    player_id,
    position_node_id,
    position_index,
    money,
    score,
    stats_json,
    active_effects_json,
    last_roll,
    updated_at
  )
  values (
    p_lobby_id,
    p_player_id,
    p_position_node_id,
    greatest(0, coalesce(p_position_index, 0)),
    greatest(0, coalesce(p_money, 0)),
    greatest(0, coalesce(p_score, 0)),
    coalesce(p_stats_json, '{}'::jsonb),
    coalesce(p_active_effects_json, '[]'::jsonb),
    p_last_roll,
    now()
  )
  on conflict (lobby_id, player_id)
  do update set
    position_node_id = excluded.position_node_id,
    position_index = excluded.position_index,
    money = excluded.money,
    score = excluded.score,
    stats_json = excluded.stats_json,
    active_effects_json = excluded.active_effects_json,
    last_roll = excluded.last_roll,
    updated_at = now();

  update public.mp_lobby_players
  set last_seen_at = now(),
      state = case
        when state in ('joined', 'ready', 'disconnected') then 'in_match'
        else state
      end
  where id = p_player_id
    and lobby_id = p_lobby_id;
end;
$$;

grant execute on function public.mp_update_progress(uuid, uuid, text, integer, integer, integer, jsonb, jsonb, integer) to authenticated;

create or replace function public.mp_heartbeat(
  p_lobby_id uuid,
  p_player_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  update public.mp_lobby_players
  set last_seen_at = now(),
      state = case when state = 'disconnected' then 'in_match' else state end
  where id = p_player_id
    and lobby_id = p_lobby_id
    and user_id = auth.uid();
end;
$$;

grant execute on function public.mp_heartbeat(uuid, uuid) to authenticated;

create or replace function public.mp_mark_disconnected(
  p_lobby_id uuid,
  p_player_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  update public.mp_lobby_players
  set state = case
      when state in ('finished', 'forfeited', 'kicked') then state
      else 'disconnected'
    end,
    last_seen_at = now()
  where id = p_player_id
    and lobby_id = p_lobby_id
    and user_id = auth.uid();
end;
$$;

grant execute on function public.mp_mark_disconnected(uuid, uuid) to authenticated;

create or replace function public.mp_finish_player(
  p_lobby_id uuid,
  p_player_id uuid,
  p_final_score integer,
  p_final_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_score integer := greatest(0, coalesce(p_final_score, 0));
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not exists(
    select 1
    from public.mp_lobby_players p
    where p.id = p_player_id
      and p.lobby_id = p_lobby_id
      and p.user_id = auth.uid()
      and p.state <> 'kicked'
  ) then
    raise exception 'Player not found';
  end if;

  update public.mp_lobby_players
  set state = 'finished',
      finish_at = now(),
      final_score = v_score,
      last_seen_at = now()
  where id = p_player_id
    and lobby_id = p_lobby_id;

  update public.mp_player_progress
  set score = v_score,
      updated_at = now()
  where lobby_id = p_lobby_id
    and player_id = p_player_id;
end;
$$;

grant execute on function public.mp_finish_player(uuid, uuid, integer, jsonb) to authenticated;

create or replace function public.mp_sweep_forfeits(
  p_lobby_id uuid,
  p_grace_seconds integer default 300
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_affected integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.mp_is_lobby_member(p_lobby_id) then
    raise exception 'Lobby member required';
  end if;

  update public.mp_lobby_players
  set state = 'forfeited'
  where lobby_id = p_lobby_id
    and state = 'disconnected'
    and last_seen_at < now() - make_interval(secs => greatest(30, p_grace_seconds));

  get diagnostics v_affected = row_count;
  return v_affected;
end;
$$;

grant execute on function public.mp_sweep_forfeits(uuid, integer) to authenticated;

create or replace function public.mp_finalize_match_if_complete(
  p_lobby_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lobby public.mp_lobbies;
  v_has_pending boolean;
  v_history_id uuid;
  v_results jsonb;
  v_participants jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.mp_is_lobby_member(p_lobby_id) then
    raise exception 'Lobby member required';
  end if;

  select * into v_lobby from public.mp_lobbies where id = p_lobby_id;
  if v_lobby.id is null then
    raise exception 'Lobby not found';
  end if;

  select exists(
    select 1
    from public.mp_lobby_players p
    where p.lobby_id = p_lobby_id
      and p.state not in ('finished', 'forfeited', 'kicked')
  ) into v_has_pending;

  if v_has_pending then
    return false;
  end if;

  select id into v_history_id
  from public.mp_match_history
  where lobby_id = p_lobby_id;

  if v_history_id is not null then
    return true;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'player_id', p.id,
        'user_id', p.user_id,
        'display_name', p.display_name,
        'state', p.state,
        'final_score', coalesce(p.final_score, 0),
        'finish_at', p.finish_at
      )
      order by coalesce(p.final_score, 0) desc, p.finish_at asc nulls last
    ),
    '[]'::jsonb
  )
  into v_results
  from public.mp_lobby_players p
  where p.lobby_id = p_lobby_id;

  select coalesce(
    jsonb_agg(distinct p.user_id),
    '[]'::jsonb
  ) into v_participants
  from public.mp_lobby_players p
  where p.lobby_id = p_lobby_id;

  insert into public.mp_match_history (
    lobby_id,
    results_json,
    playlist_snapshot_json,
    participants_json
  )
  values (
    p_lobby_id,
    v_results,
    v_lobby.playlist_snapshot_json,
    v_participants
  )
  returning id into v_history_id;

  insert into public.mp_match_history_participants (match_id, user_id)
  select v_history_id, p.user_id
  from public.mp_lobby_players p
  where p.lobby_id = p_lobby_id
  on conflict do nothing;

  update public.mp_lobbies
  set status = 'finished',
      is_open = false
  where id = p_lobby_id;

  return true;
end;
$$;

grant execute on function public.mp_finalize_match_if_complete(uuid) to authenticated;

grant select on public.mp_lobbies to authenticated;
grant select on public.mp_lobby_players to authenticated;
grant select on public.mp_player_progress to authenticated;
grant select on public.mp_anti_perk_events to authenticated;
grant select on public.mp_playlist_resolution to authenticated;
grant select on public.mp_match_history to authenticated;
grant select on public.mp_match_history_participants to authenticated;
grant select on public.mp_bans to authenticated;

alter table public.mp_lobbies enable row level security;
alter table public.mp_lobby_players enable row level security;
alter table public.mp_player_progress enable row level security;
alter table public.mp_anti_perk_events enable row level security;
alter table public.mp_playlist_resolution enable row level security;
alter table public.mp_match_history enable row level security;
alter table public.mp_match_history_participants enable row level security;
alter table public.mp_bans enable row level security;

create policy mp_lobbies_select_policy on public.mp_lobbies
for select
using (public.mp_is_lobby_member(id));

create policy mp_lobby_players_select_policy on public.mp_lobby_players
for select
using (public.mp_is_lobby_member(lobby_id));

create policy mp_player_progress_select_policy on public.mp_player_progress
for select
using (public.mp_is_lobby_member(lobby_id));

create policy mp_anti_perk_events_select_policy on public.mp_anti_perk_events
for select
using (public.mp_is_lobby_member(lobby_id));

create policy mp_playlist_resolution_select_policy on public.mp_playlist_resolution
for select
using (public.mp_is_lobby_member(lobby_id));

create policy mp_bans_select_policy on public.mp_bans
for select
using (host_user_id = auth.uid());

create policy mp_match_history_participants_select_policy on public.mp_match_history_participants
for select
using (user_id = auth.uid());

create policy mp_match_history_select_policy on public.mp_match_history
for select
using (
  exists (
    select 1
    from public.mp_match_history_participants p
    where p.match_id = id
      and p.user_id = auth.uid()
  )
);
