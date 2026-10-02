**English** · [ภาษาไทย](../user-guide.md)

# Using AP+forms

Start with the [organization account guide](organization-guide.md) to create accounts and control respondent access.

## Open your workspace

Sign in with the username and password you set after accepting an invitation. Administrators and form editors choose **Create and manage forms** to open the Builder. Your name appears in live collaboration status.

On a fresh installation, first create the organization and administrator. Use **Language / ภาษา** to choose English or Thai. Interface language does not translate existing questions or responses.

## Build a form

1. Create a form from the form list, then enter its name and description.
2. Arrange sections or pages in the order respondents should see them.
3. Add questions and supporting blocks, such as headings, text, images or media.
4. Mark required questions and check the result with **Preview**.
5. Check the save status before leaving or publishing the form.

Descriptions support line breaks for instructions and examples. Defaults for newly created forms follow your selected interface language. Changing the interface language later does not rewrite those defaults or your own text.

## Add conditions

**Conditional Display** shows or hides blocks according to answers. **Page Routing** chooses the next section when a condition matches. Use **Logic** to inspect the relationships visually.

To ask follow-up questions for a particular option, add **Child Blocks** beneath an option in a single-choice or multiple-choice question. These blocks appear when the option is selected and disappear when it is deselected.

## Validate answers

Short-text and long-text questions support **Response Validation**, including disallowed exact values or text that must not appear in an answer.

For example, to prevent respondents from using `-` instead of answering:

1. Select a text question and enable **Response Validation**.
2. Choose **Must not contain this text or character**.
3. Enter `-` as the disallowed value.
4. Set a message such as “Please write an answer.”

To reject only an answer consisting entirely of `-`, use the exact-value rule instead of the contains rule. Custom validation messages retain the language you write them in.

## Publish a form

Choose **Publish** to create a published version and respondent link. Later edits stay in the draft until you choose **Publish Changes**.

- Publishing changes keeps the same link.
- **Publish Settings** schedules opening and closing in the local time displayed by your browser.
- **Close Form** closes responses; **Reopen** uses the same link.
- **Regenerate Public Link** replaces the link and revokes the previous one. Tell anyone who received the old link.
- **Archive** stops public access while preserving collected responses.
- **Respondent access** chooses public, members-only or selected-member access.

Check the actual respondent link before sharing, especially conditions, required questions, access permissions and schedules.

## Review responses

Open **Responses** to browse individual responses and summaries. Each response retains the version the respondent used, so earlier responses can still be interpreted after form edits.

Summarize all responses or just selected entries. Responses from connected applications can be filtered by source and include application metadata. Member submissions include the verified account identity separately from any respondent name entered in the form.

## Use question banks

Open **Question Banks** to create banks, add questions and organize tags. Supported types are single choice, multiple choice, true/false, short answer, ordering, matching and drag and drop.

Complete the prompt, choices or activity, and answer key. Valid questions become **Ready** automatically. Try an activity before adding it to a pack.

Import and export use JSON packages. The **Templates** dialog offers a starter bank in the selected interface language; using it creates an editable copy. You can also find the files in [question-bank-templates](../../public/question-bank-templates/). See the [question media guide](../../public/assets/question-media/README.md) to add images.

## Build question packs

Open **Question packs** and create a pack. Pin questions from a bank or add a random-selection pool using a bank, type, difficulty and tag rules.

Choose **Validate pack** to check that enough ready questions are available, then **Publish new version**. Each published version stores its selected questions. Later bank edits do not change those published questions.

Pack practice lets you try questions, check answers and move through the pack without saving assessment results.

## Connect an application

See the [integration walkthrough](app-integration-walkthrough.md) for a working server and example page. Your application builds its own answer screen and keeps integration keys on its server.

[Organization accounts](organization-guide.md) · [Project home](../../../README.md)
