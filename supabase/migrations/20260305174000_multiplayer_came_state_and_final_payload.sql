alter type public.mp_player_state add value if not exists 'came';

alter table public.mp_lobby_players
  add column if not exists final_payload_json jsonb not null default '{}'::jsonb;

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
    case when v_lobby.status = 'running' then 'in_match' else 'joined' end,
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

create or replace function public.mp_send_anti_perk(
  p_lobby_id uuid,
  p_sender_player_id uuid,
  p_target_player_id uuid,
  p_perk_id text,
  p_cost integer default 0,
  p_cooldown_seconds integer default 0
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

  if v_sender.state in ('kicked', 'forfeited', 'finished', 'came') then
    raise exception 'Sender inactive';
  end if;

  if v_target.state in ('kicked', 'forfeited', 'finished', 'came') then
    raise exception 'Target inactive';
  end if;

  select money
  into v_money
  from public.mp_player_progress
  where lobby_id = p_lobby_id and player_id = p_sender_player_id;

  if v_money is null then
    raise exception 'Sender progress missing';
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
    now() + make_interval(secs => greatest(0, p_cooldown_seconds)),
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
      when state in ('finished', 'forfeited', 'kicked', 'came') then state
      else 'disconnected'
    end,
    last_seen_at = now()
  where id = p_player_id
    and lobby_id = p_lobby_id
    and user_id = auth.uid();
end;
$$;

grant execute on function public.mp_mark_disconnected(uuid, uuid) to authenticated;

drop function if exists public.mp_finish_player(uuid, uuid, integer, jsonb);

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
    when p_final_state in ('finished', 'came') then p_final_state
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
      and p.state not in ('finished', 'forfeited', 'kicked', 'came')
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
        'finish_at', p.finish_at,
        'final_payload_json', coalesce(p.final_payload_json, '{}'::jsonb)
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
