**English** · [ภาษาไทย](../languages.md)

# Interface languages

AP+forms provides English and Thai interface text for organization accounts, respondent access, the Builder, Logic, Responses, question banks, question packs and respondent screens.

## Choose a language

Use **Language / ภาษา** at the bottom of the screen. The first visit follows your browser language: Thai browsers use Thai; other browsers use English. Your selection is saved in this browser and applies to other pages on the same installation.

You can also use `?lang=en` or `?lang=th`, for example `/account?lang=en`. An explicit supported URL choice takes priority over the saved preference. Private browsing or storage restrictions may prevent the choice from persisting between visits.

The switch redraws the current workspace without a page reload. Text already entered in form controls is preserved. Close an open dialog before changing languages.

## What changes

Interface labels, instructions, built-in messages and date formatting follow the selected language. Defaults for newly created forms follow that language too.

The application does not translate organization names, usernames, form titles, authored questions, option text, custom validation messages or stored answers. Changing languages does not rewrite D1 data. Use the Builder to write form content in the language your respondents need.

The Question Banks template dialog offers English or Thai starter examples. Imported questions become your own content and retain their chosen language afterward.

## Add interface text

`public/i18n-translations.js` contains the English catalog keyed by the original Thai interface text. Add a catalog entry when adding new Thai interface text. Keep API enums, route names, IDs and user-authored values separate from translations.

Application scripts use `__apText` for fixed strings and `__apHtml` for templates. The template helper translates only static template segments and leaves interpolated values unchanged. Continue escaping user content with the existing HTML escape helper before interpolation.

Use `APFormsI18n.message` for known server messages. The catalog's message patterns retain dynamic field names or identifiers while translating the fixed message text. Use `APFormsI18n.labels` for cached role or type labels that must follow later language changes.

Each workspace registers a render handler with `APFormsI18n.register`. Preserve its working state while redrawing, and avoid side effects such as submitting an answer or creating a record from a language-change handler.

## Check a translation change

Run `npm test` and `npm run check:build` from `app`. Check both languages on the affected screen, including long labels and mobile widths. Test unsaved input, authored text that matches an interface label, and the completed response screen to catch unwanted translation or duplicate submission.

[Development](development.md) · [User guide](user-guide.md)
