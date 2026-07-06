-- The Brier Cup forecast ledger, database edition.
-- Anonymous key may READ the ledger (the site publishes it anyway).
-- All WRITES go through SECURITY DEFINER functions gated on a token
-- stored in app_secrets, so the public anon key cannot ingest.
--
-- After running this schema, set the ingest token:
--   insert into app_secrets (name, value) values ('ingest_token', '<TOKEN>')
--   on conflict (name) do update set value = excluded.value;

create table if not exists predictions (
  match_id text not null,
  model_id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (match_id, model_id)
);

create table if not exists snapshots (
  id bigint generated always as identity primary key,
  match_id text not null,
  at timestamptz not null,
  entry jsonb not null
);
create index if not exists snapshots_match_at on snapshots (match_id, at);

create table if not exists outright (
  id bigint generated always as identity primary key,
  at timestamptz not null,
  entry jsonb not null
);

create table if not exists app_secrets (
  name text primary key,
  value text not null
);

create table if not exists locks (
  name text primary key,
  locked_until timestamptz not null
);

alter table predictions enable row level security;
alter table snapshots enable row level security;
alter table outright enable row level security;
alter table app_secrets enable row level security;
alter table locks enable row level security;

drop policy if exists read_predictions on predictions;
drop policy if exists read_snapshots on snapshots;
drop policy if exists read_outright on outright;
create policy read_predictions on predictions for select to anon using (true);
create policy read_snapshots on snapshots for select to anon using (true);
create policy read_outright on outright for select to anon using (true);
-- app_secrets and locks have RLS enabled and no policies: no anon access.

create or replace function check_token(tok text) returns boolean
language sql security definer set search_path = public as $$
  select exists(select 1 from app_secrets where name = 'ingest_token' and value = tok);
$$;

-- Forecasts are commitments: a record that already has probabilities is
-- never overwritten; only failed records (probs missing/null) are retried.
create or replace function ingest_prediction(tok text, p_match text, p_model text, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not check_token(tok) then raise exception 'unauthorized'; end if;
  insert into predictions (match_id, model_id, data) values (p_match, p_model, p_data)
  on conflict (match_id, model_id) do update
    set data = excluded.data, updated_at = now()
    where predictions.data->'probs' is null
       or predictions.data->'probs' = 'null'::jsonb;
end $$;

create or replace function ingest_snapshot(tok text, p_match text, p_entry jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not check_token(tok) then raise exception 'unauthorized'; end if;
  insert into snapshots (match_id, at, entry)
  values (p_match, coalesce((p_entry->>'at')::timestamptz, now()), p_entry);
end $$;

create or replace function ingest_outright(tok text, p_entry jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not check_token(tok) then raise exception 'unauthorized'; end if;
  insert into outright (at, entry)
  values (coalesce((p_entry->>'at')::timestamptz, now()), p_entry);
end $$;

-- Cooperative lock: returns true when this caller acquired the lock,
-- false when a live lock is already held. Bounds collection spend no
-- matter how many visitors trigger the same staleness check.
create or replace function try_lock(tok text, p_name text, p_seconds int)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not check_token(tok) then raise exception 'unauthorized'; end if;
  insert into locks (name, locked_until) values (p_name, now() + make_interval(secs => p_seconds))
  on conflict (name) do update set locked_until = excluded.locked_until
    where locks.locked_until < now();
  return found;
end $$;

grant execute on function check_token(text) to anon;
grant execute on function ingest_prediction(text, text, text, jsonb) to anon;
grant execute on function ingest_snapshot(text, text, jsonb) to anon;
grant execute on function ingest_outright(text, jsonb) to anon;
grant execute on function try_lock(text, text, int) to anon;
