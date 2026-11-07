# Spoken match entry

In Matches, unlock the editor and choose **Speak result**. The browser requests
microphone permission when needed. Recognition is one-shot, in English, with a
15-second timeout. Audio may be processed by the browser's speech service; the
club app does not upload or store audio. Recognition availability varies by
browser. **Type a result instead** uses the same parser without a microphone.

Examples:

- “Sharan won against Alok, nine to one.”
- “Sharan 1 against Alok 9-1” (a common won/one transcription).
- “Alok lost to Sharan, one to nine.”
- “Sharan and Vachan against Cody and Alok, twenty-one to nineteen.”

Scores follow the order of the two named sides. Explicit “won”/“lost” statements
must agree with the score. A neutral “against”/“versus” statement can put either
side first. Singles and doubles are selected automatically from the team sizes.

Names are resolved only against the current active roster, using full names,
first names, last names, spelling distance and simple phonetic similarity. The
browser's alternative transcripts are also checked. Ambiguous names such as
“Ethan” require a roster selection. Unrecognized names can be chosen manually;
duplicate or inactive participants are rejected. This matching happens after
transcription; the speech service itself is not restricted to the roster.

The result only fills a draft and updates the existing rating preview. It never
saves a match. The admin reviews the fields and presses **Save match result**.
The transcript remains editable through **Edit transcript**. Listening stops on
navigation, locking, submission, hiding the tab, or explicit cancellation. A
voice result cannot automatically overwrite a form edited while listening.

Validation: parser and microphone lifecycle tests use synthetic recognition
events. Browser checks cover simulated speech, spelling variations, ambiguous
names, manual transcription correction and doubles. Actual acoustic recognition
depends on the user's microphone, pronunciation and browser speech service.

API reference: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
