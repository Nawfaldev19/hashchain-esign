/**
 * Schema migrations, applied in order and recorded in schema_migrations.
 * They live in code (not .sql files) so the bundled server needs no file lookup.
 */

export interface Migration {
  id: string;
  sql: string;
}

const initialSchema = /* sql */ `
  -- Two roles with no login. The application switches into one of them at the
  -- start of every transaction; it never runs request queries as the owner.
  --   app_tenant     works inside exactly one workspace, fenced in by policies
  --   app_directory  signs people in and finds which workspace a link belongs to
  create role app_tenant nologin;
  create role app_directory nologin;

  create function app_workspace_id() returns uuid
    language sql stable
    as $$ select nullif(current_setting('app.workspace_id', true), '')::uuid $$;

  create function now_ms() returns timestamptz
    language sql stable
    as $$ select date_trunc('milliseconds', now()) $$;

  create function reject_change() returns trigger
    language plpgsql
    as $$
    begin
      raise exception '% rows cannot be changed or removed', tg_table_name
        using errcode = 'restrict_violation';
    end
    $$;

  create type member_role as enum ('owner', 'editor', 'viewer');

  create table users (
    id uuid primary key default gen_random_uuid(),
    email text not null unique check (email = lower(email)),
    name text not null check (char_length(name) between 1 and 80),
    password_hash text not null,
    created_at timestamptz not null default now_ms()
  );

  create table workspaces (
    id uuid primary key default gen_random_uuid(),
    name text not null check (char_length(name) between 1 and 80),
    accent_color text not null default '#0F5C5C' check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
    created_at timestamptz not null default now_ms()
  );

  create table memberships (
    workspace_id uuid not null references workspaces (id),
    user_id uuid not null references users (id),
    role member_role not null,
    created_at timestamptz not null default now_ms(),
    primary key (workspace_id, user_id)
  );
  create index memberships_user_idx on memberships (user_id);

  create table sessions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users (id),
    token_hash text not null unique,
    expires_at timestamptz not null,
    created_at timestamptz not null default now_ms()
  );

  -- Every tenant table carries workspace_id, and child tables point at their
  -- parent with a composite key (workspace_id, id). A row can therefore never
  -- hang off a parent in a different workspace, whatever the application does.
  create table templates (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspaces (id),
    title text not null check (char_length(title) between 1 and 120),
    description text not null default '' check (char_length(description) <= 1000),
    draft_fields jsonb not null default '[]',
    draft_revision integer not null default 1 check (draft_revision > 0),
    created_by uuid not null references users (id),
    created_at timestamptz not null default now_ms(),
    updated_at timestamptz not null default now_ms(),
    unique (workspace_id, id)
  );
  create index templates_page_idx on templates (workspace_id, created_at desc, id desc);

  create table template_versions (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null,
    template_id uuid not null,
    number integer not null check (number > 0),
    title text not null,
    description text not null,
    fields jsonb not null,
    draft_revision integer not null,
    published_by uuid not null references users (id),
    published_at timestamptz not null default now_ms(),
    unique (workspace_id, id),
    unique (template_id, number),
    foreign key (workspace_id, template_id) references templates (workspace_id, id)
  );
  create trigger template_versions_immutable
    before update or delete on template_versions
    for each row execute function reject_change();

  create table signing_requests (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspaces (id),
    template_version_id uuid not null,
    title text not null check (char_length(title) between 1 and 120),
    message text not null default '' check (char_length(message) <= 1000),
    expires_at timestamptz not null,
    completed_at timestamptz,
    revoked_at timestamptz,
    created_by uuid not null references users (id),
    created_at timestamptz not null default now_ms(),
    unique (workspace_id, id),
    foreign key (workspace_id, template_version_id)
      references template_versions (workspace_id, id),
    constraint completed_or_revoked check (completed_at is null or revoked_at is null)
  );
  create index signing_requests_page_idx
    on signing_requests (workspace_id, created_at desc, id desc);

  create table signers (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null,
    request_id uuid not null,
    block_id text not null,
    label text not null,
    name text not null check (char_length(name) between 1 and 80),
    email text not null check (char_length(email) between 3 and 200),
    token_hash text not null unique,
    viewed_at timestamptz,
    signed_at timestamptz,
    signature jsonb,
    answers jsonb not null default '{}',
    unique (request_id, block_id),
    foreign key (workspace_id, request_id) references signing_requests (workspace_id, id),
    constraint signed_has_signature check ((signed_at is null) = (signature is null))
  );
  create index signers_request_idx on signers (workspace_id, request_id);

  create table request_events (
    id bigint generated always as identity primary key,
    workspace_id uuid not null,
    request_id uuid not null,
    seq integer not null check (seq > 0),
    kind text not null,
    actor text not null,
    detail jsonb not null default '{}',
    occurred_at timestamptz not null,
    prev_hash text not null,
    hash text not null,
    unique (request_id, seq),
    foreign key (workspace_id, request_id) references signing_requests (workspace_id, id)
  );
  create trigger request_events_append_only
    before update or delete on request_events
    for each row execute function reject_change();

  -- Row-level security. FORCE makes the policies apply to the table owner too,
  -- so a forgotten "set role" fails closed instead of reading everything.
  alter table templates enable row level security;
  alter table templates force row level security;
  alter table template_versions enable row level security;
  alter table template_versions force row level security;
  alter table signing_requests enable row level security;
  alter table signing_requests force row level security;
  alter table signers enable row level security;
  alter table signers force row level security;
  alter table request_events enable row level security;
  alter table request_events force row level security;
  alter table workspaces enable row level security;
  alter table memberships enable row level security;
  alter table users enable row level security;

  create policy tenant_rows on templates for all to app_tenant
    using (workspace_id = app_workspace_id()) with check (workspace_id = app_workspace_id());
  create policy tenant_rows on template_versions for all to app_tenant
    using (workspace_id = app_workspace_id()) with check (workspace_id = app_workspace_id());
  create policy tenant_rows on signing_requests for all to app_tenant
    using (workspace_id = app_workspace_id()) with check (workspace_id = app_workspace_id());
  create policy tenant_rows on signers for all to app_tenant
    using (workspace_id = app_workspace_id()) with check (workspace_id = app_workspace_id());
  create policy tenant_rows on request_events for all to app_tenant
    using (workspace_id = app_workspace_id()) with check (workspace_id = app_workspace_id());

  create policy own_workspace on workspaces for all to app_tenant
    using (id = app_workspace_id()) with check (id = app_workspace_id());
  create policy own_members on memberships for select to app_tenant
    using (workspace_id = app_workspace_id());
  create policy fellow_members on users for select to app_tenant
    using (exists (
      select 1 from memberships m
      where m.user_id = users.id and m.workspace_id = app_workspace_id()
    ));

  create policy directory_reads on workspaces for select to app_directory using (true);
  create policy directory_reads on memberships for select to app_directory using (true);
  create policy directory_reads on users for select to app_directory using (true);

  grant select, insert, update on templates to app_tenant;
  grant select, insert on template_versions to app_tenant;
  grant select, insert, update on signing_requests to app_tenant;
  grant select, insert, update on signers to app_tenant;
  grant select, insert on request_events to app_tenant;
  grant select on workspaces, memberships to app_tenant;
  -- Column grant: the tenant role can show who is a member, never a password hash.
  grant select (id, email, name) on users to app_tenant;
  grant update (name, accent_color) on workspaces to app_tenant;

  grant select on users, workspaces, memberships to app_directory;
  grant select, insert, delete on sessions to app_directory;

  -- A signing link holds only a token, so the workspace is not yet known when it
  -- arrives. This function is the single, narrow way across the tenant fence: it
  -- maps a token hash to ids and returns nothing else.
  create function resolve_signing_token(p_token_hash text)
    returns table (workspace_id uuid, signer_id uuid, request_id uuid)
    language sql stable security definer
    set search_path = public, pg_temp
    as $$
      select s.workspace_id, s.id, s.request_id from signers s where s.token_hash = p_token_hash
    $$;
  revoke all on function resolve_signing_token(text) from public;
  grant execute on function resolve_signing_token(text) to app_directory;
`;

export const migrations: readonly Migration[] = [{ id: '001_initial_schema', sql: initialSchema }];
