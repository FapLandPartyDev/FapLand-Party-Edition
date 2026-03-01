create or replace function public.mp_presence_timeout_seconds()
returns integer
language sql
stable
as $$
  select 60;
$$;

create or replace function public.mp_active_lobby_player_count(
  p_lobby_id uuid,
  p_timeout_seconds integer default 60
)
returns integer
language sql
volatile
as $$
  select count(*)
  from public.mp_lobby_players p
  where p.lobby_id = p_lobby_id
    and p.state not in ('kicked', 'forfeited', 'finished', 'came')
    and p.last_seen_at >= now() - make_interval(secs => greatest(15, coalesce(p_timeout_seconds, 60)));
$$;

create or replace function public.mp_cleanup_stale_lobby_presence(
  p_lobby_id uuid default null,
  p_timeout_seconds integer default 60
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_timeout_seconds integer := greatest(15, coalesce(p_timeout_seconds, 60));
  v_closed_count integer := 0;
begin
  update public.mp_lobby_players
  set state = 'disconnected'
  where (p_lobby_id is null or lobby_id = p_lobby_id)
    and state not in ('disconnected', 'kicked', 'forfeited', 'finished', 'came')
    and last_seen_at < now() - make_interval(secs => v_timeout_seconds);

  update public.mp_lobbies l
  set status = 'closed',
      is_open = false
  where (p_lobby_id is null or l.id = p_lobby_id)
    and l.status in ('waiting', 'running')
    and public.mp_active_lobby_player_count(l.id, v_timeout_seconds) = 0;

  get diagnostics v_closed_count = row_count;
  return v_closed_count;
end;
$$;

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

  perform public.mp_cleanup_stale_lobby_presence(
    p_lobby_id,
    public.mp_presence_timeout_seconds()
  );
end;
$$;

grant execute on function public.mp_heartbeat(uuid, uuid) to authenticated;

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

create or replace function public.mp_list_public_lobbies()
returns table (
  lobby_id uuid,
  invite_code text,
  name text,
  playlist_name text,
  player_count integer,
  status public.mp_lobby_status,
  is_open boolean,
  allow_late_join boolean,
  required_round_count integer,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.mp_cleanup_stale_lobby_presence(
    null,
    public.mp_presence_timeout_seconds()
  );

  return query
  select
    l.id as lobby_id,
    l.invite_code,
    l.name,
    public.mp_playlist_name(l.playlist_snapshot_json) as playlist_name,
    public.mp_active_lobby_player_count(l.id, public.mp_presence_timeout_seconds()) as player_count,
    l.status,
    l.is_open,
    l.allow_late_join,
    public.mp_playlist_required_round_count(l.playlist_snapshot_json) as required_round_count,
    l.created_at
  from public.mp_lobbies l
  where l.is_public = true
    and l.is_open = true
    and (
      l.status = 'waiting'
      or (l.status = 'running' and l.allow_late_join = true)
    )
    and public.mp_active_lobby_player_count(l.id, public.mp_presence_timeout_seconds()) > 0
  order by
    case when l.status = 'waiting' then 0 else 1 end,
    l.created_at desc;
end;
$$;

grant execute on function public.mp_list_public_lobbies() to authenticated;

create or replace function public.mp_get_lobby_join_preview(
  p_invite_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lobby public.mp_lobbies;
  v_player_count integer;
begin
  select *
  into v_lobby
  from public.mp_lobbies
  where invite_code = upper(trim(p_invite_code));

  if v_lobby.id is null then
    return null;
  end if;

  perform public.mp_cleanup_stale_lobby_presence(
    v_lobby.id,
    public.mp_presence_timeout_seconds()
  );

  select *
  into v_lobby
  from public.mp_lobbies
  where id = v_lobby.id;

  v_player_count := public.mp_active_lobby_player_count(
    v_lobby.id,
    public.mp_presence_timeout_seconds()
  );

  return jsonb_build_object(
    'lobby_id', v_lobby.id,
    'invite_code', v_lobby.invite_code,
    'name', v_lobby.name,
    'playlist_name', public.mp_playlist_name(v_lobby.playlist_snapshot_json),
    'player_count', v_player_count,
    'status', v_lobby.status,
    'is_open', v_lobby.is_open,
    'allow_late_join', v_lobby.allow_late_join,
    'required_round_count', public.mp_playlist_required_round_count(v_lobby.playlist_snapshot_json),
    'created_at', v_lobby.created_at
  );
end;
$$;

grant execute on function public.mp_get_lobby_join_preview(text) to authenticated;

revoke execute on function public.mp_presence_timeout_seconds() from public, anon, authenticated;
revoke execute on function public.mp_active_lobby_player_count(uuid, integer) from public, anon, authenticated;
revoke execute on function public.mp_cleanup_stale_lobby_presence(uuid, integer) from public, anon, authenticated;
