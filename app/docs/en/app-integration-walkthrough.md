**English** · [ภาษาไทย](../app-integration-walkthrough.md)

# Connect a form to your application

This runnable example includes a small server that reads a form and submits responses to AP+forms. The integration key stays on that server. Use it to see the complete request flow before adapting it to your application.

## Prepare a form and permissions

1. Install AP+forms and set up an organization using the [organization guide](organization-guide.md).
2. Create a test form without real personal data, add a question and publish it.
3. In **Respondent access**, choose **Anyone with the link** for this API example.
4. As an administrator, open **Applications** and create an application named “Integration demo”.
5. Enable `read_form_schema` and `submit_response`, then select the form under **Allowed Forms**.
6. Create an integration key and copy the form's Public ID from Publish Settings.

## Run the example application

Open PowerShell 7 in the repository root:

```powershell
$env:API_BASE_URL = "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev"
$env:PUBLIC_FORM_ID = "YOUR_PUBLIC_FORM_ID"
$env:INTEGRATION_KEY = Read-Host "Integration key" -MaskInput
node examples/app-integration-server.mjs
```

Or use Bash:

```bash
export API_BASE_URL="https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev"
export PUBLIC_FORM_ID="YOUR_PUBLIC_FORM_ID"
read -rs -p "Integration key: " INTEGRATION_KEY
export INTEGRATION_KEY
node examples/app-integration-server.mjs
```

Open `http://127.0.0.1:8812` and choose **Read form**. The page displays the schema and published version. Enter a respondent name and answers as JSON, using question IDs from the schema, then submit.

The example uses JSON to demonstrate the API contract. It does not automatically build a respondent interface for every question type. Use the schema to build controls appropriate to your own app.

After submission, open **Responses** in AP+forms. The response is associated with the example application. The server derives that source identity from the validated integration key.

Stop the example with Ctrl+C. Remove the key from your shell afterward:

```powershell
Remove-Item Env:INTEGRATION_KEY
```

In Bash, use `unset INTEGRATION_KEY`.

The server listens only on `127.0.0.1` for local testing. It does not have member accounts. Before using this design in a deployed application, add the application's own authentication and permission checks before allowing API requests.

## What to build in your own app

Your application needs:

1. A server or controlled proxy that stores the integration key.
2. A request handler that checks your signed-in user's session and permissions.
3. A call to the form schema endpoint.
4. A respondent screen using the schema's question IDs and answer formats.
5. A server-side call to submit the answers, including the published version.

The flow is: member signs in to your app → your server verifies access → reads the schema → your app shows the form → your server submits the response → AP+forms stores the response and application source.

See [read-form-schema.mjs](../../../examples/read-form-schema.mjs) for the smallest request example, or adapt the API forwarding code in [app-integration-server.mjs](../../../examples/app-integration-server.mjs).

An external member ID included in `respondentMeta` is information supplied by your app. It is not verified as an AP+forms member account and cannot be used in place of sign-in for members-only forms. See [account integration limits](organization-guide.md#connect-a-website-that-already-has-accounts).

The external application can use any hosting provider that can make HTTP requests. AP+forms itself currently uses Cloudflare Workers and D1; moving its backend to another host requires changes to database and collaboration support.

[API reference](integration.md) · [Schema-only quickstart](api-quickstart.md)
