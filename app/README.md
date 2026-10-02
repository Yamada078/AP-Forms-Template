**English** · [ภาษาไทย](README.th.md)

# AP+forms application

Start with [Installation](docs/en/deployment.md), [Organization accounts](docs/en/organization-guide.md), [User guide](docs/en/user-guide.md) or [Connect an app](docs/en/app-integration-walkthrough.md).

Run from this directory:

| Command | Purpose |
| --- | --- |
| `npm ci` | Install the versions in the lockfile |
| `npm run key:local` | Create a local setup key |
| `npm run db:setup:local` | Initialize an empty local database |
| `npm run dev` | Run the local website and API |
| `npm test` | Run automated checks |
| `npm run check:build` | Check deployment bundling without deploying |
| `npm run deploy` | Deploy to the configured Worker |

Replace the database placeholders in `wrangler.jsonc` before deploying. Keep the local key in `.dev.vars` and deployed keys in Cloudflare Secrets.

The interface supports English and Thai. Authored content and stored responses retain their original language. See [Interface languages](docs/en/languages.md).

[Project home](../README.md)
