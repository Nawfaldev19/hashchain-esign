# Testing

## How to run

```bash
npm test               # unit, integration and component tests
npm run test:coverage  # the same, with a coverage report and thresholds
npm run test:e2e       # browser tests against the production build
npm run check          # lint, type check, coverage run and build, as in CI
```

The first browser run needs `npx playwright install chromium`. On a system Playwright
has no browser build for, use an installed Chrome: `PW_CHANNEL=chrome npm run test:e2e`.

## Layers

| Layer       | Where               | Runs in             | Count                                | What it is for                                                       |
| ----------- | ------------------- | ------------------- | ------------------------------------ | -------------------------------------------------------------------- |
| Unit        | `tests/unit`        | Node                | 125                                  | Pure logic: validation, hashing, cursors, status, reducers, contrast |
| Integration | `tests/integration` | Node, real database | 88                                   | Services, SQL, policies and the API together                         |
| Component   | `tests/component`   | jsdom               | 40                                   | What components render and how they respond to input                 |
| End to end  | `tests/e2e`         | A real browser      | 12, three of them also at phone size | Whole journeys through the built app                                 |

Counts are test cases at the time of writing.

### Unit tests

They cover every rule that can be stated without a database or a browser, including
the unhappy paths: each publishing rule, each answer rule, oversized and out-of-box
signatures, tampered cursors, malformed password hashes, and four ways of breaking a
hash chain (edit, delete, reorder, forge).

`design-tokens.test.ts` is unusual: it reads `tokens.css` and computes the WCAG
contrast ratio of every text colour on every background in both themes. The
accessibility claim is therefore checked, not asserted.

### Integration tests

These run against the same embedded Postgres as the demo, with a clock the test
controls. Nothing is mocked: the code under test is the real service, the real SQL
and the real policies.

`tenant-isolation.test.ts` attacks the isolation promise from three directions:

1. **Raw SQL in the tenant role.** For every tenant table: only the current
   workspace's rows are visible; inserting a row for another workspace is rejected;
   updating another workspace's row by id changes nothing; moving a row to another
   workspace is rejected; password hashes and sessions are not readable.
2. **The service layer.** Using another workspace's template version id fails as
   "not found".
3. **The API.** A signed-in member of one workspace sends queries and mutations with
   the other workspace's ids, both through their own workspace and directly. Every
   attempt answers `NOT_FOUND`, and a final test confirms the other workspace's data
   is unchanged.

Other integration files cover the template life cycle (optimistic locking, immutable
versions, paging), the signing flow (validation, expiry, revoking, replacing links,
two kinds of simultaneous submission), history tampering, sign-in and sessions
(timing-equal failures, lock-out, expiry), and the HTTP server (headers, static
files, path traversal, the PDF download and its access checks).

The tampering tests deserve a note. The event table rejects changes through a
trigger, so the tests first confirm that, then disable the trigger as the database
owner, alter a row, and assert that verification finds the exact event. That is the
situation the hash chain exists for.

### Component tests

They render real components and act through roles and labels, the way a person or a
screen reader would. They check, for example, that an error message is connected to
its control (`aria-describedby`, `aria-invalid`), that only the current signer's
fields are editable, and that pointer movements become strokes with the right
coordinates.

jsdom lacks three browser features, which `tests/component/setup.ts` stands in for:
`setPointerCapture` and the `<dialog>` methods. The real behaviour of both is
exercised in the browser tests.

### End-to-end tests

They run the production build with a throwaway in-memory database and seed data.

- `signing-flow.spec.ts` is the whole journey: write a template, see why it cannot be
  published, fix it, publish, send it to two people, sign once by typing and once by
  drawing with the mouse (each in a browser context with no session), then verify the
  history and download the PDF.
- `access.spec.ts` covers roles, switching workspaces, the sign-in redirect, an
  invalid link, replacing a link and revoking.
- `layout.spec.ts` runs at desktop and phone size: no sideways scrolling on the main
  screens, theme choice applied before first paint and kept across reloads, and the
  skip link as the first Tab stop.

## Coverage

Coverage is measured on the core logic: `src/shared`, `src/server/domain`,
`src/server/services`, `src/web/lib` and the builder reducer. Thresholds in
`vitest.config.ts` fail the run below 80% (75% for branches).

| Measure    | Result |
| ---------- | ------ |
| Statements | 96.87% |
| Branches   | 91.97% |
| Functions  | 99.44% |
| Lines      | 99.85% |

## Known gaps

- **Pages are not unit tested.** Files under `src/web/features` (other than the
  builder reducer and field card) are covered by the browser tests, not by component
  tests, and are outside the coverage numbers above. Testing them in jsdom would mean
  mocking the GraphQL client, which tests the mock more than the page.
- **GraphQL and HTTP glue is outside the coverage figure.** `src/server/graphql` and
  `src/server/http` are exercised by the integration tests but not counted, because
  they contain wiring, not rules.
- **Uncovered branches** are mostly defensive: rows that the database guarantees to
  exist, and fallbacks for values TypeScript cannot prove are present.
- **Concurrency is tested on one connection.** The embedded database serializes
  transactions. The row locks are written for a pooled Postgres, but have not been
  run against one.
- **The container setup is not tested.**
- **No automated accessibility audit.** The common audit engine has a licence outside
  this project's allowed list. Accessibility is tested through roles, labels,
  keyboard order and computed contrast instead.
- **One browser engine.** The browser tests run on Chromium only.
