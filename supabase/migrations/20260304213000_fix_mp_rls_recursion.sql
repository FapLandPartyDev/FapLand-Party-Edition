create or replace function public.mp_is_lobby_member(p_lobby_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.mp_lobby_players p
    where p.lobby_id = p_lobby_id
      and p.user_id = auth.uid()
      and p.state <> 'kicked'
  );
$$;

create or replace function public.mp_is_lobby_host(p_lobby_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.mp_lobbies l
    where l.id = p_lobby_id
      and l.host_user_id = auth.uid()
  );
$$;

grant execute on function public.mp_is_lobby_member(uuid) to authenticated;
grant execute on function public.mp_is_lobby_host(uuid) to authenticated;
