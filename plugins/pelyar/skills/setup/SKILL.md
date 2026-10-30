---
name: setup
description: Set up the Pelyar panel. Finds which of its sources this machine already has (the GitHub and GitLab CLIs; Jira, Linear, Bitbucket and mail MCP servers), asks which parts the person wants, walks them through connecting the missing ones, switches the parts on or off in Pelyar's settings and adds the allow rules auto mode needs. Use right after Pelyar is installed, when its panel says "not connected" or "auto mode refused", or when asked to set up, configure or connect Pelyar.
---

# Set up Pelyar

Pelyar's panel reads each part from a source the person already has. It connects to nothing by itself
and stores no credentials. This skill:

1. finds out what is there;
2. asks what the person wants;
3. sets up the rest with them.

Change nothing before the person has said what they want, and show every change to their settings
before you make it.

## 1. Find what is there

Check all of these, without asking, in parallel where you can.

| Part | Source | How to check |
|---|---|---|
| PRs, issues on GitHub | the `gh` CLI | `gh auth status`: exit 0 is logged in, "command not found" is not installed. It also lists the hosts, a GitHub Enterprise one included. |
| Merge requests, issues on GitLab | the `glab` CLI | `glab auth status`, the same way. |
| PRs on Bitbucket Data Center | an MCP tool `bitbucket_getDashboardPullRequests` | Your own tool list. |
| Jira tickets | MCP tools `searchJiraIssuesUsingJql` and `getAccessibleAtlassianResources` | Your own tool list. |
| Linear tickets | MCP tools `list_issues` and `get_issue` on a Linear server | Your own tool list. |
| Mail and meetings | MCP tools `list_recent_emails` and `list_calendar_events` | Your own tool list. |
| Music, the pomodoro's notification | macOS | `uname` answers `Darwin`. |
| Music (Spotify only) | Windows | `OS` is `Windows_NT`, and Spotify's desktop app is installed. |

How to read your own tool list:
- An MCP tool is named `mcp__<server>__<tool>`. A tool listed by name only (a deferred tool) counts.
- A server that offers only `authenticate` and `complete_authentication` is added but not logged in.

Also read:
- **Pelyar's install key**, `pelyar@<marketplace>`, from `claude plugin list`.
- **Its current settings**, under `pluginConfigs["<install key>"].options` in `~/.claude/settings.json`.
  A key that is missing has its default (table in step 4).
- **The allow rules**, under `permissions.allow` in `~/.claude/settings.json`, and in the project's
  `.claude/settings.json` and `.claude/settings.local.json` if they exist.

Settings files often hold secrets as well (`env` values, `apiKeyHelper`). Never read one whole: read only
these two keys, for example
`jq '{options: .pluginConfigs["<install key>"].options, allow: .permissions.allow}' ~/.claude/settings.json`.

## 2. Ask what the person wants

First show a short table: each part, and whether its source is there.

Pomodoro, the context meter, Catchup/Wrapup/Clear, Model and effort, the todo list and the Claude
sessions list need no setup. Say that they work, and which of them the settings you read switch off.

Then ask with AskUserQuestion, multiSelect, which of these the person wants: **Pull requests**,
**Tickets**, **Mail and calendar**, **Music player**.

If the answer leaves it open, ask one more question: which forge or tracker they use. Pull requests:
GitHub, GitLab, Bitbucket Data Center. Tickets: Jira, Linear, GitHub issues, GitLab issues. Don't ask
what step 1 already answered.

## 3. Connect what is missing

Only the sources the person wants and does not have yet.

Never ask for a token or a password, and never write one into a file or a command yourself. Every
login, and every command that carries a secret, runs **in a separate terminal window**, which the person
opens themselves. Never suggest the `!` prefix for these: a `!` command and its output become part of
this conversation, a token typed into it included, and the login prompts need a real terminal anyway.
Ask before you install anything.

- **GitHub.**
  1. Install: `brew install gh` on macOS, else https://cli.github.com.
  2. Log in, in a separate terminal: `gh auth login`. For GitHub Enterprise: `gh auth login --hostname <host>`.
     When it asks "Authenticate Git with your GitHub credentials?", No keeps the person's git
     configuration as it is; Pelyar only needs `gh` itself.
  3. Check: `gh auth status`.
- **GitLab.**
  1. Install: `brew install glab`, else https://gitlab.com/gitlab-org/cli.
  2. Log in, in a separate terminal: `glab auth login`. For a self-managed GitLab: `--hostname <host>`.
  3. Check: `glab auth status`.
- **Jira.** Atlassian's connector:
  1. In claude.ai: Settings → Connectors → Atlassian.
  2. In Claude Code: `/mcp`, to log in.

  Any other MCP server that offers both Jira tools works too.
- **Linear.** Linear's MCP server: the Linear connector in claude.ai (Settings → Connectors), or the
  server https://linear.app/docs/mcp describes. Then `/mcp` to log in.
- **Bitbucket Data Center.** The npm package `@atlassian-dc-mcp/bitbucket`.
  1. In a separate terminal, the person runs `npx @atlassian-dc-mcp/bitbucket setup`. It asks for the
     host and a personal access token, and keeps the token in the macOS Keychain (elsewhere in a file
     only they can read).
  2. Then add the server at user scope. This command carries no secret, so you may run it, after
     asking: `claude mcp add --scope user bitbucket -- npx -y @atlassian-dc-mcp/bitbucket`.
  3. A server added this way is loaded by the next session.
- **Mail.** There is no standard mail tool. Pelyar reads any MCP server that has both mail tools and
  answers in the shapes the README describes under *Mail*. If no server has them, say so plainly:
  Mail stays off.
- **Music.** macOS, and Spotify on Windows. The first time the panel reads Spotify or Music, macOS asks
  whether Claude Code may control it; the person allows it. Later in System Settings → Privacy & Security → Automation.
  On Windows nothing is asked: the panel reads Spotify through the system media controls once its
  desktop app runs. Apple Music has no Windows app, so `musicPlayer: music` shows nothing there.

After each one, check that it is there now: run the CLI's `auth status`, or look in `/mcp` and your
tool list.

## 4. Switch the parts on or off

Pelyar's settings live in `~/.claude/settings.json`, under `pluginConfigs["<install key>"].options`.

1. Write only the keys that change. Keep `auto` for the sources unless the person wants exactly one.
2. Switch off a part the person does not want: a part that is off reads nothing.
3. Show the change, get a yes, then write it.

The person can make the same changes themselves, with `/plugin configure <install key>` or the panel's
⚙ Settings.

| Key | Default | Values |
|---|---|---|
| `title` | empty | the panel's title; empty is "Pelyar" |
| `background` | `none` | `none`, `slate`, `graphite`, `midnight`, `espresso`, `moss` |
| `showContext` | `true` | the context meter and its nudge |
| `showSessionCommands` | `true` | the Catchup, Wrapup and Clear buttons |
| `showModel` | `true` | the model and effort chips |
| `showTodos` | `true` | the todo list |
| `showCommands` | `true` | the commands under Work |
| `showPrs`, `showReviewPrs` | `true` | My PRs, Other PRs |
| `prSource` | `auto` | `auto`, `github`, `gitlab`, `bitbucket` |
| `githubHost`, `gitlabHost` | empty | empty for github.com, or the host glab is logged in to; else a GitHub Enterprise or self-managed GitLab host |
| `showTickets` | `true` | the ticket list |
| `ticketSource` | `auto` | `auto`, `jira`, `linear`, `github`, `gitlab` |
| `jiraSite` | empty | `example.atlassian.net`; empty takes the first site the Atlassian server reaches |
| `jiraQuery` | empty | a JQL query; empty is the person's open tickets, latest first |
| `showMail` | `false` | Mail and calendar |
| `showSpotify` | `true` | the music player |
| `musicPlayer` | `auto` | `auto`, `spotify`, `music` |
| `showTicket` | `true` | the branch's ticket row |
| `showPomodoro`, `pomodoroSound` | `true` | |
| `pomodoroLength` | `25/5` | `25/5`, `45/15`, `50/10` |
| `showSessions` | `true` | the other Claude Code windows |
| `showTeam` | `false` | the skills of a team plugin, see the README's *Team skills* |
| `teamPrefix` | empty | the team plugin's prefix; empty is `team-` |
| `teamMarketplace` | empty | the marketplace named in the install hint |
| `catchupCommand`, `wrapupCommand` | empty | empty runs `/pelyar:catchup` and `/pelyar:wrapup` |
| `wrapupCommit` | `true` | whether `/pelyar:wrapup` commits `CLAUDE.md` |

## 5. Allow rules for auto mode

The panel reads its MCP tools on a timer, not because of a prompt. In auto mode such a call is
refused unless an allow rule names the tool, and the panel then says
`auto mode refused: allow the tool in /permissions`. The CLIs (`gh`, `glab`, `git`) need no rule.

1. Ask whether the person uses auto mode, unless that is already clear.
2. If so, build one rule per tool Pelyar will use: `mcp__<server>__<tool>`. Take `<server>` from your
   own tool list, where it already has the right form: every character other than a letter, digit,
   `-` or `_` is replaced by `_`. Example: the server `claude.ai Atlassian` gives
   `mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql`.
3. Add only the rules that are missing to `permissions.allow` in `~/.claude/settings.json`. Show them
   first.

| Part | Tools |
|---|---|
| Jira | `searchJiraIssuesUsingJql`, `getAccessibleAtlassianResources` |
| Linear | `list_issues`, `get_issue` |
| Bitbucket | `bitbucket_getDashboardPullRequests` |
| Mail | `list_recent_emails`, `list_calendar_events` |

All of them only read.

## 6. Check and sum up

1. Ask the person to run `/reload-plugins` (a server added with `claude mcp add` needs a new session
   instead), then to open the panel with `/pelyar` and press ↻ Refresh.
2. Each part shows its items, or "none". What a part's line says otherwise:
   - `not connected`: the source is still missing;
   - `auto mode refused`: an allow rule is missing;
   - anything else: an error from the source itself. Ask the person what the line says.
3. Sum up in a few lines: which parts are on and read from where, which are off, and what is still
   missing. End with: `/pelyar:setup` again, or ⚙ Settings in the panel, changes it later.
