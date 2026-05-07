-- ── screen_shadows — Device Shadow (MQTT Phase 2) ──────────────────────────
--
-- One row per screen; tracks what the server *desires* vs what the device
-- has *reported*.  The `delta` column is auto-computed by trigger so the
-- application never has to calculate diffs manually.
--
-- Desired state schema (server writes):
--   { "channel_id": "<uuid|null>",
--     "channel_override_until": "<iso|null>" }
--
-- Reported state schema (device writes via shadow-report Edge Function):
--   { "channel_id": "<uuid|null>",
--     "status": "playing|idle|error",
--     "version": "1.0.0" }

create table if not exists screen_shadows (
  screen_id     uuid        primary key
                            references screens(id) on delete cascade,
  desired       jsonb       not null default '{}',
  reported      jsonb       not null default '{}',
  delta         jsonb       not null default '{}',  -- desired keys that differ from reported
  synced_at     timestamptz,                         -- last time delta became empty
  updated_at    timestamptz not null default now()
);

comment on table  screen_shadows                is 'Device shadow: desired vs reported state per screen';
comment on column screen_shadows.desired        is 'State the server wants the device to be in';
comment on column screen_shadows.reported       is 'State the device last confirmed it is in';
comment on column screen_shadows.delta          is 'Keys in desired that differ from reported (auto-computed)';
comment on column screen_shadows.synced_at      is 'Timestamp when delta last became empty (desired == reported)';

-- ── Auto-compute delta on every write ───────────────────────────────────────

create or replace function fn_compute_shadow_delta()
returns trigger language plpgsql as $$
declare
  d  jsonb := '{}';
  k  text;
begin
  -- delta = every key in desired whose value differs from reported
  for k in select jsonb_object_keys(new.desired) loop
    if (new.reported ->> k) is distinct from (new.desired ->> k) then
      d := d || jsonb_build_object(k, new.desired -> k);
    end if;
  end loop;

  new.delta      := d;
  new.updated_at := now();

  if d = '{}'::jsonb then
    new.synced_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_shadow_delta on screen_shadows;
create trigger trg_shadow_delta
  before insert or update on screen_shadows
  for each row execute function fn_compute_shadow_delta();

-- ── RLS (service-role bypasses; user-facing queries scoped to org) ──────────

alter table screen_shadows enable row level security;

-- Service role has full access (set via client config)
-- No public policies — only Edge Functions (service_role) read/write this table.

-- ── Seed existing screens with empty shadows ─────────────────────────────────

insert into screen_shadows (screen_id)
  select id from screens
  on conflict (screen_id) do nothing;

-- ── Index for bulk lookups (signcms-mcp fans out to many screens) ────────────

create index if not exists idx_screen_shadows_updated_at
  on screen_shadows (updated_at desc);
