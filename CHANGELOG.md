# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com), and the project uses
[Semantic Versioning](https://semver.org).

## [1.0.0] - 2026-10-12

### Added

- Workspaces with owner, editor and viewer roles, isolated by Postgres row-level
  security.
- Sign-in with scrypt password hashing and hashed, revocable session tokens.
- Template builder with eight field kinds, drafts with optimistic locking, and
  immutable numbered versions.
- Signing requests with one private link per signer, expiry, revoking and link
  replacement.
- Public signing page with drawn and typed signatures and several signers per
  document.
- Hash-chained event history with content fingerprints and a verify action.
- Signed PDF export.
- Light and dark themes built on design tokens, with contrast checked by a test.
- Seeded demo data and one-click demo sign-in.
- Unit, integration, component and end-to-end tests, and a CI workflow.
