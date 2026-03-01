-- ============================================================
-- 1. Lobby creation rate limit table
-- ============================================================

create table public.mp_create_rate_limits (
  scope text not null check (scope in ('user', 'machine')),
  scope_value text not null,
  creation_count integer not null default 0 check (creation_count >= 0),
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (scope, scope_value)
);

create index mp_create_rate_limits_blocked_idx
  on public.mp_create_rate_limits(blocked_until)
  where blocked_until is not null;

create or replace function public.mp_touch_create_rate_limit_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger mp_create_rate_limits_touch_updated_at
before update on public.mp_create_rate_limits
for each row
execute function public.mp_touch_create_rate_limit_updated_at();

-- ============================================================
-- 2. Lobby creation rate limit enforcement
-- ============================================================

create or replace function public.mp_enforce_create_lobby_rate_limit(
  p_machine_id_hash text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_machine_id_hash text := trim(coalesce(p_machine_id_hash, ''));
  v_scopes text[] := array['user', 'machine'];
  v_scope_values text[];
  v_now timestamptz := now();
  v_record public.mp_create_rate_limits;
  v_retry_seconds integer := 0;
  i integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if v_machine_id_hash = '' then
    raise exception 'Machine identity required';
  end if;

  v_scope_values := array[v_user_id::text, v_machine_id_hash];

  for i in 1..array_length(v_scopes, 1) loop
    insert into public.mp_create_rate_limits (scope, scope_value)
    values (v_scopes[i], v_scope_values[i])
    on conflict (scope, scope_value) do nothing;

    select *
    into v_record
    from public.mp_create_rate_limits
    where scope = v_scopes[i]
      and scope_value = v_scope_values[i]
    for update;

    if v_record.window_started_at <= v_now - interval '10 minutes' then
      update public.mp_create_rate_limits
      set creation_count = 0,
          window_started_at = v_now,
          blocked_until = null
      where scope = v_scopes[i]
        and scope_value = v_scope_values[i]
      returning * into v_record;
    end if;

    if v_record.blocked_until is not null and v_record.blocked_until > v_now then
      v_retry_seconds := greatest(
        v_retry_seconds,
        ceil(extract(epoch from (v_record.blocked_until - v_now)))::integer
      );
    end if;
  end loop;

  if v_retry_seconds > 0 then
    raise exception 'Too many lobbies created. Try again in % seconds.', v_retry_seconds;
  end if;
end;
$$;

create or replace function public.mp_record_create_lobby(
  p_machine_id_hash text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_machine_id_hash text := trim(coalesce(p_machine_id_hash, ''));
  v_scopes text[] := array['user', 'machine'];
  v_scope_values text[];
  v_now timestamptz := now();
  v_record public.mp_create_rate_limits;
  v_count integer;
  v_block_seconds integer;
  i integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if v_machine_id_hash = '' then
    raise exception 'Machine identity required';
  end if;

  v_scope_values := array[v_user_id::text, v_machine_id_hash];

  for i in 1..array_length(v_scopes, 1) loop
    insert into public.mp_create_rate_limits (scope, scope_value)
    values (v_scopes[i], v_scope_values[i])
    on conflict (scope, scope_value) do nothing;

    select *
    into v_record
    from public.mp_create_rate_limits
    where scope = v_scopes[i]
      and scope_value = v_scope_values[i]
    for update;

    if v_record.window_started_at <= v_now - interval '10 minutes' then
      v_count := 1;
      update public.mp_create_rate_limits
      set creation_count = 1,
          window_started_at = v_now,
          blocked_until = null
      where scope = v_scopes[i]
        and scope_value = v_scope_values[i];
      continue;
    end if;

    v_count := v_record.creation_count + 1;
    v_block_seconds := case
      when v_count >= 20 then 7200
      when v_count >= 15 then 1800
      when v_count >= 10 then 300
      else 0
    end;

    update public.mp_create_rate_limits
    set creation_count = v_count,
        blocked_until = case
          when v_block_seconds > 0 then v_now + make_interval(secs => v_block_seconds)
          else null
        end
    where scope = v_scopes[i]
      and scope_value = v_scope_values[i];
  end loop;
end;
$$;

-- ============================================================
-- 3. JSON payload size limit helper (4 MB)
-- ============================================================

create or replace function public.mp_assert_jsonb_within_limit(
  p_value jsonb,
  p_max_bytes integer
)
returns void
language plpgsql
as $$
begin
  if p_value is not null and pg_column_size(p_value) > p_max_bytes then
    raise exception 'JSON payload exceeds maximum allowed size of % bytes', p_max_bytes;
  end if;
end;
$$;

-- ============================================================
-- 4. Max players per lobby constant
-- ============================================================

create or replace function public.mp_max_lobby_players()
returns integer
language sql
stable
as $$
  select 99;
$$;

-- ============================================================
-- 5. Override mp_create_lobby — rate limit + JSON validation
-- ============================================================

drop function if exists public.mp_create_lobby(text, jsonb, text, text, boolean, boolean, text);

create function public.mp_create_lobby(
  p_name text,
  p_playlist_snapshot_json jsonb,
  p_machine_id_hash text,
  p_display_name text,
  p_allow_late_join boolean default true,
  p_is_public boolean default false,
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

  perform public.mp_enforce_create_lobby_rate_limit(p_machine_id_hash);

  perform public.mp_assert_jsonb_within_limit(p_playlist_snapshot_json, 4194304);

  insert into public.mp_lobbies (
    invite_code,
    host_user_id,
    host_machine_id_hash,
    name,
    status,
    is_open,
    is_public,
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
    coalesce(p_is_public, false),
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

  perform public.mp_record_create_lobby(p_machine_id_hash);

  return jsonb_build_object(
    'lobby_id', v_lobby.id,
    'invite_code', v_lobby.invite_code,
    'player_id', v_player_id,
    'status', v_lobby.status
  );
end;
$$;

grant execute on function public.mp_create_lobby(text, jsonb, text, text, boolean, boolean, text) to authenticated;

-- ============================================================
-- 6. Override mp_join_lobby — player cap
-- ============================================================

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
  v_invite_code text := upper(trim(coalesce(p_invite_code, '')));
  v_lobby public.mp_lobbies;
  v_player_id uuid;
  v_existing_state public.mp_player_state;
  v_current_player_count integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  perform public.mp_enforce_join_lobby_rate_limit(p_machine_id_hash);

  if v_invite_code !~ '^[A-F0-9]{8}$' then
    perform public.mp_record_join_lobby_failure(p_machine_id_hash);
    raise exception 'Lobby not found';
  end if;

  select *
  into v_lobby
  from public.mp_lobbies
  where invite_code = v_invite_code;

  if v_lobby.id is null then
    perform public.mp_record_join_lobby_failure(p_machine_id_hash);
    raise exception 'Lobby not found';
  end if;

  perform public.mp_cleanup_stale_lobby_presence(
    v_lobby.id,
    public.mp_presence_timeout_seconds()
  );

  select *
  into v_lobby
  from public.mp_lobbies
  where id = v_lobby.id;

  if not v_lobby.is_open then
    perform public.mp_record_join_lobby_failure(p_machine_id_hash);
    raise exception 'Lobby is locked';
  end if;

  if v_lobby.status = 'running' and not v_lobby.allow_late_join then
    perform public.mp_record_join_lobby_failure(p_machine_id_hash);
    raise exception 'Late join is disabled for this lobby';
  end if;

  if public.mp_is_banned(v_lobby.host_user_id, v_user_id, trim(p_machine_id_hash)) then
    perform public.mp_record_join_lobby_failure(p_machine_id_hash);
    raise exception 'You are banned from this host';
  end if;

  select state
  into v_existing_state
  from public.mp_lobby_players
  where lobby_id = v_lobby.id
    and user_id = v_user_id;

  if v_existing_state = 'came' then
    perform public.mp_record_join_lobby_failure(p_machine_id_hash);
    raise exception 'You cannot rejoin this lobby after cumming';
  end if;

  if v_existing_state is null then
    select count(*)
    into v_current_player_count
    from public.mp_lobby_players p
    where p.lobby_id = v_lobby.id
      and p.state not in ('kicked', 'forfeited', 'finished', 'came');

    if v_current_player_count >= public.mp_max_lobby_players() then
      perform public.mp_record_join_lobby_failure(p_machine_id_hash);
      raise exception 'Lobby is full';
    end if;
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
    trim(p_machine_id_hash),
    trim(p_display_name),
    'player',
    case
      when v_lobby.status = 'running' then 'in_match'::public.mp_player_state
      else 'joined'::public.mp_player_state
    end,
    now()
  )
  on conflict (lobby_id, user_id)
  do update set
    machine_id_hash = excluded.machine_id_hash,
    display_name = excluded.display_name,
    state = case
      when public.mp_lobby_players.state in ('kicked', 'forfeited', 'finished', 'came')
        then public.mp_lobby_players.state
      when v_lobby.status = 'running' then 'in_match'::public.mp_player_state
      else 'joined'::public.mp_player_state
    end,
    last_seen_at = now()
  returning id into v_player_id;

  if (select state from public.mp_lobby_players where id = v_player_id) in ('kicked', 'came') then
    perform public.mp_record_join_lobby_failure(p_machine_id_hash);
    raise exception 'You are not allowed to join this lobby';
  end if;

  perform public.mp_reset_join_lobby_rate_limit(p_machine_id_hash);

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

-- ============================================================
-- 7. Override mp_set_ready — JSON validation
-- ============================================================

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

  perform public.mp_assert_jsonb_within_limit(p_mapping_json, 4194304);

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
  set state = case
      when state in ('kicked', 'forfeited', 'finished', 'came') then state
      when v_lobby.status = 'running' then 'in_match'
      when state = 'joined' then 'ready'
      else state
    end,
      last_seen_at = now()
  where id = p_player_id and lobby_id = p_lobby_id;
end;
$$;

grant execute on function public.mp_set_ready(uuid, uuid, jsonb, integer) to authenticated;

-- ============================================================
-- 8. Override mp_update_progress — JSON validation
-- ============================================================

create or replace function public.mp_update_progress(
  p_lobby_id uuid,
  p_player_id uuid,
  p_position_node_id text,
  p_position_index integer,
  p_money integer,
  p_score integer,
  p_stats_json jsonb,
  p_inventory_json jsonb,
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
      and p.state not in ('kicked', 'forfeited', 'finished', 'came')
  ) then
    return;
  end if;

  perform public.mp_assert_jsonb_within_limit(p_stats_json, 4194304);
  perform public.mp_assert_jsonb_within_limit(p_inventory_json, 4194304);
  perform public.mp_assert_jsonb_within_limit(p_active_effects_json, 4194304);

  insert into public.mp_player_progress (
    lobby_id,
    player_id,
    position_node_id,
    position_index,
    money,
    score,
    stats_json,
    inventory_json,
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
    coalesce(p_inventory_json, '[]'::jsonb),
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
    inventory_json = excluded.inventory_json,
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

grant execute on function public.mp_update_progress(uuid, uuid, text, integer, integer, integer, jsonb, jsonb, jsonb, integer) to authenticated;

-- ============================================================
-- 9. Override mp_finish_player — JSON validation
-- ============================================================

create or replace function public.mp_finish_player(
  p_lobby_id uuid,
  p_player_id uuid,
  p_final_score integer,
  p_final_payload jsonb default '{}'::jsonb,
  p_final_state public.mp_player_state default 'finished'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_score integer := greatest(0, coalesce(p_final_score, 0));
  v_state public.mp_player_state := case
    when p_final_state in ('finished', 'came', 'forfeited') then p_final_state
    else 'finished'::public.mp_player_state
  end;
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

  perform public.mp_assert_jsonb_within_limit(p_final_payload, 4194304);

  update public.mp_lobby_players
  set state = v_state,
      finish_at = now(),
      final_score = v_score,
      final_payload_json = coalesce(p_final_payload, '{}'::jsonb),
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

grant execute on function public.mp_finish_player(uuid, uuid, integer, jsonb, public.mp_player_state) to authenticated;

-- ============================================================
-- 10. Security: RLS + revoke direct execution of helpers
-- ============================================================

alter table public.mp_create_rate_limits enable row level security;

revoke execute on function public.mp_touch_create_rate_limit_updated_at() from public, anon, authenticated;
revoke execute on function public.mp_enforce_create_lobby_rate_limit(text) from public, anon, authenticated;
revoke execute on function public.mp_record_create_lobby(text) from public, anon, authenticated;
revoke execute on function public.mp_assert_jsonb_within_limit(jsonb, integer) from public, anon, authenticated;
revoke execute on function public.mp_max_lobby_players() from public, anon, authenticated;
