# Third-party notices

Signoff Ledger's own code is under the [MIT licence](LICENSE). It depends on the
packages below. Each stays under its own licence, and the full licence text ships
inside the package in `node_modules` after `npm install`.

Only permissive licences are used: MIT, ISC, Apache-2.0 and BSD for code, and the
SIL Open Font License for fonts. The whole dependency tree, including indirect
packages, was scanned when this file was written and contained only these and
equally permissive licences (0BSD, BlueOak-1.0.0, CC0-1.0, MIT-0, Python-2.0).

## Runtime packages

| Package              | Version | Licence    | Source                                         |
| -------------------- | ------- | ---------- | ---------------------------------------------- |
| @electric-sql/pglite | 0.5.8   | Apache-2.0 | <https://pglite.dev>                           |
| @pothos/core         | 4.15.1  | ISC        | <https://github.com/hayes/pothos>              |
| dataloader           | 2.2.3   | MIT        | <https://github.com/graphql/dataloader>        |
| gql.tada             | 1.11.4  | MIT        | <https://gql-tada.0no.co>                      |
| graphql              | 16.14.2 | MIT        | <https://github.com/graphql/graphql-js>        |
| graphql-yoga         | 5.24.4  | MIT        | <https://github.com/graphql-hive/graphql-yoga> |
| lucide-react         | 1.55.0  | ISC        | <https://lucide.dev>                           |
| pdf-lib              | 1.17.1  | MIT        | <https://pdf-lib.js.org>                       |
| react                | 19.3.0  | MIT        | <https://react.dev>                            |
| react-dom            | 19.3.0  | MIT        | <https://react.dev>                            |
| react-router         | 7.18.4  | MIT        | <https://github.com/remix-run/react-router>    |
| urql                 | 5.0.4   | MIT        | <https://github.com/urql-graphql/urql>         |
| zod                  | 4.6.6   | MIT        | <https://zod.dev>                              |

## Fonts

All three are under the SIL Open Font License 1.1 and are bundled through the
Fontsource packages, so no font is loaded from another site.

| Font            | Used for                      | Package                              | Version |
| --------------- | ----------------------------- | ------------------------------------ | ------- |
| Fraunces        | Headings and typed signatures | @fontsource-variable/fraunces        | 5.3.0   |
| Instrument Sans | Body text                     | @fontsource-variable/instrument-sans | 5.3.0   |
| JetBrains Mono  | Code, hashes and links        | @fontsource-variable/jetbrains-mono  | 5.3.0   |

## Icons and images

- Interface icons come from Lucide (`lucide-react`, ISC licence).
- `public/favicon.svg` is original work and is covered by this project's licence.

## Development packages

These are used to build and test the project and are not part of what runs in
production.

| Package                     | Version  | Licence    |
| --------------------------- | -------- | ---------- |
| @eslint/js                  | 9.39.5   | MIT        |
| @playwright/test            | 1.64.0   | Apache-2.0 |
| @testing-library/jest-dom   | 6.9.1    | MIT        |
| @testing-library/react      | 16.3.3   | MIT        |
| @testing-library/user-event | 14.6.7   | MIT        |
| @types/node                 | 20.19.43 | MIT        |
| @types/react                | 19.3.0   | MIT        |
| @types/react-dom            | 19.3.0   | MIT        |
| @vitejs/plugin-react-swc    | 4.3.3    | MIT        |
| @vitest/coverage-v8         | 4.1.11   | MIT        |
| concurrently                | 9.2.5    | MIT        |
| esbuild                     | 0.28.2   | MIT        |
| eslint                      | 9.39.5   | MIT        |
| eslint-plugin-react-hooks   | 5.2.0    | MIT        |
| globals                     | 17.13.0  | MIT        |
| jsdom                       | 29.1.1   | MIT        |
| prettier                    | 3.9.10   | MIT        |
| tsx                         | 4.23.15  | MIT        |
| typescript                  | 6.0.3    | Apache-2.0 |
| typescript-eslint           | 8.71.1   | MIT        |
| vite                        | 7.3.7    | MIT        |
| vitest                      | 4.1.11   | MIT        |

## Packages left out on purpose

Three common tools were not used because their licences are outside the list above:
an accessibility lint plugin (it depends on an MPL-2.0 engine), the usual GraphQL
code generator (it pulls in CC-BY-4.0 browser data) and Vite 8 (it depends on an
MPL-2.0 CSS engine; Vite 7 does not).
