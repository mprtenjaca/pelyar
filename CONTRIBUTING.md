# Contributing to Pelyar

Thanks for helping. This page covers how to run Pelyar from a clone, what to check before a pull
request, and the few rules the code follows.

## Getting started

```sh
git clone https://github.com/mprtenjaca/pelyar.git
cd pelyar
claude --plugin-dir plugins/pelyar
```

That session loads your working copy. After each edit, run `/reload-plugins`, then open the panel with
`/pelyar`. If you also have the published Pelyar installed, disable it first
(`claude plugin disable pelyar@pelyar`), or you get two panels.

## Before you open a pull request

```sh
claude plugin validate plugins/pelyar
claude plugin test plugins/pelyar
```

Both must pass. Once a session has loaded the mod, the engine writes its type declarations to
`plugins/pelyar/.claude-plugin/types/`. After that, check the types too:

```sh
npx -p typescript tsc -p plugins/pelyar
```

Then try the change in a real session. The tests draw the panel against mocks, so they can't show you
how it looks in a terminal or how a real server answers.

## How the code is laid out

- `hooks/register.tsx` is the only file that talks to the engine (`$`). The engine follows `$` only within
  that file, so every hook, every state atom and every call to a server, a process or the file system
  lives there.
- Every other module in `hooks/` is plain code with no engine calls: parsing, selection, formatting.
  That is where most logic belongs, and it is the easiest to test.
- `types/index.d.ts` is the state contract. Each `$.state` value the module uses is declared there.
- `skills/` holds the skills that ship with the plugin, plain markdown.
- `tests/panel.test.ts` builds a small world (commands, files, MCP servers, `gh`, `glab`) and draws the
  panel through it.

## Adding a source

A new PR or ticket source (another forge, another tracker) follows the pattern of the existing ones:

1. A parser in a plain module, from the source's own answer to `PullRequest` or `Issue`.
2. A fetch in `register.tsx`:
   - for an MCP tool, `callMcp`, which finds whichever connected server has the tool;
   - for a CLI, `runForgeCli`, which tells "not installed or not logged in" apart from a real failure.
3. The source added to `PrSource` or `TicketSource`, to the `auto` list in `settings.ts`, and to the
   option list in `plugin.json`.
4. Tests:
   - one where the source answers;
   - one where it isn't set up, where `auto` leaves it out without a word;
   - one where it fails, where the panel names the source and the reason.
5. A row in the README's Setup table, with what the source needs, and its made-up data in
   `hooks/demo.ts` if the demo should show it.
6. The source in `skills/setup/SKILL.md`, which Claude follows to set Pelyar up:
   - how to check that it is there (step 1);
   - how to connect it (step 3);
   - its setting keys (step 4);
   - its MCP tools, for the allow rules (step 5).

If the source's answer isn't documented, say so in the README and read it leniently, as the Linear
parser does.

## Rules the code follows

- **No secrets, company data or real names.** Not in code, tests or fixtures. Tests use made-up
  data: `acme/web`, `PROJ-123`, `example.atlassian.net`, people called Sam, Alex and Robin.
- **Read-only feeds.** The dashboard only reads from servers. Anything that writes (a merge, a
  transition, a comment) is something the person asks Claude for, not something the panel does on a
  timer.
- **Not set up is not an error.** A part whose source isn't there says `not connected` quietly. A
  real failure names the source and the reason, and retries with a back-off.
- **Everything optional can be switched off**, and a part that is off reads nothing.
- **Comments say why, not what.** Match the density and wording of the code around your change.
- **Settings have defaults that work** for someone who has set nothing up. A part that needs
  something unusual (Mail, Team) is off by default.

## Commits and pull requests

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) with a scope:
  `feat(tickets): read GitLab issues`, `fix(prs): keep the same number from two sources apart`.
- One topic per pull request. Say what changed, why, and how you tried it (tests, and a real session
  with which sources).
- Update the README when a setting, a source or the setup changes.

## License

By contributing, you agree that your contributions are licensed under the MIT License, the same as
the rest of the project.
