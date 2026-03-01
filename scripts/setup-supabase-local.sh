#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

require_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Missing required command: $name" >&2
    exit 1
  fi
}

echo "Preparing local Supabase for multiplayer testing..."

require_command supabase
require_command docker
require_command psql

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not reachable. Start Docker and re-run this script." >&2
  exit 1
fi

echo "[1/4] Starting Supabase services..."
supabase start

echo "[2/4] Resetting local database (migrations + seed)..."
supabase db reset --local

echo "[3/4] Verifying multiplayer schema and RPCs..."
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 <<'SQL'
do $$
declare
  missing_tables text[];
  missing_publication_tables text[];
  missing_functions text[];
begin
  select array_agg(tbl_name order by tbl_name)
  into missing_tables
  from (
    select tbl_name
    from unnest(array[
      'mp_lobbies',
      'mp_lobby_players',
      'mp_bans',
      'mp_player_progress',
      'mp_anti_perk_events',
      'mp_playlist_resolution',
      'mp_match_history',
      'mp_match_history_participants'
    ]) as tbl_name
    where to_regclass(format('public.%s', tbl_name)) is null
  ) missing_tbl;

  if coalesce(array_length(missing_tables, 1), 0) > 0 then
    raise exception 'Missing tables: %', array_to_string(missing_tables, ', ');
  end if;

  select array_agg(tbl_name order by tbl_name)
  into missing_publication_tables
  from (
    select tbl_name
    from unnest(array[
      'mp_lobbies',
      'mp_lobby_players',
      'mp_player_progress',
      'mp_anti_perk_events'
    ]) as tbl_name
    where not exists (
      select 1
      from pg_publication_tables p
      where p.pubname = 'supabase_realtime'
        and p.schemaname = 'public'
        and p.tablename = tbl_name
    )
  ) missing_pub_tbl;

  if coalesce(array_length(missing_publication_tables, 1), 0) > 0 then
    raise exception 'Missing supabase_realtime publication tables: %', array_to_string(missing_publication_tables, ', ');
  end if;

  select array_agg(fn_name order by fn_name)
  into missing_functions
  from (
    select fn_name
    from unnest(array[
      'mp_create_lobby',
      'mp_join_lobby',
      'mp_set_ready',
      'mp_set_lobby_open',
      'mp_kick_player',
      'mp_ban_player',
      'mp_unban',
      'mp_send_anti_perk',
      'mp_update_progress',
      'mp_heartbeat',
      'mp_mark_disconnected',
      'mp_finish_player',
      'mp_sweep_forfeits',
      'mp_finalize_match_if_complete'
    ]) as fn_name
    where not exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = fn_name
    )
  ) missing_fn;

  if coalesce(array_length(missing_functions, 1), 0) > 0 then
    raise exception 'Missing functions: %', array_to_string(missing_functions, ', ');
  end if;
end
$$;
SQL

echo "[4/4] Supabase status:"
supabase status

cat <<'MSG'
Local Supabase is ready.

Useful commands:
- Run app with this shell: `nix develop`
- Stop Supabase: `supabase stop`
MSG
