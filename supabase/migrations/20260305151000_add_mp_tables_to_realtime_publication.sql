do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'Publication supabase_realtime not found; skipping multiplayer realtime publication setup.';
    return;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'mp_lobbies'
  ) then
    alter publication supabase_realtime add table public.mp_lobbies;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'mp_lobby_players'
  ) then
    alter publication supabase_realtime add table public.mp_lobby_players;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'mp_player_progress'
  ) then
    alter publication supabase_realtime add table public.mp_player_progress;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'mp_anti_perk_events'
  ) then
    alter publication supabase_realtime add table public.mp_anti_perk_events;
  end if;
end
$$;
