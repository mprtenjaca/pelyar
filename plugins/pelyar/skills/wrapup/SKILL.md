---
name: wrapup
description: Save where a session stands before /clear, so the next session can pick it up with /pelyar:catchup. Updates the status, next step and recent decisions in the project's CLAUDE.md, archives finished stories, writes a record for a decision or design worth keeping, and commits CLAUDE.md when it is tracked. Use when asked to wrap up, save the session, or before clearing the conversation.
argument-hint: "[no-commit]"
---

# Wrapup

The conversation is about to be cleared. Write down what the next session needs in the project's
`CLAUDE.md` and, for anything longer, in a record. The next session starts from these files alone,
with `/pelyar:catchup`.

Arguments: $ARGUMENTS

## Steps

1. **Status and next step.** In the project's `CLAUDE.md`:
   - update the **Current Status** table: one row per story, with its status (Open, In Progress, Done)
     and a short note;
   - rewrite **Next Step** as one concrete action the next session can start on.

   If `CLAUDE.md` does not exist, create it. If it has no such sections, add them near the top:

   ```markdown
   ## Current Status

   | Story | Status | Notes |
   |-------|--------|-------|

   **Next Step:** ...

   ## Recent Decisions

   | Date | Decision | Why |
   |------|----------|-----|
   ```

2. **Archive what is done.** Remove the rows whose status is Done from Current Status. Their history
   stays in git and in the records; the table only shows what is still open.

3. **Prune Recent Decisions.** Remove an entry when:
   - a record already explains it in full;
   - a later decision replaced it;
   - it only mattered to a story that is now done.

   Keep what a later session, working on something else, would still need to know.

4. **Missed decisions.** Look back over this session. A decision belongs in Recent Decisions when there
   was a real alternative, the reason isn't obvious, it will still matter later, and it affects the
   project rather than a single line of code. Add any that are missing, with today's date.

5. **Records.** When this session settled a design or a decision that takes more than a few lines to
   explain, write it to `docs/records/NNN-short-title.md`, numbered after the highest existing record.
   Start the record with its status on a line of its own (`Designing`, `Designed`, `In Progress` or
   `Done`), so `/pelyar:catchup` finds the ones still open. Point to it from Current Status or Next Step
   while it is relevant.

6. **Other sections.** Update `## Development` (commands), `## Files` (layout) or `## Architecture`
   only when this session really changed what they describe, and only if `CLAUDE.md` already has them.
   Leave a section that only holds a placeholder alone unless there is real content for it now. Keep
   each change short; details belong in a record.

7. **Commit.** Skip this step when the arguments say `no-commit`, when the project is not a git
   repository, or when the person's own instructions say not to commit without asking (then ask).
   Otherwise:
   - when `CLAUDE.md` is tracked (`git ls-files --error-unmatch CLAUDE.md` succeeds), stage
     `CLAUDE.md` and `docs/records/` and commit them as `docs: update project status`, following the
     project's own commit message convention if it has one;
   - when `CLAUDE.md` is not tracked (kept private), commit only new or changed records, if any.

   Don't stage anything else.

8. **Summary.** Say briefly what changed in `CLAUDE.md`, which records were written, and what was
   committed. End with: run `/clear`, then `/pelyar:catchup` in the next session.

## Rules

- Anything between `<!-- PROJECT INSTRUCTIONS START -->` and `<!-- PROJECT INSTRUCTIONS END -->` in
  `CLAUDE.md` is written by people for people: never change it.
- Don't rewrite sections for style. Only change what this session made out of date.
- `docs/notes/*.open.md` are the person's own notes: read them if useful, never edit or delete them.

<!-- Adapted from the /wrapup command of claude-code-setup by Graziano Felline (b33eep),
     https://github.com/b33eep/claude-code-setup, MIT License. Notice in LICENSE. -->
