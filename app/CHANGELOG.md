**English** · [ภาษาไทย](CHANGELOG.th.md)

# Changelog

## English and Thai interface · 3 October 2026

- Added a language selector to organization accounts, the Builder, Logic, Responses, question banks, question packs and respondent screens.
- Remember the browser's language choice and preserve entered text while switching languages.
- Added English guides and question templates with links to their Thai counterparts.
- Added language selection to the integration demo while keeping its credential on the server.
- Use the chosen language for new form defaults. Existing authored content and stored responses remain unchanged; no database migration is required.

## Organization preview

- Added organization setup, member accounts, invitation links and password reset links.
- Added administrator, form editor and respondent roles. Disabling an account or changing its role revokes its sessions.
- Added members-only and selected-member form access, recording the respondent's verified account.
- Added migration 0010, preserving existing data, and a runnable application integration example.
- SSO/OIDC and API submissions to members-only forms are not supported in this preview.

## Distribution for self-hosting · 3 October 2026

- Added the MIT license and installation instructions for a new database.
- Replaced instance-specific Worker and database configuration with values installers can customize.
- Added database setup commands, a local setup-key generator, API examples and GitHub source checks.
- Made the question bank import test select questions by content so export ordering does not affect its check for reused tags.

## Documentation update · 2 October 2026

- Added a project introduction and guide index.
- Renamed the application folder to app and updated deployment links and Cloudflare instructions.
- Separated the user, deployment, API and development guides.
- Consolidated V2.6 notes and aligned deployment instructions with the current source.
- Reworded descriptions on the form and question pack screens.

## V2.6

Added multiline descriptions, text response validation and blocks beneath choices.

### Descriptions and text responses

- Preserve line breaks in form, section, question, text and panel descriptions.
- Use a multiline control for the overall form description.
- Validate disallowed values or text in short and long answers before moving to the next page.
- Use Conditional Display to show or hide blocks.

### Blocks beneath choices

- Support Question, Heading, Text, Image, Audio, Video, Panel, Divider and Spacer blocks beneath choices.
- Allow nested questions to contain their own blocks beneath choices.
- Include nested questions in required-answer checks, conditions, routing, summaries and clearing answers from hidden branches.
- Continue to read and edit existing option.children data.

### Data format

Form JSON moved to version 5, with older forms adapted when loaded. V2.6 requires no D1 migration and retains the existing DB and COLLAB bindings.

These notes consolidate the V2.6 records in the repository; they are not a complete version history. Current guides are in [docs](docs/en/).
