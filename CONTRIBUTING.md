**English** · [ภาษาไทย](CONTRIBUTING.th.md)

# Contributing to AP+forms

Reports, documentation improvements and code changes help others install and use their own system.

## Report an issue

Describe the steps, expected result and actual behavior. Include the browser or Node.js version when relevant. Use example forms and questions without personal data or integration keys.

## Make a change

1. Create a branch for the change.
2. Run `npm ci` from `app`.
3. Change the source and add meaningful tests for new behavior or bug fixes.
4. Run `npm test` and `npm run check:build`.
5. Explain the problem, resulting behavior and validation in the pull request.

Database changes must support new installations and existing data. See the [development guide](app/docs/en/development.md).

Check both English and Thai when changing the interface. Update both guide versions when behavior changes. See [Interface languages](app/docs/en/languages.md).

## Keep local files private

The local key belongs in `.dev.vars`, and local runtime data belongs in `.wrangler/`. Example configuration and the lockfile are committed so developers can reproduce the environment.

Use general examples in code and documentation, and retain the [MIT License](LICENSE).
