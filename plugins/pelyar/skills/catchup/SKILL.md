---
name: catchup
description: Get back up to speed on a project after /clear or in a new conversation. Reads the README, the recent commits and uncommitted changes, the status, next step and recent decisions in the project's CLAUDE.md, the records the current work refers to and the open session notes, then sums up where things stand. Use at the start of a session, or when asked to catch up or resume work.
---

# Catchup

A new conversation knows nothing about the work so far. Rebuild that picture from what the project
keeps on disk, then give a short summary. Read, don't change anything.

## Steps

1. **What the project is.** Read `README.md` in the project root if there is one.

2. **What changed lately.** In a git repository:
   - `git log --oneline -10` for the last commits, and `git diff --name-only HEAD~10` for the files they
     touched (fewer commits if the history is shorter);
   - `git status --short` for work that is not committed yet.

   Open the changed files that matter for the current work. Skip lock files, generated files and
   formatting-only changes.

3. **Where the work stands.** In the project's `CLAUDE.md`, read:
   - the **Current Status** table: which stories are open or in progress;
   - **Next Step**: what the last session said to do next;
   - **Recent Decisions**: choices made earlier, with their reasons. Keep those in mind and don't
     undo one without saying so;
   - the **Future** or backlog table, if there is one.

   If `CLAUDE.md` has none of these sections, say so, and mention that `/pelyar:wrapup` creates them
   at the end of a session.

4. **Records.** Records are the longer write-ups of decisions and designs in `docs/records/`.
   - Read every record the Current Status, Next Step or Future table points to.
   - Look for records still being worked on: `grep -l -E "^(Designing|Designed|In Progress)" docs/records/*.md`.
     Read those too.
   - Read only records that bear on the current or next piece of work, not the whole folder.

5. **Open notes.** Private session notes live in `docs/notes/` and end in `.open.md` while they are
   current. Read each one and keep its main points: research done, an approach being tried, loose ends.

6. **Summary.** Answer briefly, in this order:
   - what changed recently (commits and uncommitted work);
   - which records were read, and why each one;
   - the main points of the open notes, if there were any;
   - the next step according to `CLAUDE.md`, or, without one, what the changes suggest comes next.

Then wait for the person to say what to work on.

<!-- Adapted from the /catchup command of claude-code-setup by Graziano Felline (b33eep),
     https://github.com/b33eep/claude-code-setup, MIT License. Notice in LICENSE. -->
