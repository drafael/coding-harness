# Sentence and procedure style

Use this reference for procedures, substantial line editing, or text that readers can plausibly interpret in more than one way.

The guidance combines compatible ideas from Google developer style, Simplified Technical English, and Global English. Apply it to improve a specific sentence, not to maximize rule compliance.

## Address the reader and name the actor

Use “you” when the document tells the reader what to do or what they can observe. Use present tense for current behavior. Name the component that performs an action when responsibility matters.

- Clear ownership: “The gateway validates the token before the service writes the record.”
- Unclear ownership: “The token is validated before the record is written.”

Passive voice is appropriate when the actor is unknown, irrelevant, or already obvious. Keep it when naming the actor would distract from the useful fact.

## Write actionable procedures

Give each procedural step a clear imperative action. Put any condition that determines whether the step applies before that action. Use numbered lists for ordered steps and bullets for unordered choices or facts.

Keep one action per step when readers must observe, verify, or recover between actions. Closely coupled interface actions may remain together when separating them would make the instruction harder to follow.

Put prerequisites and safety conditions before the action they govern:

- “If the migration has started, wait for it to finish before restarting the service.”
- Not: “Restart the service after checking whether the migration has started.”

State expected results after important steps. Give exact output only when it is stable and verified. When output varies, identify the stable signal the reader should look for.

Add failure and recovery guidance where a likely failure would otherwise leave the reader blocked or risk data, availability, or security. Do not catalogue hypothetical failures without evidence that readers can encounter them.

## Make relationships unambiguous

Keep limiting words close to the words they modify. Moving “only,” “not,” or “also” can change the meaning.

Repeat a noun when a pronoun could refer to more than one thing. Avoid using “this,” “it,” “they,” or “which” when readers must look backward to decide what the word means.

Break dense noun strings into relationships:

- “the script that validates the import budget”
- instead of “the import budget validation script,” when the shorter phrase can be parsed several ways.

Keep articles and linking words when they reveal structure. “Remove the backup file” and “ensure that the switch is off” may be clearer than compressed alternatives.

Make coordination explicit when “and” or “or” can group items in more than one way. Rewrite the sentence rather than relying on punctuation to repair an unclear relationship.

## Use stable terminology

Call one thing by one name throughout the document unless the system itself exposes distinct names that readers must understand. Use actual symbols, file names, flags, commands, and configuration keys rather than approximate synonyms.

Define an unfamiliar abbreviation or domain term at first use when the intended reader cannot be expected to know it. Do not replace a precise technical term merely because a shorter or more common word exists.

Avoid invented metaphors and figurative names that obscure the mechanism. A recognized pattern name is useful when the document states what the pattern means in this context.

## Prefer direct, economical sentences

Use plain verbs and remove phrases that do not change meaning. Replace nominalizations when a direct verb states the same fact more clearly.

- “The client retries the request.”
- Not: “The client performs a retry of the request.”

Keep one main thought per sentence when combining thoughts forces the reader to backtrack. Sentence length is a warning signal, not a quota. A longer sentence can be correct when it expresses one relationship with a necessary condition or consequence.

Vary sentence length naturally. Repeated clipped sentences can hide relationships and sound mechanical. Do not trade precision for fewer words.

## Structure headings and lists

Use sentence case for headings. Make headings specific enough to support scanning and linking.

- Use a verb phrase for a task: “Configure request retries.”
- Use a noun phrase for a concept: “Retry behavior.”

Maintain a consistent heading hierarchy without skipped levels. Use one page title unless the target format has a different established convention.

Introduce a list with a complete sentence. Keep list items grammatically parallel and use the natural number of items. Do not force a list when a sentence is easier to understand.

## Diagnose instead of ban

Review passive voice, long sentences, parentheses, semicolons, dashes, slashes, abbreviations, and `-ing` forms when a sentence is difficult. None is an automatic defect.

Keep punctuation that exposes the intended grammar. Replace it only when a sentence or list would express the relationship more clearly. Do not create a stilted sentence merely to comply with a style preference.

## Sources

- [Google developer documentation style guide](https://developers.google.com/style)
- [Google guidance on active voice](https://developers.google.com/style/voice)
- [Google guidance on procedures](https://developers.google.com/style/procedures)
- [Google guidance on headings and titles](https://developers.google.com/style/headings)
- [ASD-STE100 Issue 9](https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf)
- John R. Kohl, *The Global English Style Guide*, [SAS sample chapter](https://support.sas.com/publishing/pubcat/chaps/60751.pdf)
