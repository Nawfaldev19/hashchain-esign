# References

The specifications, documentation and books behind the patterns in this project.
Each entry says what it was used for.

## Specifications and standards

- **GraphQL Specification.** <https://spec.graphql.org/>. Type system, nullability
  and the error format with `extensions`.
- **GraphQL Cursor Connections Specification.** <https://relay.dev/graphql/connections.htm>.
  The idea of opaque cursors. This project uses a simpler page shape (`items`,
  `endCursor`, `hasNextPage`) and does not claim to implement the specification.
- **RFC 6265, HTTP State Management Mechanism.** <https://www.rfc-editor.org/rfc/rfc6265>.
  Cookie attributes used for the session.
- **RFC 7914, The scrypt Password-Based Key Derivation Function.**
  <https://www.rfc-editor.org/rfc/rfc7914>. Password hashing.
- **RFC 4648, The Base16, Base32, and Base64 Data Encodings.**
  <https://www.rfc-editor.org/rfc/rfc4648>. The URL-safe alphabet used for tokens and
  cursors.
- **RFC 9110, HTTP Semantics.** <https://www.rfc-editor.org/rfc/rfc9110>. Status
  codes and caching headers of the HTTP routes.
- **Web Content Accessibility Guidelines (WCAG) 2.2.** <https://www.w3.org/TR/WCAG22/>.
  The contrast thresholds and the relative luminance formula used in
  `tests/unit/design-tokens.test.ts`.
- **ARIA Authoring Practices Guide.** <https://www.w3.org/WAI/ARIA/apg/>. Naming and
  roles for controls and status messages.

## Database

- **PostgreSQL documentation, Row Security Policies.**
  <https://www.postgresql.org/docs/current/ddl-rowsecurity.html>. The basis of the
  tenancy model.
- **PostgreSQL documentation, CREATE POLICY.**
  <https://www.postgresql.org/docs/current/sql-createpolicy.html>.
- **PostgreSQL documentation, CREATE FUNCTION.**
  <https://www.postgresql.org/docs/current/sql-createfunction.html>. See the section
  on writing `SECURITY DEFINER` functions safely, followed for the token lookup.
- **Markus Winand, "We need tool support for keyset pagination".**
  <https://use-the-index-luke.com/no-offset>. Why lists page by key instead of by
  offset.

## Security guidance

- **OWASP Cheat Sheet Series, Password Storage.**
  <https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html>.
- **OWASP Cheat Sheet Series, Session Management.**
  <https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html>.
- **MDN Web Docs, Content-Security-Policy.**
  <https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy>.
- **MDN Web Docs, Referrer-Policy.**
  <https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referrer-Policy>.

## Ideas and books

- **Stuart Haber and W. Scott Stornetta, "How to Time-Stamp a Digital Document",
  Journal of Cryptology, 1991.** The origin of linking records by hashes so that
  later changes are detectable, which the event history uses.
- **Martin Kleppmann, "Designing Data-Intensive Applications", O'Reilly, 2017.**
  Background for the transaction, locking and derived-data choices.
- **Michael Nygard, "Documenting Architecture Decisions", 2011.** The format of
  `docs/DECISIONS.md`.

## Browser platform

- **MDN Web Docs, Pointer events.**
  <https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events>. The signature pad.
- **MDN Web Docs, the dialog element.**
  <https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dialog>. Modal dialogs.
- **MDN Web Docs, Using CSS custom properties.**
  <https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties>.
  Design tokens and theming.

## Libraries

- **PGlite.** <https://pglite.dev>
- **GraphQL Yoga.** <https://the-guild.dev/graphql/yoga-server>
- **Pothos.** <https://pothos-graphql.dev>
- **DataLoader.** <https://github.com/graphql/dataloader>
- **urql.** <https://github.com/urql-graphql/urql>
- **gql.tada.** <https://gql-tada.0no.co>
- **React.** <https://react.dev>
- **React Router.** <https://reactrouter.com>
- **Zod.** <https://zod.dev>
- **pdf-lib.** <https://pdf-lib.js.org>
- **Vitest.** <https://vitest.dev>
- **Testing Library.** <https://testing-library.com>
- **Playwright.** <https://playwright.dev>

## Conventions

- **Conventional Commits.** <https://www.conventionalcommits.org>
- **Keep a Changelog.** <https://keepachangelog.com>
- **Semantic Versioning.** <https://semver.org>
