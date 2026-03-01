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

  -- Ignore invalid update attempts so clients don't surface an auth error toast
  -- when local lobby state is briefly stale.
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
