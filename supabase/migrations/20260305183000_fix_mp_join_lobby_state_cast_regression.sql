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
  v_existing_state public.mp_player_state;
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

  select state
  into v_existing_state
  from public.mp_lobby_players
  where lobby_id = v_lobby.id
    and user_id = v_user_id;

  if v_existing_state = 'came' then
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
    p_machine_id_hash,
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
    raise exception 'You are not allowed to join this lobby';
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
