alter table public.mp_lobby_players
  add column if not exists profile_level integer not null default 1,
  add column if not exists title_id text not null default 'fresh-face',
  add column if not exists title_text text not null default 'Fresh Meat';

create or replace function public.mp_update_player_cosmetics(
  p_lobby_id uuid,
  p_player_id uuid,
  p_profile_level integer,
  p_title_id text,
  p_title_text text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.mp_lobby_players
  set
    profile_level = greatest(1, least(coalesce(p_profile_level, 1), 1000000)),
    title_id = left(coalesce(nullif(trim(p_title_id), ''), 'fresh-face'), 80),
    title_text = left(coalesce(nullif(trim(p_title_text), ''), 'Fresh Meat'), 80),
    last_seen_at = now()
  where id = p_player_id
    and lobby_id = p_lobby_id
    and user_id = auth.uid();

  if not found then
    raise exception 'Player not found or not owned by current user';
  end if;
end;
$$;

grant execute on function public.mp_update_player_cosmetics(uuid, uuid, integer, text, text)
  to authenticated;
