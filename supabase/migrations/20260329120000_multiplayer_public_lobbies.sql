alter table public.mp_lobbies
add column if not exists is_public boolean not null default false;

create index if not exists mp_lobbies_public_listing_idx
  on public.mp_lobbies (is_public, is_open, status, created_at desc);

create or replace function public.mp_playlist_name(p_snapshot jsonb)
returns text
language sql
stable
as $$
  select coalesce(
    nullif(trim(p_snapshot #>> '{metadata,name}'), ''),
    'Unknown Playlist'
  );
$$;

create or replace function public.mp_playlist_required_round_count(p_snapshot jsonb)
returns integer
language plpgsql
stable
as $$
declare
  v_config jsonb := coalesce(p_snapshot->'config', p_snapshot);
  v_board jsonb := v_config->'boardConfig';
  v_mode text := coalesce(v_board->>'mode', '');
  v_round_nodes integer := 0;
begin
  if v_mode = 'linear' then
    v_round_nodes := greatest(
      0,
      coalesce((v_board->>'totalIndices')::integer, 0)
        - coalesce(jsonb_array_length(coalesce(v_board->'safePointIndices', '[]'::jsonb)), 0)
    );
  elsif v_mode = 'graph' then
    select count(*)
    into v_round_nodes
    from jsonb_array_elements(coalesce(v_board->'nodes', '[]'::jsonb)) as node
    where coalesce(node->>'kind', '') in ('round', 'randomRound');
  end if;

  return greatest(100, coalesce(v_round_nodes, 0));
end;
$$;

create or replace function public.mp_active_lobby_player_count(p_lobby_id uuid)
returns integer
language sql
stable
as $$
  select count(*)
  from public.mp_lobby_players p
  where p.lobby_id = p_lobby_id
    and p.state not in ('kicked', 'forfeited', 'finished', 'came');
$$;

drop function if exists public.mp_create_lobby(text, jsonb, text, text, boolean, text);

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

  return jsonb_build_object(
    'lobby_id', v_lobby.id,
    'invite_code', v_lobby.invite_code,
    'player_id', v_player_id,
    'status', v_lobby.status
  );
end;
$$;

grant execute on function public.mp_create_lobby(text, jsonb, text, text, boolean, boolean, text) to authenticated;

create or replace function public.mp_set_lobby_public(
  p_lobby_id uuid,
  p_is_public boolean
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
  set is_public = p_is_public
  where id = p_lobby_id;
end;
$$;

grant execute on function public.mp_set_lobby_public(uuid, boolean) to authenticated;

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
language sql
security definer
set search_path = public
as $$
  select
    l.id as lobby_id,
    l.invite_code,
    l.name,
    public.mp_playlist_name(l.playlist_snapshot_json) as playlist_name,
    public.mp_active_lobby_player_count(l.id) as player_count,
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
  order by
    case when l.status = 'waiting' then 0 else 1 end,
    l.created_at desc;
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
begin
  select *
  into v_lobby
  from public.mp_lobbies
  where invite_code = upper(trim(p_invite_code));

  if v_lobby.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'lobby_id', v_lobby.id,
    'invite_code', v_lobby.invite_code,
    'name', v_lobby.name,
    'playlist_name', public.mp_playlist_name(v_lobby.playlist_snapshot_json),
    'player_count', public.mp_active_lobby_player_count(v_lobby.id),
    'status', v_lobby.status,
    'is_open', v_lobby.is_open,
    'allow_late_join', v_lobby.allow_late_join,
    'required_round_count', public.mp_playlist_required_round_count(v_lobby.playlist_snapshot_json),
    'created_at', v_lobby.created_at
  );
end;
$$;

grant execute on function public.mp_get_lobby_join_preview(text) to authenticated;
