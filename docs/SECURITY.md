# Security

This document describes what Signoff Ledger protects, from whom, and how. It also lists
what it does not protect, which matters as much.

## What is worth protecting

| Asset                                                     | Why it matters                                               |
| --------------------------------------------------------- | ------------------------------------------------------------ |
| A workspace's templates, requests, answers and signatures | Private to that organization; answers hold personal details  |
| The integrity of signed records                           | A record that can be quietly edited is worthless as evidence |
| Signing links                                             | Whoever holds one can sign as that person                    |
| Staff sessions and passwords                              | They open everything in a workspace                          |

## Who might attack

| Actor                                 | Starting point                                              |
| ------------------------------------- | ----------------------------------------------------------- |
| Anonymous visitor                     | Can reach the public API and guess link tokens or passwords |
| Signer                                | Holds one valid link and may try to do more with it         |
| Member of another workspace           | Has a valid session and knows how the API works             |
| Member with too low a role            | A viewer trying to change things                            |
| Someone with a copy of the database   | A leaked backup                                             |
| Someone who can write to the database | An insider or a second breach                               |

## Threats and controls

| Threat                                                | Control                                                                                                                              | Where                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| A query reads or writes another workspace's rows      | Row-level security on every tenant table, forced for the owner; request code runs as a role limited to one workspace per transaction | `db/migrations.ts`, `db/database.ts`               |
| A child row is attached to another workspace's parent | Composite foreign keys on `(workspace_id, id)`                                                                                       | `db/migrations.ts`                                 |
| Probing for ids from other workspaces                 | Non-members get `NOT_FOUND`, the same answer as for a missing workspace                                                              | `services/auth-service.ts`                         |
| A viewer or editor exceeds their role                 | Role checked in the service, not only hidden in the interface                                                                        | `assertRole` in each service                       |
| Password guessing                                     | scrypt hashes; at most eight attempts per minute for one address and email; equal response time for unknown emails                   | `domain/secrets.ts`, `services/auth-service.ts`    |
| Finding out which emails have accounts                | One message for both failures, and a decoy hash check                                                                                | `services/auth-service.ts`                         |
| Session theft through script                          | `HttpOnly` cookie; a strict Content-Security-Policy with no inline scripts                                                           | `graphql/yoga.ts`, `http/server.ts`                |
| Cross-site request forgery                            | `SameSite=Lax` cookie, which browsers do not send on cross-site `POST`; mutations are refused over `GET`                             | `graphql/yoga.ts`                                  |
| Guessing a signing link                               | 256 bits of randomness; lookups rate limited per address                                                                             | `domain/secrets.ts`, `services/signing-service.ts` |
| A leaked link is used later                           | Links expire, can be revoked with the request, and can be replaced one by one                                                        | `services/request-service.ts`                      |
| A link token leaks through the `Referer` header       | `Referrer-Policy: no-referrer`; the signing page links to no other site                                                              | `http/server.ts`                                   |
| A signer writes into another signer's fields          | Answers to fields not assigned to the signer are rejected, not ignored                                                               | `shared/fields.ts`                                 |
| A signer signs twice, or two submissions race         | Row lock on the request and a conditional update on the signer                                                                       | `services/signing-service.ts`                      |
| A dead link reveals the document                      | Expired and revoked links return a title and a state, no content                                                                     | `services/signing-service.ts`                      |
| A database copy is used to sign in or to sign         | Only hashes of session and link tokens are stored                                                                                    | `domain/secrets.ts`                                |
| Published text is changed after signing               | Versions are immutable; a trigger rejects updates and deletes                                                                        | `db/migrations.ts`                                 |
| History or signed content is altered later            | Append-only trigger, hash chain, content fingerprint, verify action                                                                  | `domain/history.ts`, `services/event-log.ts`       |
| Malformed or oversized input                          | Zod schemas at the service edge, with length and count limits; database check constraints behind them                                | `services/validation.ts`                           |
| SQL injection                                         | Parameterized statements only; the one piece of variable SQL is chosen from a fixed table                                            | `services/request-service.ts`                      |
| Reading files outside the web folder                  | Paths are normalized and must stay under the web root                                                                                | `http/server.ts`                                   |
| Clickjacking and content sniffing                     | `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`                                                 | `http/server.ts`                                   |
| Internal details leak through errors                  | Only expected errors reach the client; everything else is logged and masked                                                          | `graphql/yoga.ts`                                  |
| Secrets in logs                                       | Logs take ids and counts as fields; tokens, passwords and answers are never passed to the logger                                     | `logger.ts`                                        |

Nearly every control in this table has a test that fails if the control is removed;
[TESTING.md](TESTING.md) describes them. The two that rest on review instead of a
test are parameterized SQL and keeping secrets out of logs.

## How authorization is decided

1. The session cookie is hashed and looked up. No session means no user.
2. For anything inside a workspace, `requireScope` reads the user's membership. No
   membership: `NOT_FOUND`. It returns a `Scope` (workspace, user, role).
3. The service checks the role the action needs.
4. The service opens a tenant transaction for that workspace. From here the database
   enforces the boundary, whatever the SQL says.

Steps 2 and 4 are independent. A bug in one is caught by the other.

The public signing flow has no user and no `Scope`. The token is exchanged for ids by
one database function, and the signer can then only read their own request and write
their own answers and signature.

## Secrets and configuration

Signoff Ledger needs no secret to run: tokens are random and stored hashed, and nothing
is signed with a server key. `.env.example` therefore contains only settings. The
demo password in the README belongs to fictional seed accounts and is published on
purpose; a real deployment would set `SEED_DEMO=false`.

## What is not covered

- **Proof of identity.** Anyone holding a link can sign. There is no email or phone
  verification and no second factor.
- **Legal standing.** This is not a qualified or advanced electronic signature under
  any law, and no lawyer has reviewed it.
- **A fully trusted history.** Someone who controls the database can rebuild the
  whole hash chain. Catching that needs the latest hash published somewhere outside
  the system.
- **Transport security.** The server speaks plain HTTP and expects TLS to be added in
  front of it. Cookies are marked `Secure` only when `PUBLIC_URL` starts with
  `https://`.
- **Shared rate limits.** Counters are in memory, per process, and reset on restart.
  The limiter keys on the network address the server sees, so behind a proxy it
  needs the forwarded address to be passed on by trusted configuration.
- **Staff account management.** No password change, reset or lock-out notice.
- **Data retention.** Nothing is ever deleted, and there is no export or erasure for
  a person's data.
- **Dependency monitoring.** `npm audit` reported no known issues when this was
  written; nothing checks that continuously.

## Reporting a problem

This is a demo with no deployment. If you find a flaw, open an issue on the
repository.
