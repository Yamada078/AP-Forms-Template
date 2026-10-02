**English** · [ภาษาไทย](../organization-guide.md)

# Organization accounts and respondent access

AP+forms includes its own member accounts. Administrators manage members and respondent access through the interface. Each installation serves one organization.

## First setup

After installation and setting `TEAM_KEY`, open `/account`. Enter the organization name, an optional HTTPS logo URL, the administrator's name, username and password. Enter `TEAM_KEY` in **Setup key** to authorize the first setup.

Usernames accept Latin letters, digits and `. _ @ + -`. An email address can be used as a username, but email ownership is not verified. Passwords need at least 12 characters and cannot exceed 72 UTF-8 bytes; some characters use multiple bytes.

Setup can run only once. Afterward, `TEAM_KEY` cannot sign in to the Builder or bypass account permissions. Keep the Secret because it is also used to sign collaboration tickets.

The same URL now shows sign-in to signed-out visitors and the account dashboard to signed-in members. Setup is stored in the database, so updating the application with the same D1 database does not recreate the organization.

## Invite members

1. Open **Organization account** from the Builder.
2. Enter the member's name, username and role.
3. Choose **Create account and invitation link**.
4. Send the link and username through your organization's usual channel.
5. The member opens the link, chooses a password and signs in.

Emails are not sent automatically. Links expire after 24 hours and can only be used once. Use **New link** if a link expires or a member forgets their password. Creating a new link invalidates older links for that account.

| Role | Access |
| --- | --- |
| Administrator | Organization, members, application integrations, forms, responses and question banks |
| Form editor | Shared forms, responses, banks, packs and respondent access settings |
| Respondent | View and answer forms they are allowed to access |

Form editors in an organization share access to its work. There are no department-specific or per-owner form permissions, and multiple organizations cannot share one installation's database in this release.

Changing a role or disabling an account revokes its sessions. The system prevents disabling or demoting the last active administrator. A pending member must accept an invitation before their role can be edited through the interface.

## Limit who can respond

Open a form → **Publish Settings** → **Respondent access**:

| Mode | Who can answer |
| --- | --- |
| Anyone with the link | Anyone, without signing in |
| Signed-in organization members | Active members who have signed in |
| Selected members only | The selected members, after signing in |

New forms created after organization setup default to members-only access. Access changes take effect immediately, including previously shared links; publishing again is not required. The account dashboard lists open forms the signed-in member is allowed to answer.

Administrators are not automatically allowed to answer selected-members-only forms. Select the administrator account too if it should be able to respond. Builder Preview can still be used to test the form design.

Member responses record `respondent_user_id` and verified account details in `respondent_meta._account`. A name entered in the form is a separate value. Respondents cannot override the verified account identity through the request payload.

## Connect a website that already has accounts

An **Application** identifies an external app and its API permissions. A member account identifies a person signed in to AP+forms.

- For people using AP+forms accounts, invite members and send them the members-only form link.
- For an external app that provides its own answer screen, have its server call the API as shown in the [integration example](app-integration-walkthrough.md), using a public form.
- To reuse existing organizational sign-in inside AP+forms, SSO/OIDC is still needed. It is not implemented in this release.

Submitting an external member ID in `respondentMeta` does not establish a verified AP+forms identity and does not bypass restrictions on members-only forms.

## Passwords and recovery

Members can change their password from the account dashboard using their current password. Administrators can create reset links for other members. Password changes revoke all sessions and older password-setting links for the account. Sign-in attempts are rate limited.

If every administrator forgets their password, a database administrator must help recover access. There is no recovery email flow or `TEAM_KEY` recovery page yet.

This is a preview release. SSO, MFA and a member administration audit log are not available. Test your organization's actual access policies and plan database backups before using it for important work.

## Interface language

Use **Language / ภาษา** to choose English or Thai. Language choice changes interface labels, instructions and system messages. Organization names, usernames, form text and responses retain their original content. New form defaults follow the selected language.

[Install](deployment.md) · [User guide](user-guide.md) · [API reference](integration.md)
