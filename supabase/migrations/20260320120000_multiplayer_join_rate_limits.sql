create table public.mp_join_rate_limits (
  scope text not null check (scope in ('user', 'machine')),
  scope_value text not null,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  window_started_at timestamptz not null default now(),
  last_failed_at timestamptz,
  blocked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (scope, scope_value)
);

create index mp_join_rate_limits_blocked_idx
  on public.mp_join_rate_limits(blocked_until)
  where blocked_until is not null;

create or replace function public.mp_touch_join_rate_limit_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger mp_join_rate_limits_touch_updated_at
before update on public.mp_join_rate_limits
for each row
execute function public.mp_touch_join_rate_limit_updated_at();

create or replace function public.mp_enforce_join_lobby_rate_limit(
  p_machine_id_hash text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_machine_id_hash text := trim(coalesce(p_machine_id_hash, ''));
  v_scopes text[] := array['user', 'machine'];
  v_scope_values text[];
  v_now timestamptz := now();
  v_record public.mp_join_rate_limits;
  v_retry_seconds integer := 0;
  i integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if v_machine_id_hash = '' then
    raise exception 'Machine identity required';
  end if;

  v_scope_values := array[v_user_id::text, v_machine_id_hash];

  for i in 1..array_length(v_scopes, 1) loop
    insert into public.mp_join_rate_limits (scope, scope_value)
    values (v_scopes[i], v_scope_values[i])
    on conflict (scope, scope_value) do nothing;

    select *
    into v_record
    from public.mp_join_rate_limits
    where scope = v_scopes[i]
      and scope_value = v_scope_values[i]
    for update;

    if v_record.window_started_at <= v_now - interval '10 minutes' then
      update public.mp_join_rate_limits
      set failed_attempts = 0,
          window_started_at = v_now,
          last_failed_at = null,
          blocked_until = null
      where scope = v_scopes[i]
        and scope_value = v_scope_values[i]
      returning * into v_record;
    end if;

    if v_record.blocked_until is not null and v_record.blocked_until > v_now then
      v_retry_seconds := greatest(
        v_retry_seconds,
        ceil(extract(epoch from (v_record.blocked_until - v_now)))::integer
      );
    end if;
  end loop;

  if v_retry_seconds > 0 then
    raise exception 'Too many join attempts. Try again in % seconds.', v_retry_seconds;
  end if;
end;
$$;

create or replace function public.mp_record_join_lobby_failure(
  p_machine_id_hash text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_machine_id_hash text := trim(coalesce(p_machine_id_hash, ''));
  v_scopes text[] := array['user', 'machine'];
  v_scope_values text[];
  v_now timestamptz := now();
  v_record public.mp_join_rate_limits;
  v_failed_attempts integer;
  v_block_seconds integer;
  i integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if v_machine_id_hash = '' then
    raise exception 'Machine identity required';
  end if;

  v_scope_values := array[v_user_id::text, v_machine_id_hash];

  for i in 1..array_length(v_scopes, 1) loop
    insert into public.mp_join_rate_limits (scope, scope_value)
    values (v_scopes[i], v_scope_values[i])
    on conflict (scope, scope_value) do nothing;

    select *
    into v_record
    from public.mp_join_rate_limits
    where scope = v_scopes[i]
      and scope_value = v_scope_values[i]
    for update;

    if v_record.window_started_at <= v_now - interval '10 minutes' then
      v_failed_attempts := 1;
      update public.mp_join_rate_limits
      set failed_attempts = 1,
          window_started_at = v_now,
          last_failed_at = v_now,
          blocked_until = null
      where scope = v_scopes[i]
        and scope_value = v_scope_values[i];
      continue;
    end if;

    v_failed_attempts := v_record.failed_attempts + 1;
    v_block_seconds := case
      when v_failed_attempts >= 10 then 3600
      when v_failed_attempts >= 7 then 900
      when v_failed_attempts >= 5 then 60
      else 0
    end;

    update public.mp_join_rate_limits
    set failed_attempts = v_failed_attempts,
        last_failed_at = v_now,
        blocked_until = case
          when v_block_seconds > 0 then v_now + make_interval(secs => v_block_seconds)
          else null
        end
    where scope = v_scopes[i]
      and scope_value = v_scope_values[i];
  end loop;
end;
$$;

create or replace function public.mp_reset_join_lobby_rate_limit(
  p_machine_id_hash text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_machine_id_hash text := trim(coalesce(p_machine_id_hash, ''));
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if v_machine_id_hash = '' then
    raise exception 'Machine identity required';
  end if;

  update public.mp_join_rate_limits
  set failed_attempts = 0,
      window_started_at = now(),
      last_failed_at = null,
      blocked_until = null
  where (scope = 'user' and scope_value = v_user_id::text)
     or (scope = 'machine' and scope_value = v_machine_id_hash);
end;
$$;

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
  v_invite_code text := upper(trim(coalesce(p_invite_code, '')));
  v_lobby public.mp_lobbies;
  v_player_id uuid;
  v_existing_state public.mp_player_state;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  perform public.mp_enforce_join_lobby_rate_limit(p_machine_id_hash);

  if v_invite_code !~ '^[A-F0-9]{8}$' then
    perform public.mp_record_join_lobby_failure(p_machine_id_hash);
    raise exception 'Lobby not found';
  end if;

  select *
  into v_lobby
  from public.mp_lobbies
  where invite_code = v_invite_code;

  if v_lobby.id is null then
    perform public.mp_record_join_lobby_failure(p_machine_id_hash);
    raise exception 'Lobby not found';
  end if;

  if not v_lobby.is_open then
    perform public.mp_record_join_lobby_failure(p_machine_id_hash);
    raise exception 'Lobby is locked';
  end if;

  if v_lobby.status = 'running' and not v_lobby.allow_late_join then
    perform public.mp_record_join_lobby_failure(p_machine_id_hash);
    raise exception 'Late join is disabled for this lobby';
  end if;

  if public.mp_is_banned(v_lobby.host_user_id, v_user_id, trim(p_machine_id_hash)) then
    perform public.mp_record_join_lobby_failure(p_machine_id_hash);
    raise exception 'You are banned from this host';
  end if;

  select state
  into v_existing_state
  from public.mp_lobby_players
  where lobby_id = v_lobby.id
    and user_id = v_user_id;

  if v_existing_state = 'came' then
    perform public.mp_record_join_lobby_failure(p_machine_id_hash);
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
    trim(p_machine_id_hash),
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
    perform public.mp_record_join_lobby_failure(p_machine_id_hash);
    raise exception 'You are not allowed to join this lobby';
  end if;

  perform public.mp_reset_join_lobby_rate_limit(p_machine_id_hash);

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

alter table public.mp_join_rate_limits enable row level security;

revoke execute on function public.mp_touch_join_rate_limit_updated_at() from public, anon, authenticated;
revoke execute on function public.mp_enforce_join_lobby_rate_limit(text) from public, anon, authenticated;
revoke execute on function public.mp_record_join_lobby_failure(text) from public, anon, authenticated;
revoke execute on function public.mp_reset_join_lobby_rate_limit(text) from public, anon, authenticated;
