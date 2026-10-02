**English** · [ภาษาไทย](../deployment.md)

# Install your own AP+forms

This guide starts with the source and a new database. Your installation has its own website, accounts, forms, responses and integration keys.

## Requirements

- Node.js 24 or later and npm.
- A Cloudflare account to host the website. The organization account feature uses bcrypt; use Workers Paid for a deployed system because Workers Free has a small CPU budget per request. See [Cloudflare limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time).
- Git if you want to clone the source or connect deployments to GitHub.

Download the source or create a repository using **Use this template**. Open a terminal in the `app` directory:

```sh
cd app
npm ci
```

## Try it on your computer

Create a local setup key and initialize an empty local database:

```sh
npm run key:local
npm run db:setup:local
npm run dev
```

Open the URL Wrangler prints. A fresh installation shows **Set up your organization**. Enter an organization name and create the first administrator using your own username and password. Copy `TEAM_KEY` from `.dev.vars` into **Setup key** to authorize this initial setup. The key generator preserves an existing local key.

After setup, sign in to the Builder. Create a form, add a question, preview it, publish it and send a test response.

Use **Language / ภาษา** to switch the interface between English and Thai. It follows the browser language initially and remembers your selection. You can also open `/account?lang=en` or `/account?lang=th`.

The local database is separate from Cloudflare. If local tables already exist, skip `db:setup:local`; do not run the initial bootstrap again.

## Create a Cloudflare database

Sign in and create a new database:

```sh
npx wrangler login
npx wrangler d1 create applus-forms-db
```

You can choose another database name. Copy the returned database ID, then edit `wrangler.jsonc`:

| Setting | Value |
| --- | --- |
| `name` | Your Worker name, such as `my-forms` |
| `d1_databases[0].database_name` | The database name you created |
| `d1_databases[0].database_id` | The database ID returned by Cloudflare |

The all-zero ID in the distribution is a placeholder. Keep the binding names `DB`, `COLLAB` and `ASSETS` so they match the source.

## Initialize and deploy

Once the configuration points to the correct new database:

```sh
npm run db:setup:remote
npm run deploy
npx wrangler secret put TEAM_KEY
```

The last command asks you to enter a setup key. Choose a strong value and keep it with the system administrator. Open the deployed URL, create the organization and first administrator, and enter this key in **Setup key**. Then sign in with the administrator account. See the [organization guide](organization-guide.md).

`db:setup:remote` writes tables to the Cloudflare database named in your configuration. Use it only for the first installation on an empty database. `database/bootstrap.sql` already includes the required migrations, excluding migration 0002 because its column is already present in `schema.sql`. Do not apply every migration again after bootstrapping.

Wrangler configures the `FormRoom` Durable Object declared in `exports` during deployment.

## What happens after setup?

The first administrator sets up the organization once. Other members receive invitation links, choose their own passwords and sign in to the same website. Creating accounts, changing passwords, publishing forms and collecting responses do not require another code deployment.

Accounts and form data live in D1. Rebuilding and deploying the application with the same database does not run setup again. A different empty database needs its own setup. Local preview accounts are not automatically copied to Cloudflare.

## Verify the installation

1. Sign in at `/account` with the administrator account.
2. Open `/api/health` and check that `db`, `teamKeyConfigured` and `realtimeCollab` are `true`.
3. Create and publish a test form.
4. Invite a member, open a members-only form as that member, submit a response and inspect Responses. Check that a signed-out browser cannot open that form.
5. Try question banks and packs if you plan to use them.
6. Create an Application and follow the [integration quickstart](api-quickstart.md).

Health flags confirm configuration. A successful submission and response lookup verify that the database actually works.

## Automatic deployments from GitHub

After a command-line deployment succeeds, connect your repository in Cloudflare → your existing Worker → Settings → Build.

| Setting | Value |
| --- | --- |
| Repository | Your own repository |
| Production branch | Your release branch, such as `main` |
| Root directory | `app` |
| Build command | `npm ci` |
| Deploy command | `npm run deploy` |

The Worker name must match `name` in `wrangler.jsonc`, and the committed configuration must point to your database. Store `TEAM_KEY` in the Worker's Secrets.

The supplied GitHub workflow runs tests and checks the build. Automatic deployment uses the Cloudflare connection you configure separately.

## Update an existing installation

Preserve your Worker name, database settings and Secrets when updating the source. Back up the database before applying schema changes, and apply only migrations required by the new release. Do not run the fresh-database bootstrap again.

The bilingual interface update needs no new database migration. Existing organization accounts, form content and responses remain unchanged.

### Add organization accounts to an older installation

If your database already includes migrations through 0009, back it up and apply only the account migration:

```sh
npx wrangler d1 execute DB --remote --file migrations/0010_organization_accounts.sql
```

Use `--local` instead of `--remote` for local testing. This migration preserves existing forms and responses. Existing forms remain public until you change their access policy. After deploying the account-enabled source, create the organization and first administrator, then invite members. Earlier respondent names are not converted into verified accounts.

## Troubleshooting

- **Unauthorized during setup:** Check the `TEAM_KEY` for this environment. After setup, use an account username and password rather than the key.
- **CPU limit during password checks:** Check the Workers plan and CPU limit. Use Workers Paid for deployment rather than weakening password hashing.
- **Missing tables:** Verify the configured database and the initial bootstrap step.
- **Duplicate columns:** A bootstrap or migration may have been run twice. Inspect the schema before continuing.
- **Worker name mismatch:** Match the name in Cloudflare and `wrangler.jsonc`.
- **API returns 403:** Check the application's permissions, allowed forms or packs, and whether the form is public.

## References

- [Cloudflare D1 getting started](https://developers.cloudflare.com/d1/get-started/)
- [Worker Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Durable Object class exports](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)

[Project home](../../../README.md)
