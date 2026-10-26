---
name: adr
description: Record a decision as a numbered ADR in docs/decisions/, with its context, the options considered and the trade-offs. Use when the user runs /adr or asks to write a decision down, and offer it after a choice someone could question.
argument-hint: <what was decided>
---

Write an ADR for: $ARGUMENTS

1. Number it one above the highest in `docs/decisions/`, zero-padded to four digits.
2. Name the file `docs/decisions/NNNN-short-slug.md`, and copy the shape of the latest ADR: a `# N. Title` heading, the Status and Date lines, then Context, Decision and Consequences.
3. Context says what forced the choice and which options were on the table. Consequences lists the good and the bad, including what gets harder. These are the parts people will question.
4. Keep it under a page, in plain words.
5. Add it to the Decisions list in `README.md`, and link it from its roadmap item if it has one.
