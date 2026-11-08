# Plan

This is the plan the demo was built from. It is kept so that a reader can compare
what was intended with what exists.

## Goal

Show, in one small and complete application, how four things fit together:

1. documents that must not change after someone has signed them,
2. a public flow for people who have no account,
3. a history that reveals later tampering,
4. several organizations sharing one system without seeing each other.

## The fictional setting

A community makerspace asks members to sign agreements before they use dangerous
machines or hire a studio. Staff write the agreements, send them out, and need to
show later exactly what was signed and when.

## In scope

| Area       | What is built                                                                       |
| ---------- | ----------------------------------------------------------------------------------- |
| Workspaces | Sign-in, membership of several workspaces, three roles (owner, editor, viewer)      |
| Templates  | A builder with eight field kinds, drafts, numbered immutable versions               |
| Requests   | One private link per signer, expiry, revoking, replacing a link                     |
| Signing    | A public page, drawn or typed signatures, several signers per document              |
| Records    | Derived status, a hash-chained event history with a verify action, a signed PDF     |
| Interface  | Light and dark themes, phone to desktop layouts, keyboard and screen-reader support |

## Out of scope

Sending email, verifying a signer's identity, certificate-based signatures, managing
members, billing, and anything a lawyer would need to approve. The README lists
these limits for readers.

## Requirements that shaped the design

- A signed copy shows the text the signer saw, forever. This forces immutable
  versions (ADR 3).
- A wrong query must not be able to cross a workspace boundary. This forces isolation
  below the application (ADR 1).
- A copy of the database must not let anyone sign or sign in. This forces hashed
  tokens (ADR 6).
- Two people acting at the same moment must leave consistent data. This forces locks
  and conditional updates in the database, not checks in memory.
- The demo must start with one command on a clean machine. This forces an embedded
  database (ADR 2).

## Order of work

1. Project setup and tooling.
2. The shared field model and its validation rules, with tests.
3. Pure domain logic: errors, secrets, pagination, rate limiting, the hash chain.
4. The database schema with row-level security.
5. Services: sign-in, workspaces, templates, requests, public signing, PDF export.
6. The GraphQL API and the HTTP server.
7. Integration tests, starting with tenant isolation.
8. The web app: tokens, components, then one feature at a time.
9. Browser tests for the main journeys.
10. Documentation, continuous integration and the container setup.

## Definition of done

- `npm run check` passes: lint, type check, tests with coverage above 80% on core
  logic, and the production build.
- `npm run test:e2e` passes.
- A reader can start the demo using only the README.
- Every claim in the docs can be traced to code or to a test.
