**English** · [ภาษาไทย](../api-quickstart.md)

# Integration API quickstart

Read a published form from your application's server. Complete [installation](deployment.md) first, or use the [full integration walkthrough](app-integration-walkthrough.md) to read and submit a form through a runnable example.

## Prepare the integration

1. Create a test form in the Builder.
2. Add questions, publish it and open it for responses. Set respondent access to **Anyone with the link** for this API example.
3. Open **Applications** and create an application, such as “Example application”.
4. Enable `read_form_schema` and add the form to **Allowed Forms**.
5. Create an integration key and store it on your server. It is shown only once.
6. Copy the form's Public ID from its integration information.

## Read the form

Use Node.js 24 or later and run from the repository root. In PowerShell 7:

```powershell
$env:API_BASE_URL = "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev"
$env:PUBLIC_FORM_ID = "YOUR_PUBLIC_FORM_ID"
$env:INTEGRATION_KEY = Read-Host "Integration key" -MaskInput
node examples/read-form-schema.mjs
Remove-Item Env:INTEGRATION_KEY
```

For another shell, set the same environment variables and run the example. The [walkthrough](app-integration-walkthrough.md) includes a Bash example. Replace the URL and Public ID with your installation's values.

A successful request prints the form schema as JSON. To request a specific published version, add `?version=NUMBER` to the schema endpoint.

## Submit responses

Enable `submit_response` and allow the application to access that form, then send:

```http
POST /api/integrations/forms/{publicId}/responses
Authorization: Bearer <integration credential>
Content-Type: application/json
```

Answers must use question IDs and formats from the schema. This example assumes a text question with ID `question_1`:

```json
{
  "publishedVersion": 1,
  "respondentMeta": {},
  "answers": { "question_1": "Example answer" },
  "source": { "version": "1.0.0", "platform": "web" }
}
```

Use the version and IDs from your published form. Inspect submitted responses in the AP+forms **Responses** screen.

## Use question packs

Create and publish a pack, then grant `read_question_pack`, `submit_game_result` and access to that pack. Read it at `/api/integrations/question-packs/{packId}` and submit answers for grading to its `/grade` route. Answer keys remain on the server.

Store integration keys in your server or a controlled proxy. Do not put them in distributed website or game code. `TEAM_KEY` authorizes initial organization setup and signs collaboration tickets; it is not an application integration key.

For permissions, version behavior and request formats, see the [API reference](integration.md).
