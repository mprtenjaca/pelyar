export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

// The model and effort the engine actually sent with the last model request.
export type LastStep = { model: string; effort: string | null }

// What was picked in the card and not yet seen in a model request; shown as active until then.
export type Chosen = { model: string | null; effort: string | null }

// A press that needs a second press to go through: which control, when it was armed, until when,
// and what was said.
export type Armed = { key: string; at: number; until: number; message: string }

// Which session commands already ran in this conversation (reset by /clear).
export type Ran = { catchup: boolean; wrapup: boolean }

// The branch the session's checkout is on, the ticket its name carries (a key such as PROJ-12, or an
// issue number such as #12 on GitHub or GitLab), and that ticket as its tracker has it.
export type Ticket = {
  branch: string
  // The checkout's folder name, as the status line shows it.
  repo: string | null
  key: string | null
  summary: string
  status: string
  category: string
  url: string
  error: string | null
}

// The skills of the developer's team, found when the panel opens, each a row that can be started:
// the command it runs, where it came from (the marketplace or the plugin), and whether it also loads
// itself when its description matches the task (a context skill, no `command:` line).
export type TeamSkill = { name: string; label: string; description: string; source: string; auto: boolean }
export type TeamSkills = { entries: TeamSkill[] }

// ---- The dashboard's feeds.

// Where a pull request comes from: GitHub through the gh CLI, GitLab through the glab CLI, Bitbucket
// Data Center through an MCP server.
export type PrSource = 'github' | 'gitlab' | 'bitbucket'

// Where a ticket comes from: Jira and Linear through their MCP servers, GitHub and GitLab issues
// through gh and glab.
export type TicketSource = 'jira' | 'linear' | 'github' | 'gitlab'

export type Review = {
  slug: string
  status: string
  lastReviewedCommit: string
}

export type PullRequest = {
  // Unique across sources and repositories: `<source>:<repo>#<id>`.
  key: string
  source: PrSource
  id: number
  repo: string
  title: string
  url: string
  author: string
  authorSlug: string
  latestCommit: string
  reviews: Review[]
  approvals: number
  reviewers: number
  isNeedsWork: boolean
  isConflicted: boolean
  isDraft: boolean
  // The source itself says it can be merged (GitLab's detailed_merge_status), whatever the approvals.
  isMergeable: boolean
  // Open Bitbucket tasks; always 0 elsewhere.
  openTasks: number
  // 'FAILED' when the build or the checks failed (Bitbucket's quality gate, GitHub's status checks,
  // GitLab's pipeline or status checks).
  qualityGate: string
}

// Who reads the panel, per source (the Bitbucket slug, the GitHub or GitLab login); null where not known.
export type Me = Partial<Record<PrSource, string | null>>

export type PullRequestFeed = {
  mine: PullRequest[]
  reviewing: PullRequest[]
  me: Me
  // The sources that answered this read; a change is only said for a source that answered both times.
  // Missing in a feed kept from before it was added.
  sources?: PrSource[]
  fetchedAt: number
}

export type Pomodoro = {
  phase: 'idle' | 'focus' | 'break'
  endsAt: number | null
  pausedRemainingMs: number | null
  completed: number
  day: string
}

export type Todo = {
  number: number
  line: number
  text: string
  isDone: boolean
}

export type UnreadMail = {
  id: string
  from: string
  subject: string
}

export type Meeting = {
  subject: string
  start: number
  end: number
  isUnanswered: boolean
}

export type MailFeed = {
  unread: UnreadMail[]
  meetings: Meeting[]
  fetchedAt: number
}

// A ticket on the list. `category` is Jira's status category, the others mapped onto it: 'new' (not
// started), 'indeterminate' (under way), 'done'.
export type Issue = {
  source: TicketSource
  key: string
  summary: string
  status: string
  category: string
  url: string
}

// The todo file as last read: its lines, or why it could not be read.
export type TodoFile = { lines: string[]; problem: string | null }

export type IssueFeed = {
  issues: Issue[]
  // As in PullRequestFeed.
  sources?: TicketSource[]
  fetchedAt: number
}

export type NowPlaying = {
  // 'off' while no music app the panel reads is running.
  state: 'off' | 'stopped' | 'paused' | 'playing'
  // The app the track comes from (Spotify, or Music for Apple Music); empty while off.
  app: string
  title: string
  artist: string
  positionMs: number
  durationMs: number
  fetchedAt: number
}

// Another Claude Code session on this machine, from its file in the config dir's sessions folder.
export type ClaudeSession = {
  pid: number
  sessionId: string
  name: string
  cwd: string
  // 'interactive' for a terminal session.
  kind: string
  // 'busy' while it works on a turn, 'idle' while it waits for a prompt.
  status: string
  statusSince: number
  startedAt: number
  procStart: string
}

declare module 'claude-code' {
  interface PluginState {
    pelyar: {
      isOpen: boolean
      revision: number
      lastStep: LastStep | null
      chosen: Chosen
      isBusy: boolean
      armed: Armed | null
      ran: Ran
      pending: string | null
      team: string | null
      // The team plugin the team's name was taken from, when no git config named it (else null).
      teamGuessedFrom: string | null
      // Whether this terminal's own background is light; null when it cannot say.
      terminalLight: boolean | null
      // What the last team refresh saw, and what the "why?" check found (null while not shown).
      teamTrace: string[]
      teamDiagnosis: string[] | null
      openEntry: string | null
      // The commands pinned under Work (full names, kept in the plugin store too), whether the ＋
      // search is open, and what is typed into it.
      pinned: string[]
      pinOpen: boolean
      pinQuery: string
      ticket: Ticket | null
      teamSkills: TeamSkills
      // Which sections are folded; kept in the plugin store too, so the choice outlasts the session.
      folded: string[]
      // The dashboard: the context fill and the nudge level it reached, the pomodoro round, the clock
      // the timers and "in 12m" are drawn from, and each feed with the error of its last read.
      contextPercent: number | null
      nudgeLevel: number
      pomodoro: Pomodoro
      now: number
      prs: PullRequestFeed | null
      prsError: string | null
      issues: IssueFeed | null
      issuesError: string | null
      mail: MailFeed | null
      mailError: string | null
      spotify: NowPlaying | null
      spotifyError: string | null
      sessions: ClaudeSession[] | null
      sessionsError: string | null
      todos: TodoFile | null
      // SETUP_STORE_KEY's value, read at the start (state.ts).
      setup: string | null
    }
  }
}
