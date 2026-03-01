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

  -- Do not auto-start the match when all players are ready.
  -- Match start is controlled explicitly by host via mp_start_for_all.
end;
$$;

grant execute on function public.mp_set_ready(uuid, uuid, jsonb, integer) to authenticated;
