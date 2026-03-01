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
