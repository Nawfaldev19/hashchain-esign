# Architecture decision records

Each record states the situation, the decision and what follows from it, including
the costs. They are numbered in the order they were made.

## ADR 1: Enforce tenant isolation with row-level security

**Context.** Several workspaces share one database. The usual approach adds
`WHERE workspace_id = ?` to every query. That works until one query forgets it, and
the result is the worst kind of bug: silent, and a breach.

**Decision.** Use Postgres row-level security. Every tenant table has a policy
`workspace_id = app_workspace_id()`. The server runs request queries as a role that
owns nothing (`app_tenant`) inside a transaction that sets `app.workspace_id`.
`FORCE ROW LEVEL SECURITY` applies the policies to the table owner too. A second
role (`app_directory`) handles sign-in and has no grants on tenant tables.

**Rejected.** _Filters in application code only_: one mistake leaks data. _A schema
or database per tenant_: strong isolation, but migrations and connection handling
multiply with the number of tenants, which is out of proportion here.

**Consequences.** A forgotten filter returns only the caller's own rows; a forgotten
`set role` returns nothing. The cost is that all access goes through three functions
in `database.ts`, and that policies must be kept in step with new tables. An
integration test asks the database catalog for every table with a `workspace_id`
column and fails if one of them lacks forced row-level security.

## ADR 2: Use an embedded Postgres (PGlite)

**Context.** ADR 1 needs real Postgres features. The demo must also start with one
command on a machine that has only Node.js.

**Decision.** Use PGlite, which is Postgres compiled to WebAssembly and runs inside
the Node.js process, storing its files in a folder.

**Rejected.** _SQLite_: no row-level security, so ADR 1 would become application
code. _Postgres in a container_: makes Docker a requirement for trying the demo.
_An in-memory fake_: would test nothing real.

**Consequences.** Constraints, triggers, policies and `SECURITY DEFINER` functions
are the real thing, and tests run against the same engine as the demo. The cost is a
hard ceiling: one connection, one transaction at a time, in one process. The SQL is
standard and all access goes through the `Database` interface, so moving to a
Postgres server means writing a second implementation of that interface with a
connection pool. Concurrency tests would then need to be re-run against it, because
today transactions are serialized by the engine as well as by row locks.

## ADR 3: Separate editable drafts from immutable published versions

**Context.** A signed agreement must keep the wording the signer saw. Templates must
still be editable.

**Decision.** A template holds one editable draft. Publishing copies the draft into
`template_versions` with the next number. Requests reference a version. A trigger
rejects any update or delete of a version. Draft saves use optimistic locking: the
client sends the revision it started from, and a mismatch is a conflict.

**Rejected.** _Editing in place with a "locked" flag_: a flag can be cleared.
_Copying the text into every request_: duplicates data and loses the link between
requests of the same version. _Pessimistic locking of drafts_: needs lock timeouts
and a way to break locks.

**Consequences.** History is exact and cheap. Publishing is explicit, so a draft can
be invalid while it is being edited and is only checked in full when published. The
cost is one more concept for users (draft versus version), which the interface names
on every screen.

## ADR 4: Derive the request status instead of storing it

**Context.** A request can be awaiting, partly signed, completed, expired or revoked.
Expiry happens by the passing of time, with no event to trigger an update.

**Decision.** Store only facts (`expires_at`, `completed_at`, `revoked_at`, each
signer's `signed_at`) and compute the status from them in one pure function. List
filters repeat the same rules in SQL.

**Rejected.** _A status column updated by a scheduled job_: wrong between runs, and
one more moving part.

**Consequences.** The status can never contradict the facts. The cost is that the
rules exist twice, in TypeScript and in SQL. An integration test creates one request
in each state and asserts that both give the same answer.

## ADR 5: Chain the event history with hashes and fingerprint what was signed

**Context.** The value of a signed record depends on being able to show it was not
changed later.

**Decision.** Events are append-only (a trigger rejects changes) and each stores the
SHA-256 hash of its content together with the previous event's hash. The "signed"
event includes a fingerprint of the signer's answers and signature. A verify action
recomputes everything.

**Rejected.** _An ordinary audit table_: shows what the application wrote, not
whether it was altered since. _Digital signatures with a key_: stronger, but adds key
management, which is a project of its own.

**Consequences.** Any edit, deletion or reordering of events, and any later edit of
signed content, is detected and located. The limit is stated openly: someone with
full control of the database could rewrite the whole chain consistently. Detecting
that needs the latest hash to be stored somewhere else, which this demo does not do.

## ADR 6: Opaque random tokens, stored as hashes, for sessions and signing links

**Context.** Staff need sessions. Signers need access without an account.

**Decision.** Both use 256-bit random tokens. The database stores only the SHA-256
hash. Sessions travel in an `HttpOnly`, `SameSite=Lax` cookie. Signing links carry
the token in the URL path and are shown once.

**Rejected.** _JSON Web Tokens_: cannot be revoked without keeping state anyway, and
a session lookup is one indexed query here. _Storing tokens in clear_: a database
copy would let its holder sign documents. _Signed, stateless links_: could not be
revoked or replaced one by one.

**Consequences.** Logging out, expiring, revoking and replacing are all a row change.
A stolen database copy yields no usable credential. The cost is that a lost link
cannot be shown again; staff issue a new one, which also cancels the old one. A token
in a URL can leak through the `Referer` header, so the server sends
`Referrer-Policy: no-referrer` and the signing page links to nothing external.

## ADR 7: A code-first GraphQL schema, with client types inferred from it

**Context.** The same shapes appear in services, the API and the browser. Keeping
three hand-written copies in step is error-prone.

**Decision.** Define the schema in TypeScript with Pothos, so resolvers are checked
against the service types. Print the schema to `schema.graphql`. On the client, use
gql.tada, which infers the result and variable types of each operation from that
file inside the TypeScript compiler.

**Rejected.** _Schema-first with generated resolver types_: needs a generation step
before the server compiles. _Generated client operation files_: the usual tool
brought in dependencies with licences outside this project's allowed list, and adds
files that must be regenerated on every query change.

**Consequences.** Renaming a field breaks the build on both sides until it is fixed.
The cost is one manual step after an API change (`npm run codegen`), and enum values
that are spelled differently in the API and in storage, which one small mapping file
handles.

## ADR 8: Plain CSS with design tokens, and no CSS framework

**Context.** The interface should have its own identity, two themes and good
contrast, and the dependency list should stay short.

**Decision.** Define every colour, size, radius, shadow and duration once as CSS
custom properties in `tokens.css`. Components use only those names. The dark theme
redefines the colour tokens under `[data-theme='dark']`. A unit test parses the file
and computes WCAG contrast ratios for every text and background pair in both themes.

**Rejected.** _A utility-class framework_: fast to write, but hides the token system
this demo wants to show. _CSS-in-JS_: a runtime cost and a dependency for no gain at
this size.

**Consequences.** Theming is a second block of the same names, and a colour change
that breaks contrast fails the build. The cost is global class names, kept manageable
by a small, flat set of component classes.

## ADR 9: Store drawn signatures as vector strokes, not images

**Context.** A drawn signature must be shown on screens of any size and in a PDF.

**Decision.** Capture pointer movements as strokes of points, each coordinate a
fraction of the signature box. Render them as SVG in the browser and as lines in the
PDF.

**Rejected.** _A PNG from a canvas_: tens of kilobytes per signature, blurry when
scaled, and needs image handling on the server.

**Consequences.** A signature is a few kilobytes of JSON, sharp at any size, easy to
validate (bounds, point count) and easy to fingerprint. The cost is that pen pressure
and stroke width are not recorded.

## ADR 10: Build the PDF with the standard fonts

**Context.** The signed copy must be downloadable as a PDF made on the server.

**Decision.** Use pdf-lib with the fonts every PDF reader already has. Lay out text
with a small top-to-bottom writer that wraps lines and adds pages.

**Rejected.** _A headless browser printing HTML_: a large dependency and a slow
start for one document type. _Embedding a full Unicode font_: adds a font file of
several megabytes and a second library.

**Consequences.** The export is fast, has no native dependencies and produces small
files. The cost is real and documented: characters outside the Latin range are drawn
as `?`. The stored data is not affected, and a test checks that such text does not
fail the export.
