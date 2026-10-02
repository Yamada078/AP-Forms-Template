**English** · [ภาษาไทย](../integration.md)

# Integration API reference

Connected applications read published forms and question packs. Editing a draft does not change the version an application is using.

Complete [installation](deployment.md) before using the API. A new database initialized with `bootstrap.sql` already includes the required tables and permissions.

Organization accounts and Applications serve different purposes. Members-only and selected-members-only forms require signed-in member accounts on the website. Application API requests to those forms return `SIGNED_IN_FORM_REQUIRED` in this release. See the [organization guide](organization-guide.md).

## Register and authorize an application

In **Applications**, create an application, choose its permissions and allowed forms or packs, then generate an integration key.

Keys are shown only once. The database stores a SHA-256 hash and identifying prefix rather than the secret. Multiple active keys support rotation: create a new key, update the application to use it, then revoke the old one.

After organization setup, the administration interface uses a session cookie and Origin checks. This legacy header applies only before organization accounts are configured:

```http
Authorization: Bearer <TEAM_KEY>
```

| Method | Suffix after `/api/admin/integrations/applications` | Purpose |
| --- | --- | --- |
| `GET`, `POST` | — | List or create applications |
| `PATCH` | `/{applicationId}` | Edit or change application status |
| `DELETE` | `/{applicationId}` | Delete a revoked application |
| `PUT` | `/{applicationId}/permissions` | Set permissions |
| `PUT` | `/{applicationId}/forms` | Set allowed forms |
| `PUT` | `/{applicationId}/question-packs` | Set allowed packs |
| `POST` | `/{applicationId}/credentials` | Create a key |
| `POST` | `/{applicationId}/credentials/{credentialId}/revoke` | Revoke a key |
| `DELETE` | `/{applicationId}/credentials/{credentialId}` | Delete a revoked key |

Allowed forms use `{ "formIds": ["..."] }` with internal form IDs. An empty list allows no forms. Regenerating a form's public link does not remove its application permissions. Forms must have been published before they can be selected.

Allowed packs use `{ "packIds": ["..."] }`; `questionPackIds` is also accepted. Packs must have a published version.

## Application requests

Authenticate with the Application's integration key:

```http
Authorization: Bearer <integration credential>
Content-Type: application/json
```

`TEAM_KEY` authorizes first setup and signs collaboration tickets. After setup it cannot replace an administrator account, and it is not an application integration key.

### Forms

| Method | Route | Permission |
| --- | --- | --- |
| `GET` | `/api/integrations/forms/{publicId}/schema` | `read_form_schema` |
| `POST` | `/api/integrations/forms/{publicId}/responses` | `submit_response` |

The application must also be allowed to use that form. For a fixed version, use `?version={publishedVersion}` when reading the schema and include `publishedVersion` when submitting responses.

An example response payload:

```json
{
  "publishedVersion": 4,
  "respondentMeta": {},
  "answers": {},
  "source": {
    "version": "0.4.7",
    "session": "session_abc",
    "platform": "windows",
    "metadata": { "scene": "example-step" }
  }
}
```

Populate `answers` with the question IDs and answer formats from the schema. The empty object above is a structural example, not a response to a form with required questions.

Responses are validated using the same rules as public form submissions. The server sets `source_app_id` from the authenticated key; the application cannot override that identity.

The Integration API does not provide a route for reading previously stored responses yet.

### Question packs

| Method | Route | Permission |
| --- | --- | --- |
| `GET` | `/api/integrations/question-packs` | `read_question_pack` |
| `GET` | `/api/integrations/question-packs/{packId}` | `read_question_pack` |
| `POST` | `/api/integrations/question-packs/{packId}/grade` | `submit_game_result` |
| `POST` | `/api/integrations/question-packs/{packId}/questions/{questionId}/grade` | `submit_game_result` |

The application must be allowed to use the pack. Consumer pack data excludes answer keys and internal notes. Grading runs on the API server.

## Key handling and request limits

Store keys on the application's server or a controlled proxy, never inside browser or game code distributed to users.

Requests use JSON. Form response payloads are limited to 256 KiB; `source.metadata` is limited to 16 KiB. Basic integration rate limits are maintained per Worker isolate. Cache the schema for the published version you use rather than loading it repeatedly.

Publishing a new version does not change a version explicitly requested by an application. Test the questions and answer formats before moving your app to a different version.

[Quickstart](api-quickstart.md) · [Runnable example](app-integration-walkthrough.md) · [Application source](../../README.md)
