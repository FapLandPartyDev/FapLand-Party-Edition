alter table public.mp_player_progress
  add column if not exists inventory_json jsonb not null default '[]'::jsonb;

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
