<p align="center"><strong>English</strong> · <a href="README.th.md">ภาษาไทย</a></p>

<p align="center">
  <img src="docs/assets/banner.svg" alt="AP+forms — Build forms and connect your own applications" width="100%">
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-9f9aff?style=flat-square" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/Node.js-24%2B-72b58a?style=flat-square" alt="Node.js 24 or later">
  <img src="https://img.shields.io/badge/Cloudflare-Workers%20%2B%20D1-f5a363?style=flat-square" alt="Cloudflare Workers and D1">
  <img src="https://img.shields.io/badge/Interface-English%20%2F%20Thai-8cb4ff?style=flat-square" alt="English and Thai interface">
  <a href="https://github.com/Yamada078/AP-Forms-Template/actions/workflows/check.yml"><img src="https://github.com/Yamada078/AP-Forms-Template/actions/workflows/check.yml/badge.svg" alt="Source checks"></a>
</p>

<p align="center">
  <a href="app/docs/en/deployment.md"><strong>Install</strong></a> ·
  <a href="app/docs/en/user-guide.md">User guide</a> ·
  <a href="app/docs/en/app-integration-walkthrough.md">Connect an app</a> ·
  <a href="docs/en/project.md">Project overview</a>
</p>

# AP+forms

An open-source form workspace that organizations can install and adapt for themselves. Build forms, invite members, control who can respond, and connect your own websites or applications through an HTTP API.

Each installation uses its own database, accounts and integration keys. The source includes the application and installation guides, with an English and Thai interface.

Build a form → Publish a version → Collect responses or connect an app → Review results in your own system.

## Features

| Area | What you can do |
| --- | --- |
| **Organization accounts** | Set a name and logo, invite members, and assign administrator, form editor or respondent roles |
| **Respondent access** | Open forms to anyone with a link, signed-in members, or selected members, with access checked by the server |
| **Form Builder** | Arrange pages and question blocks, add instructions and media, and validate answers |
| **Logic** | Show or hide blocks, route between pages, and add questions beneath individual options |
| **Publishing** | Keep drafts separate from published versions, share permanent links, and schedule opening and closing times |
| **Responses** | Browse individual responses and summaries, grouped by version or source application |
| **Question Studio** | Organize banks and tags, with seven question types including matching, ordering and drag and drop |
| **Question packs** | Combine selected questions and rule-based pools into fixed published versions |
| **Integration API** | Let authorized applications read forms, submit responses, read question packs and grade answers |
| **Interface languages** | Switch between English and Thai without translating or overwriting authored form content |

## Try it locally

Install Node.js 24 or later. Choose **Use this template** on GitHub to create your own repository, or download the source. To try this repository directly:

```sh
git clone https://github.com/Yamada078/AP-Forms-Template.git
cd AP-Forms-Template/app
npm ci
npm run key:local
npm run db:setup:local
npm run dev
```

Open the URL shown in your terminal. On a fresh database, the first screen asks you to set up an organization and create its first administrator. Use the `TEAM_KEY` in `.dev.vars` as the setup key, then choose your own username and password. There is no shared demo account in the distribution.

Run `db:setup:local` only for a new, empty local database. Once setup is complete, visitors see the sign-in screen. Updating the application with the same database preserves accounts, forms and responses.

Use **Language / ภาษา** to choose English or Thai. The first visit follows your browser language; your choice is remembered in that browser. Form names, questions and answers stay in the language their authors used.

To make the website available to your team, follow the [Cloudflare deployment guide](app/docs/en/deployment.md). Local preview data is separate from the database you create on Cloudflare.

## Connect your own application

Create an Application in the administration interface, enable the permissions it needs, select its allowed forms or question packs, and generate an integration key for your application's server.

- Read a form: `GET /api/integrations/forms/{publicId}/schema`
- Submit responses: `POST /api/integrations/forms/{publicId}/responses`
- Read a question pack: `GET /api/integrations/question-packs/{packId}`
- Grade pack answers: `POST /api/integrations/question-packs/{packId}/grade`

The [working integration example](app/docs/en/app-integration-walkthrough.md) includes a small server and a browser page for reading a form and submitting responses. Your application provides its own respondent interface and, where needed, its own member authentication. Keep integration keys on the server.

See the [quickstart](app/docs/en/api-quickstart.md) and [API reference](app/docs/en/integration.md) for request formats and permissions. Reading previously stored responses through the Integration API is not available in this release.

## Repository layout

```text
AP-Forms-Template/
├── README.md             English project page
├── README.th.md          Thai project page
├── LICENSE
├── CONTRIBUTING.md
├── docs/                 Project overview and artwork
├── examples/             Runnable integration examples
└── app/
    ├── src/              Worker and APIs
    ├── public/           Interface, language catalog and assets
    ├── database/         Schema for a new database
    ├── migrations/       Changes for existing databases
    ├── scripts/          Installation and development tools
    ├── tests/            Automated checks
    └── wrangler.jsonc    Example deployment configuration
```

## Guides

- [Installation and deployment](app/docs/en/deployment.md)
- [Organization accounts and respondent access](app/docs/en/organization-guide.md)
- [Using the application](app/docs/en/user-guide.md)
- [Connect an application from start to finish](app/docs/en/app-integration-walkthrough.md)
- [API reference](app/docs/en/integration.md)
- [Development and testing](app/docs/en/development.md)
- [Interface languages](app/docs/en/languages.md)
- [Project overview](docs/en/project.md)
- [Form media](app/public/assets/README.md) and [question images](app/public/assets/question-media/README.md)
- [Contributing](CONTRIBUTING.md)

## Current status

**Preview release for testing and further development.** One installation serves one organization. Form editors share access to forms and question banks. Accounts are managed within AP+forms; SSO/OIDC, MFA, department-specific permissions, automatic invitation emails and a member administration audit log are not implemented yet.

Members-only forms require sign-in through this website. Application keys can access public forms only and cannot stand in for a verified member account.

The application currently runs on Cloudflare Workers and D1. Password checks use bcrypt; Workers Paid is recommended for a deployed organization because of the platform's CPU limits. Other hosting platforms need changes to the database and collaboration layers. Media files are deployed with the source.

<details>
<summary><strong>Before you install</strong></summary>

**Whose database does it use?** Yours. Create D1 in your Cloudflare account and enter its details in `app/wrangler.jsonc`.

**Are there existing accounts or integration keys?** No. You create your organization, accounts, forms and keys. The source includes question templates for experimentation.

**Can I change the interface or API?** Yes. The interface lives in `app/public`; the Worker lives in `app/src`. Start with the [development guide](app/docs/en/development.md).

**Does creating a form or an account require another deployment?** No. These actions save data through the running website. Deploy again when you change the application code.

**How can I contribute?** Report an issue, improve a translation or open a pull request. See [Contributing](CONTRIBUTING.md).

</details>

## License

Released under the [MIT License](LICENSE). You may use, modify and redistribute the project while retaining its copyright and license notices.
