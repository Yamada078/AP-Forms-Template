**English** · [ภาษาไทย](../development.md)

# Development

Use Node.js 24 or later and run from `app`:

```sh
npm ci
npm test
npm run check:build
```

Tests use fixtures and in-memory SQLite. `check:build` bundles the Worker and static assets without deploying them.

## Source layout

| Path | Purpose |
| --- | --- |
| `src/entry.js` | Worker entry and Builder loading |
| `src/index.js` | Forms, publishing, responses and live collaboration |
| `src/organization.js` | Organization accounts, sessions and respondent access |
| `src/integration.js` | Applications, permissions and Integration API |
| `src/question-banks.js` | Banks, tags and question readiness |
| `src/question-bank-packages.js` | Bank package import and export |
| `src/question-packs.js` | Composition, pools and published versions |
| `src/assessments.js` | Assessment sessions and grading |
| `public/` | Interface, Logic editor, Question Studio and language catalog |
| `database/bootstrap.sql` | Schema for a new installation |
| `migrations/` | Schema changes for existing databases |

## Database changes

When editing `schema.sql` or adding a migration, update `scripts/generate-bootstrap-schema.mjs` and regenerate the bootstrap:

```sh
npm run db:generate
npm test
```

Bootstrap tests verify that a fresh database contains the required tables and supports the basic APIs without existing installation data. Keep upgrades additive where possible and test existing data as well as fresh installs.

## Interface checks

Run a real local Worker using the [installation guide](deployment.md). The fixture servers also provide focused UI data:

```sh
node tests/ui-fixture-server.mjs
```

Logic and activities have separate `tests/logic-canvas-server.mjs` and `tests/question-activity-server.mjs` fixtures. Fixtures use test data; verify sign-in, database behavior and collaboration against the local Worker too.

Check both interface languages, account setup, respondent permissions, mobile layouts, unsaved input and the public submission flow. Changing a language must not change authored content or send another response.

## Languages

The interface loads `public/i18n-translations.js` and `public/i18n.js` before application scripts. See [Interface languages](languages.md) for translation conventions and how to add application text.

English guides live in `docs/en/`; Thai guides retain their original paths. Update both language versions when behavior changes.

## Local configuration

Keep the local setup key in `.dev.vars`, which Git ignores. `.dev.vars.example` contains placeholders. Use Cloudflare Secrets for deployed keys.

Some internal identifiers and file formats retain older prefixes to preserve compatibility. Do not rename persisted IDs, storage keys, API routes or package fields as part of a wording or language change.

## Media and supporting services

Images, audio and decorative files deploy with the application. See [Form media](../../public/assets/README.md) and [Question images](../../public/assets/question-media/README.md).

Publishing generates QR codes through QuickChart using the public form URL. If you change that integration, recheck link sharing and QR display.

[Project home](../../../README.md)
