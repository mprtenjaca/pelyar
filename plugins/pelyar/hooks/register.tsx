import { atom, read, update } from 'claude-code'
import type { ConfigRow, EngineInterface, Register, RenderChildren, Timer } from 'claude-code'

import type {
  Armed,
  Chosen,
  ClaudeSession,
  Issue,
  IssueFeed,
  LastStep,
  MailFeed,
  Me,
  Meeting,
  NowPlaying,
  Pomodoro,
  PrSource,
  TicketSource,
  PullRequest,
  PullRequestFeed,
  Ran,
  TeamSkill,
  TeamSkills,
  Ticket,
  TodoFile,
} from '../types'
import { COMMAND, EFFORTS, type Entry, GENERAL, MODELS, OWN_SETUP, OWN_WRAPUP, SESSION, type SessionRow } from './catalog'
import {
  approvalTargetsOf,
  approversOf,
  glabArgv,
  GITLAB_MINE,
  GITLAB_REVIEWING,
  GITLAB_USER,
  gitlabApprovals,
  gitlabApprovedBy,
  idsOf,
  isGlabLoggedOut,
  parseMergeRequests,
  usernameOf,
} from './gitlab'
import * as demo from './demo'
import * as issueFeed from './issues'
import * as jiraFeed from './jira'
import * as mailFeed from './mail'
import * as pomodoroClock from './pomodoro'
import {
  changesBetween,
  githubArgv,
  myReviewOf,
  parseGithubPullRequests,
  parsePullRequests,
  reviewChangesBetween,
  sortForReview,
  statusOf,
  ticketOf,
} from './pull-requests'
import * as claudeSessions from './sessions'
import {
  isLightThemeName,
  readsPrs,
  type Settings,
  settingsOf,
  TODO_FILE,
  USUAL_BITBUCKET_SERVERS,
  USUAL_JIRA_SERVERS,
  USUAL_LINEAR_SERVERS,
  USUAL_MAIL_SERVERS,
} from './settings'
import { backgroundArgv, isLightBackground, isLightColorFgBg, TTY_SCRIPT } from './terminal'
import * as spotifyPlayer from './spotify'
import {
  CONFIRM_MIN_MS,
  CALENDAR_DAYS,
  CONFIRM_MS,
  FAST_POLL_MS,
  FEED_POLL_MS,
  FIRST_RETRY_MS,
  FOCUS_HOME,
  type Fold,
  FOLDED_BY_DEFAULT,
  FOLDED_STORE_KEY,
  isFold,
  MINUTE_MS,
  NUDGE_PERCENT,
  PANE,
  PIN_RESULTS,
  PINNED_STORE_KEY,
  POMODORO_STORE_KEY,
  SETUP_STORE_KEY,
  TEAM_STORE_KEY,
  POMODORO_TICK_MS,
  SPOTIFY_SETTLE_MS,
  SPOTIFY_TICK_MS,
  STALE_MS,
  STARTING_MS,
  URGENT_PERCENT,
} from './state'
import { INSTALLED_PLUGINS, type InstalledPlugin, installedTeamPluginsOf, type TeamCommand, teamCommandsOf, teamNameOfPlugin, teamPluginOf, teamPluginsOf } from './team'
import { issueOf, ticketKeyOf } from './ticket'
import { locateTodo, type OpenTodo, openTodosOf, TODO_LINE, TODO_MAX } from './todos'
import {
  errorTextOf,
  fit,
  isPermissionRefusal,
  labelOf,
  MissingTool,
  missingToolText,
  resolveCommand,
  retryLineOf,
  shortDescriptionOf,
  shortNameOf,
  ticketErrorOf,
  titleCase,
} from './util'

// PELYAR_DEMO=1: every feed shows made-up data from demo.ts and no source is asked; the todo list and
// the pinned commands are not read either, so a screenshot shows nothing of the person's own.
let isDemo = false

// git gets more time than the other calls: while a big build runs, starting it alone can take
// seconds. A team read that came up short is tried again after these pauses.
const GIT_TIMEOUT_MS = 15_000
const TEAM_RETRY_MS = [2_000, 5_000, 15_000] as const
// The commands after which the team's skills may have changed, and how long the session takes to list them.
const RELOADING_COMMANDS: readonly string[] = ['reload-plugins', 'plugin', 'plugins']
const RELOAD_SETTLE_MS = 3_000

// The panel's state, held by the host for the session (the engine reads these refs only in this file).
const isOpen = atom({ plugin: 'pelyar', key: 'isOpen' } as const, false)
const revision = atom({ plugin: 'pelyar', key: 'revision' } as const, 0)
const lastStep = atom({ plugin: 'pelyar', key: 'lastStep' } as const, null as LastStep | null)
const chosen = atom({ plugin: 'pelyar', key: 'chosen' } as const, { model: null, effort: null } as Chosen)
const isBusy = atom({ plugin: 'pelyar', key: 'isBusy' } as const, false)
const armed = atom({ plugin: 'pelyar', key: 'armed' } as const, null as Armed | null)
const ran = atom({ plugin: 'pelyar', key: 'ran' } as const, { catchup: false, wrapup: false } as Ran)
const pending = atom({ plugin: 'pelyar', key: 'pending' } as const, null as string | null)
const team = atom({ plugin: 'pelyar', key: 'team' } as const, null as string | null)
// Whether this terminal's own background is light; null when the terminal cannot say (Theme decides).
const terminalLight = atom({ plugin: 'pelyar', key: 'terminalLight' } as const, null as boolean | null)
const teamGuessedFrom = atom({ plugin: 'pelyar', key: 'teamGuessedFrom' } as const, null as string | null)
// What the last refresh of the team saw, line by line, and what the "why?" button found when pressed.
const teamTrace = atom({ plugin: 'pelyar', key: 'teamTrace' } as const, [] as string[])
const teamDiagnosis = atom({ plugin: 'pelyar', key: 'teamDiagnosis' } as const, null as string[] | null)
const openEntry = atom({ plugin: 'pelyar', key: 'openEntry' } as const, null as string | null)
const pinned = atom({ plugin: 'pelyar', key: 'pinned' } as const, [] as string[])
const pinOpen = atom({ plugin: 'pelyar', key: 'pinOpen' } as const, false)
const pinQuery = atom({ plugin: 'pelyar', key: 'pinQuery' } as const, '')
const ticket = atom({ plugin: 'pelyar', key: 'ticket' } as const, null as Ticket | null)
const teamSkills = atom({ plugin: 'pelyar', key: 'teamSkills' } as const, { entries: [] } as TeamSkills)
const folded = atom({ plugin: 'pelyar', key: 'folded' } as const, [...FOLDED_BY_DEFAULT] as string[])

// The dashboard. `nowAtom` is the clock the pomodoro, the track position and "in 12m" are drawn
// from: it moves once a second while something runs, once a minute otherwise.
const contextPercent = atom({ plugin: 'pelyar', key: 'contextPercent' } as const, null as number | null)
const nudgeLevel = atom({ plugin: 'pelyar', key: 'nudgeLevel' } as const, 0)
const pomodoro = atom({ plugin: 'pelyar', key: 'pomodoro' } as const, pomodoroClock.IDLE)
const nowAtom = atom({ plugin: 'pelyar', key: 'now' } as const, 0)
const prs = atom({ plugin: 'pelyar', key: 'prs' } as const, null as PullRequestFeed | null)
const prsError = atom({ plugin: 'pelyar', key: 'prsError' } as const, null as string | null)
const ticketList = atom({ plugin: 'pelyar', key: 'issues' } as const, null as IssueFeed | null)
const ticketListError = atom({ plugin: 'pelyar', key: 'issuesError' } as const, null as string | null)
const mail = atom({ plugin: 'pelyar', key: 'mail' } as const, null as MailFeed | null)
const mailError = atom({ plugin: 'pelyar', key: 'mailError' } as const, null as string | null)
const spotify = atom({ plugin: 'pelyar', key: 'spotify' } as const, null as NowPlaying | null)
const spotifyError = atom({ plugin: 'pelyar', key: 'spotifyError' } as const, null as string | null)
const sessions = atom({ plugin: 'pelyar', key: 'sessions' } as const, null as ClaudeSession[] | null)
const sessionsError = atom({ plugin: 'pelyar', key: 'sessionsError' } as const, null as string | null)
// Read here, not while drawing: the panel draws once a second while the pomodoro or a track runs.
const todoFile = atom({ plugin: 'pelyar', key: 'todos' } as const, null as TodoFile | null)
const setupState = atom({ plugin: 'pelyar', key: 'setup' } as const, null as string | null)

const CARD_WIDTH = 70
const PANE_COLUMNS = 72
const PANE_ROWS = 44
const LABEL_WIDTH = 10
const NAME_WIDTH = 17
// How far the rows under a section title are indented.
const ITEM_INDENT = 2
const METER_CELLS = 10
const BITBUCKET_TOOL = 'bitbucket_getDashboardPullRequests'
const JIRA_TOOL = 'searchJiraIssuesUsingJql'
const SITES_TOOL = 'getAccessibleAtlassianResources'
// gh answers 4 when nobody is logged in; with the source on auto that means "not set up here".
const GH_NOT_LOGGED_IN = 4
const CLI_TIMEOUT_MS = 30_000
const SOURCE_LABEL: Record<PrSource | TicketSource, string> = { github: 'GitHub', gitlab: 'GitLab', bitbucket: 'Bitbucket', jira: 'Jira', linear: 'Linear' }
// The sources read through an MCP server: their failures point at /mcp and /permissions.
const MCP_SOURCES: readonly string[] = ['bitbucket', 'jira', 'linear']
// The panel's text fields besides the per-command ones (`arg-<row>`): the todo list and the ＋ search.
const TEXT_FIELDS: readonly string[] = ['todo-input', 'pin-search']
// This plugin as /plugin names it, for the settings button.
const PLUGIN_ID = 'pelyar@pelyar'
const CLEAR_WARNING = 'Watch out: Clear drops this conversation. Run Wrapup first so nothing is lost. Press Clear again to clear.'
const MINE_COLOR = 'suggestion'
const OTHER_COLOR = 'merged'
const TICKET_COLOR = 'ide'
const SESSION_COLOR = 'claude'
const SPOTIFY_COLOR = 'success'
const BREAK_COLOR = 'success'
const MAIL_TOASTS = 2
// The player's controls; U+FE0E asks for the plain text glyph, not the emoji a terminal may draw.
// The player icons as text (U+FE0E), drawn bold so they read larger and all at the same brightness;
// one cell each with a space on either side, the same for Spotify and the pomodoro so their columns
// line up. All from one Unicode block (⏵ for play, not ▶), so the font draws them the same size.
const POMODORO_ICONS = { start: ' ⏵\uFE0E Start', pause: ' ⏸\uFE0E ', resume: ' ⏵\uFE0E ', skip: ' ⏭\uFE0E ', stop: ' ⏹\uFE0E ' } as const
const SPOTIFY_ICONS = { prev: ' ⏮\uFE0E ', pause: ' ⏸\uFE0E ', play: ' ⏵\uFE0E ', next: ' ⏭\uFE0E ' } as const
const isPlayerIcon = (text: string) => text.includes('\uFE0E')

const modelLabelOf = (id: string) => MODELS.find(model => id.startsWith(model.id))?.label ?? id
const effortRowOf = (rows: readonly ConfigRow[]) => rows.find(row => /effort/i.test(row.key) || /effort/i.test(row.label))
// The Panel title setting, else the mod's own name.
const titleOf = (configured: string | null) => configured ?? 'Pelyar'
const spaced = (text: string) => text.toUpperCase().split('').join(' ')

// The feeds keep 'red' / 'yellow' / 'green' (the counts compare on them); the panel paints them with
// the theme's status keys, so they follow the person's light or dark theme.
const TONE: Record<string, string> = { red: 'error', yellow: 'warning', green: 'success' }
const tone = (color: string | undefined): string | undefined => (color === undefined ? undefined : (TONE[color] ?? color))

export function nudgeLevelOf(percent: number): number {
  if (percent >= URGENT_PERCENT) return 2
  if (percent >= NUDGE_PERCENT) return 1
  return 0
}

// What the nudge suggests: the wrapup command (`/wrapup`) then /clear, or /compact without one.
export function nudgeTextOf(percent: number, level: number, wrapup: string | null): string {
  if (wrapup === null)
    return level === 2 ? `Context at ${percent}%: /compact or /clear now (auto-compact is close)` : `Context at ${percent}%: good moment to /compact or /clear`
  return level === 2
    ? `Context at ${percent}%: run ${wrapup} now, then /clear (auto-compact is close)`
    : `Context at ${percent}%: good moment to ${wrapup}, then /clear`
}

// The command a session row runs: the one the settings name, else Pelyar's own skill, else any command
// of that name. `isMissing` when the settings name a command this session does not have: the row stays
// and says so when pressed, rather than quietly running something else.
export type SessionCommand = { command: string; isMissing: boolean }
export function sessionCommandOf(row: SessionRow, settings: Settings, names: readonly string[]): SessionCommand | null {
  const configured = row.key === 'catchup' ? settings.catchupCommand : row.key === 'wrapup' ? settings.wrapupCommand : null
  if (configured !== null) {
    const found = resolveCommand(names, configured)
    return { command: found ?? configured, isMissing: found === undefined }
  }
  const found = row.candidates.map(short => resolveCommand(names, short)).find(name => name !== undefined)
  return found === undefined ? null : { command: found, isMissing: false }
}

// The wrapup command as the nudge names it (`/wrapup`), or null when the session has none.
function wrapupNameOf(settings: Settings, names: readonly string[]): string | null {
  const row = SESSION.find(item => item.key === 'wrapup')
  const found = row === undefined ? null : sessionCommandOf(row, settings, names)
  return found === null || found.isMissing ? null : `/${shortNameOf(found.command)}`
}

function meterOf(percent: number | null): string {
  if (percent === null) return '–'
  const filled = Math.round((Math.min(percent, 100) / 100) * METER_CELLS)
  return `${'▰'.repeat(filled)}${'▱'.repeat(METER_CELLS - filled)} ${percent}%`
}

function clockTimeOf(ms: number): string {
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

const firstNameOf = (displayName: string) => displayName.split(' ')[0] ?? displayName

const DIAGNOSIS_TITLE = 'How the team is read'

// A line cut into rows of at most `width`, at a space where one is near, else mid-word; a continued
// row keeps the line's own indent so the steps under "last refresh" stay lined up.
export function wrapRows(line: string, width: number): string[] {
  const indent = /^ */.exec(line)?.[0] ?? ''
  const rows: string[] = []
  let rest = line
  while (rest.length > width) {
    const space = rest.lastIndexOf(' ', width)
    const cut = space > indent.length + width / 2 ? space : width
    rows.push(rest.slice(0, cut).trimEnd())
    rest = `${indent}${rest.slice(cut).trimStart()}`
  }
  rows.push(rest)
  return rows
}

// What follows the word Pomodoro: the phase and the time left, `focus 23:41`, `break 04:12 paused`, `idle`.
function pomodoroLineOf(current: Pomodoro, time: number): string {
  if (current.phase === 'idle') return 'idle'
  const remaining = pomodoroClock.clockOf(pomodoroClock.remainingOf(current, time))
  return `${current.phase} ${remaining}${pomodoroClock.isPaused(current) ? ' paused' : ''}`
}

function spotifyLineOf(player: NowPlaying | null, time: number): string {
  if (player === null) return 'loading…'
  if (player.state === 'off') return 'not running'
  if (player.state === 'stopped') return 'stopped'
  const progress = spotifyPlayer.progressOf(player, time)
  return player.state === 'paused' ? `${progress} paused` : progress
}

function meetingColorOf(meeting: Meeting, time: number): 'green' | 'yellow' | undefined {
  if (meeting.start <= time) return 'green'
  if (meeting.start - time <= 10 * MINUTE_MS) return 'yellow'
  return undefined
}

// ---- Everything below reaches the engine through `$`, which the engine follows only within this
// file, so it cannot move to the other modules (they hold only plain code).

// The home directory, or null. Never a literal "~": the host would read it relative to the project
// and a todo would land in ./~/.claude/todos.md.
export async function homeOf($: EngineInterface): Promise<string | null> {
  const home = await $.env.get('HOME')
  return home === undefined || home === '' ? null : home
}

// The repository the session is in: the nearest directory, from the session's own upwards, that holds
// a .git (a folder, or a worktree's file); null outside one. Throws when the directory cannot be read.
async function repoRootOf($: EngineInterface): Promise<string | null> {
  let dir = await $.session.cwd()
  for (;;) {
    if (await $.fs.exists(`${dir}/.git`)) return dir
    const parent = dir.replace(/\/[^/]*$/, '')
    if (parent === dir || parent === '') return null
    dir = parent
  }
}

// One git config value, told apart three ways: found, unset (git said so), or not known (git did not
// answer: a timeout while the machine is busy, a spawn error). Only the last keeps what was known before.
type ConfigRead = { value: string | null; failure: string | null; via: string }

// git first; when git gives no answer, the config files themselves: the repository's, then ~/.gitconfig.
export async function configReadOf($: EngineInterface, key: string): Promise<ConfigRead> {
  let failure: string
  try {
    const result = await $.process.run(['git', 'config', '--get', key], { timeoutMs: GIT_TIMEOUT_MS })
    const value = result.stdout.trim()
    if (result.exitCode === 0) return { value: value === '' ? null : value, failure: null, via: 'git' }
    if (result.exitCode === 1) return { value: null, failure: null, via: 'git' }
    failure = `git exit ${result.exitCode}${result.stderr.trim() === '' ? '' : `: ${result.stderr.trim()}`}`
  } catch (error) {
    failure = `git: ${errorTextOf(error)}`
  }
  // The files answer only with a value: git also reads included files, the XDG and system config,
  // which this does not, so "not in the files" is not "not set".
  const fromFiles = await configFromFilesOf($, key)
  return typeof fromFiles === 'string' ? { value: fromFiles, failure: null, via: `files (${failure})` } : { value: null, failure, via: 'git' }
}

// `/a/b/../c/./d` as `/a/c/d`.
const normalPathOf = (path: string) =>
  `/${path
    .split('/')
    .reduce<string[]>((parts, part) => (part === '..' ? parts.slice(0, -1) : part === '.' || part === '' ? parts : [...parts, part]), [])
    .join('/')}`

// `section.name` from the repository's config (found by walking up from the session's directory, a
// worktree's `.git` file followed to its common dir) and ~/.gitconfig, the repository's first as git
// reads it. undefined when no file could be read at all, null when they were read and the key is not set.
async function configFromFilesOf($: EngineInterface, key: string): Promise<string | null | undefined> {
  const dot = key.lastIndexOf('.')
  const [section, name] = [key.slice(0, dot).toLowerCase(), key.slice(dot + 1).toLowerCase()]
  // A value as git reads it: quotes dropped, a # or ; outside quotes starts a comment.
  const valueOf = (raw: string) => {
    let out = ''
    let isQuoted = false
    for (const char of raw) {
      if (char === '"') isQuoted = !isQuoted
      else if (!isQuoted && (char === '#' || char === ';')) break
      else out += char
    }
    return out.trim()
  }
  const valueIn = (text: string): string | null => {
    let current = ''
    let found: string | null = null
    for (const raw of text.split('\n')) {
      let line = raw.trim()
      // `[user]` is the section; `[user "x"]` is a subsection of its own and does not count.
      const head = /^\[\s*([^\]\s"]+)(?:\s+"([^"]*)")?\s*\]/.exec(line)
      if (head !== null) {
        current = head[2] === undefined ? (head[1] ?? '').toLowerCase() : `${(head[1] ?? '').toLowerCase()} "${head[2]}"`
        line = line.slice(head[0].length).trim()
      }
      if (current !== section || line === '') continue
      const pair = /^([A-Za-z][\w-]*)\s*=(.*)$/.exec(line)
      if (pair !== null && (pair[1] ?? '').toLowerCase() === name) found = valueOf(pair[2] ?? '')
    }
    return found
  }
  const paths: string[] = []
  try {
    const root = await repoRootOf($)
    if (root !== null) {
      const git = `${root}/.git`
      const stat = await $.fs.stat(git)
      if (stat.kind === 'dir') paths.push(`${git}/config`)
      else {
        const gitdir = /gitdir:\s*(.+)/.exec(String(await $.fs.read(git)))?.[1]?.trim()
        if (gitdir !== undefined) {
          const absolute = gitdir.startsWith('/') ? gitdir : `${root}/${gitdir}`
          const common = (await $.fs.exists(`${absolute}/commondir`)) ? String(await $.fs.read(`${absolute}/commondir`)).trim() : '.'
          paths.push(normalPathOf(`${common.startsWith('/') ? common : `${absolute}/${common}`}/config`))
        }
      }
    }
  } catch {
    // No session directory or no repository: the global file alone.
  }
  const home = await homeOf($)
  if (home !== null) paths.push(`${home}/.gitconfig`)
  let readAny = false
  for (const path of paths) {
    try {
      if (!(await $.fs.exists(path))) continue
      const text = String(await $.fs.read(path))
      readAny = true
      const value = valueIn(text)
      if (value !== null && value !== '') return value
    } catch {
      // An unreadable file is skipped; the next one may still answer.
    }
  }
  return readAny ? null : undefined
}

// Opens an https link in the browser: `open` on macOS, `xdg-open` elsewhere; a failure is said.
export async function openLink($: EngineInterface, url: string): Promise<void> {
  if (!/^https:\/\//.test(url)) return
  let lastError = ''
  for (const opener of ['open', 'xdg-open']) {
    try {
      const { exitCode, stderr } = await $.process.run([opener, url], { timeoutMs: 10_000 })
      if (exitCode === 0) return
      lastError = stderr.trim() || `${opener} exited ${exitCode}`
    } catch (error) {
      lastError = errorTextOf(error)
    }
  }
  $.ui.toast(`Could not open ${url}: ${lastError}`, { timeoutMs: 6000 })
}

// The todo file's path, or null when there is no home directory to put it under.
export async function todoPathOf($: EngineInterface, file: string): Promise<string | null> {
  if (file.startsWith('/')) return file
  const home = await homeOf($)
  return home === null ? null : `${home}/${file.replace(/^~\//, '')}`
}

export async function readTodoLines($: EngineInterface, path: string): Promise<string[]> {
  return (await $.fs.exists(path)) ? String(await $.fs.read(path)).split('\n') : []
}

// The todo file into the panel: when it opens, every few seconds while it is open (another plugin
// writes the same file), and after each change made here.
async function loadTodos($: EngineInterface, settings: Settings): Promise<void> {
  if (!settings.showTodos) return
  const path = await todoPathOf($, TODO_FILE)
  let next: TodoFile
  if (isDemo) next = { lines: demo.DEMO_TODOS, problem: null }
  else if (path === null) next = { lines: [], problem: 'no home directory for the todo file' }
  else {
    try {
      next = { lines: await readTodoLines($, path), problem: null }
    } catch (error) {
      next = { lines: [], problem: `todo file unreadable: ${errorTextOf(error)}` }
    }
  }
  if (JSON.stringify(next) !== JSON.stringify(await read($, todoFile))) await update($, todoFile, () => next)
}

const mtimeOf = async ($: EngineInterface, path: string) => ((await $.fs.exists(path)) ? (await $.fs.stat(path)).mtimeMs : 0)

// Read, change and write the file. Another plugin writes the same file, so the write goes through only
// when the file is unchanged since it was read; otherwise the change is applied again to the new
// content, a few times at most. `change` returns null to leave the file alone.
export async function changeTodos(
  $: EngineInterface,
  path: string,
  change: (lines: string[]) => string[] | null,
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await mtimeOf($, path)
    const next = change(await readTodoLines($, path))
    if (next === null) return false
    if ((await mtimeOf($, path)) !== before) continue
    const text = next.join('\n')
    await $.fs.write(path, text.endsWith('\n') || text === '' ? text : `${text}\n`)
    return true
  }
  throw new Error('the todo file kept changing, try again')
}

// A tracker can hang for minutes (the Atlassian server does); the panel gives up after this and says so.
const TICKET_TIMEOUT_MS = 20_000

// The Atlassian site: the Jira site setting, else the first site the Atlassian server can reach, asked
// once per session (again after a failure).
let discoveredSite: Promise<string> | null = null
async function jiraSiteOf($: EngineInterface, settings: Settings): Promise<string> {
  if (settings.jiraSite !== null) return settings.jiraSite
  discoveredSite ??= callMcp($, SITES_TOOL, {}, USUAL_JIRA_SERVERS).then(jiraFeed.siteOf)
  try {
    return await discoveredSite
  } catch (error) {
    discoveredSite = null
    throw error
  }
}

// The checkout's folder name, as the status line shows it beside the branch.
async function repoNameOf($: EngineInterface): Promise<string | null> {
  try {
    const result = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { timeoutMs: 5000 })
    const name = result.stdout.trim().split('/').pop() ?? ''
    return result.exitCode === 0 && name !== '' ? name : null
  } catch {
    return null
  }
}

// The checkout's branch; `detached <sha>` on a detached HEAD (a rebase, a checked-out tag); null
// outside a repository; undefined when git did not answer, so the row keeps what it showed.
export async function branchOf($: EngineInterface): Promise<string | null | undefined> {
  try {
    const result = await $.process.run(['git', 'symbolic-ref', '--short', '-q', 'HEAD'], { timeoutMs: GIT_TIMEOUT_MS })
    const name = result.stdout.trim()
    if (result.exitCode === 0 && name !== '') return name
    if (result.exitCode !== 1) return null
    const sha = await $.process.run(['git', 'rev-parse', '--short', 'HEAD'], { timeoutMs: GIT_TIMEOUT_MS })
    return sha.exitCode === 0 && sha.stdout.trim() !== '' ? `detached ${sha.stdout.trim()}` : null
  } catch {
    return undefined
  }
}


// One refresh at a time. The tracker is asked when the branch's ticket changed, or when forced (the ↻
// button); an error stays until then, so a tracker that is down is not asked after every turn.
let ticketInFlight: Promise<void> | null = null
export const isTicketLoading = () => ticketInFlight !== null
// A call while one runs is not lost: it runs once more afterwards (the branch may have changed, or
// ↻ was pressed), with the flags of every call that waited.
let ticketAgain: { force: boolean; settle: boolean } | null = null
export function refreshTicket($: EngineInterface, settings: Settings, force = false, settle = false): Promise<void> {
  if (ticketInFlight !== null) {
    ticketAgain = { force: force || (ticketAgain?.force ?? false), settle: settle || (ticketAgain?.settle ?? false) }
    return ticketInFlight
  }
  ticketInFlight = loadTicket($, settings, force, settle)
    .catch(() => undefined)
    .finally(() => {
      ticketInFlight = null
      const again = ticketAgain
      ticketAgain = null
      if (again !== null) void refreshTicket($, settings, again.force, again.settle)
    })
  return ticketInFlight
}

// Which forge the checkout's origin is on (GitHub or GitLab), for an issue number in the branch name.
async function forgeOfCheckout($: EngineInterface, settings: Settings): Promise<'github' | 'gitlab' | null> {
  try {
    const result = await $.process.run(['git', 'remote', 'get-url', 'origin'], { timeoutMs: GIT_TIMEOUT_MS })
    return result.exitCode === 0 ? issueFeed.forgeOf(result.stdout.trim(), { github: settings.githubHost, gitlab: settings.gitlabHost }) : null
  } catch {
    return null
  }
}

type TicketFound = { issue: { summary: string; status: string; category: string; url: string } | null; link: string; label: string }

// A key (PROJ-12) is asked of Jira, then Linear, whichever of them is a ticket source and connected;
// one that does not know the key, or fails, hands it to the next. Found nowhere: the first failure is
// said, else "not found", else that no tracker is connected.
async function lookupKey($: EngineInterface, settings: Settings, key: string): Promise<TicketFound> {
  let missing: unknown = new MissingTool(`no tracker for ${key}: connect Jira or Linear`)
  let failure: unknown = null
  let notFound: TicketFound | null = null
  for (const source of settings.ticketSources.filter(item => item === 'jira' || item === 'linear')) {
    try {
      if (source === 'jira') {
        const site = await jiraSiteOf($, settings)
        const result = await callMcp(
          $,
          JIRA_TOOL,
          { cloudId: site, jql: `key = ${key}`, fields: ['summary', 'status'], maxResults: 1, responseContentFormat: 'markdown' },
          USUAL_JIRA_SERVERS,
        )
        const found: TicketFound = { issue: issueOf(result), link: `https://${site}/browse/${key}`, label: 'Jira' }
        if (found.issue !== null) return found
        notFound ??= found
      } else {
        const issue = issueFeed.parseLinearIssue(await callMcp($, issueFeed.LINEAR_GET_TOOL, { id: key }, USUAL_LINEAR_SERVERS))
        if (issue !== null) return { issue, link: '', label: 'Linear' }
        notFound ??= { issue: null, link: '', label: 'Linear' }
      }
    } catch (error) {
      if (error instanceof MissingTool) missing = error
      else failure ??= error
    }
  }
  if (failure !== null) throw failure
  if (notFound !== null) return notFound
  throw missing
}

// An issue number (#12) is asked of the forge the checkout is on, in its own repository.
async function lookupNumber($: EngineInterface, forge: 'github' | 'gitlab', number: number): Promise<TicketFound> {
  const stdout =
    forge === 'github'
      ? await runForgeCli($, issueFeed.githubIssueArgv(number), ghLoggedOut)
      : await runForgeCli($, glabArgv('', issueFeed.gitlabIssueEndpoint(number)), glabLoggedOut)
  return { issue: issueFeed.parseForgeIssue(stdout), link: '', label: SOURCE_LABEL[forge] }
}

async function loadTicket($: EngineInterface, settings: Settings, force: boolean, settle: boolean): Promise<void> {
  if (isDemo) {
    await update($, ticket, () => (settings.showTicket ? demo.DEMO_TICKET : null))
    return
  }
  const branch = settings.showTicket ? await branchOf($) : null
  if (branch === undefined) return
  if (branch === null) {
    await update($, ticket, () => null)
    return
  }
  // A key in the branch name, else an issue number where the checkout is on GitHub or GitLab and that
  // forge is a ticket source.
  const ticketKey = ticketKeyOf(branch, [])
  const number = ticketKey === null ? issueFeed.issueNumberOf(branch) : null
  const forge = number === null ? null : await forgeOfCheckout($, settings)
  const isForgeIssue = number !== null && forge !== null && settings.ticketSources.includes(forge)
  const key = ticketKey ?? (isForgeIssue ? `#${number}` : null)
  const current = await read($, ticket)
  const isSame = current !== null && current.branch === branch && current.key === key && current.repo !== undefined
  // Not settled: an error, or a lookup that never answered (a reload dropped it). Asked again when the
  // panel opens, not after every turn, so a tracker that is down is not asked over and over.
  const isUnsettled = current !== null && current.key !== null && (current.error !== null || current.status === '')
  if (isSame && !force && !(settle && isUnsettled)) return
  const known = current !== null && current.key === key ? current : null
  const base: Ticket = {
    branch,
    // A ticket kept from before the repo was read has none (undefined, not null): read it then.
    repo: current?.repo !== undefined ? current.repo : await repoNameOf($),
    key,
    summary: known?.summary ?? '',
    status: known?.status ?? '',
    category: known?.category ?? '',
    url: known?.url ?? '',
    error: null,
  }
  await update($, ticket, () => base)
  if (key === null) return
  // The timer is cancelled as soon as the tracker answers, so nothing waits out the 20 s afterwards.
  let timer: { cancel: () => void } | null = null
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = $.clock.after(TICKET_TIMEOUT_MS, () => reject(new Error('no answer in 20 s')))
  })
  try {
    const lookup = ticketKey !== null ? lookupKey($, settings, ticketKey) : lookupNumber($, forge ?? 'github', number ?? 0)
    const { issue, link, label } = await Promise.race([lookup, timeout])
    await update($, ticket, () => (issue === null ? { ...base, url: link, error: `not found in ${label}` } : { ...base, ...issue, url: issue.url || link }))
  } catch (error) {
    await update($, ticket, () => ({ ...base, error: ticketErrorOf(error) }))
  } finally {
    ;(timer as { cancel: () => void } | null)?.cancel()
  }
}

// Two kinds of skill: a command skill declares `command: /<name>` in its frontmatter and is started on
// purpose; a context skill loads itself when its description matches the task. Read afresh each time
// the panel opens, so a changed SKILL.md shows.
type SkillKind = 'command' | 'context'
async function skillKindOf($: EngineInterface, path: string | null): Promise<SkillKind> {
  if (path === null) return 'command'
  try {
    if (!(await $.fs.exists(path))) return 'command'
    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(await $.fs.read(path)))?.[1] ?? ''
    return /^command:\s*\/?[\w:.-]+\s*$/m.test(front) ? 'command' : 'context'
  } catch {
    return 'command'
  }
}

// Where a team plugin's skill lives: ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills/<name>.
// The cache keeps old versions too, so the newest SKILL.md wins. None found: a plain command file.
async function pluginSkillPathOf($: EngineInterface, plugin: string, short: string): Promise<string | null> {
  const home = await homeOf($)
  if (home === null) return null
  const cache = `${home}/.claude/plugins/cache`
  try {
    if (!(await $.fs.exists(cache))) return null
    const found: { path: string; mtimeMs: number }[] = []
    for (const marketplace of await $.fs.list(cache)) {
      const dir = `${cache}/${marketplace.name}/${plugin}`
      if (marketplace.kind !== 'dir' || !(await $.fs.exists(dir))) continue
      for (const version of await $.fs.list(dir)) {
        const path = `${dir}/${version.name}/skills/${short}/SKILL.md`
        if (await $.fs.exists(path)) found.push({ path, mtimeMs: (await $.fs.stat(path)).mtimeMs })
      }
    }
    return found.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.path ?? null
  } catch {
    return null
  }
}

// The team plugins installed, from any marketplace, read straight from installed_plugins.json, each
// with its install folder. Empty when the file cannot be read.
async function installedTeamPlugins($: EngineInterface, prefix: string): Promise<Map<string, InstalledPlugin>> {
  const home = await homeOf($)
  if (home === null) return new Map()
  const path = `${home}/${INSTALLED_PLUGINS}`
  try {
    return (await $.fs.exists(path)) ? installedTeamPluginsOf(String(await $.fs.read(path)), prefix) : new Map()
  } catch {
    return new Map()
  }
}

async function skillPathOf($: EngineInterface, command: TeamCommand, installed: ReadonlyMap<string, InstalledPlugin>): Promise<string | null> {
  const short = shortNameOf(command.info.name)
  const folder = installed.get(command.plugin)?.path
  return folder !== undefined ? `${folder}/skills/${short}/SKILL.md` : pluginSkillPathOf($, command.plugin, short)
}

// How to install a team plugin: from the marketplace the settings name, else by its name alone.
const installHintOf = (plugin: string, settings: Settings) =>
  `/plugin install ${plugin}${settings.teamMarketplace === null ? '' : `@${settings.teamMarketplace}`}`

// One check at a time: a second press while it runs is said, not started again.
let isDiagnosing = false

// The "why?" button: every step the team and its skills are read through, run again now and said line
// by line, with what the last refresh saw. Each step on its own, so one that fails does not hide the rest.
export async function diagnoseTeam($: EngineInterface, settings: Settings): Promise<string[]> {
  const lines: string[] = []
  const step = async (label: string, work: () => Promise<string>) => {
    const started = await $.clock.now()
    try {
      const said = await work()
      lines.push(`${label}: ${said} (${(await $.clock.now()) - started} ms)`)
    } catch (error) {
      lines.push(`${label}: FAILED ${errorTextOf(error)} (${(await $.clock.now()) - started} ms)`)
    }
  }
  const run = async (argv: string[]) => {
    const result = await $.process.run(argv, { timeoutMs: GIT_TIMEOUT_MS })
    const out = [result.stdout.trim(), result.stderr.trim()].filter(text => text !== '').join(' | ')
    return `exit ${result.exitCode}${out === '' ? '' : `, ${fit(out.replace(/\s+/g, ' '), 120)}`}`
  }
  await step('session directory', async () => $.session.cwd())
  await step('repository', () => run(['git', 'rev-parse', '--show-toplevel']))
  await step('git config user.team', () => run(['git', 'config', '--show-origin', '--get', 'user.team']))
  await step('config files', async () => {
    const value = await configFromFilesOf($, 'user.team')
    return value === undefined ? 'none readable' : value === null ? 'read, user.team not in them' : `user.team = ${value}`
  })
  const commands = await $.command.list()
  const fromPlugins = teamPluginsOf(commands, settings.teamPrefix)
  lines.push(`session commands: ${commands.length}; team plugins (${settings.teamPrefix}*) they come from: ${fromPlugins.length === 0 ? 'none' : fromPlugins.join(', ')}`)
  const teamName = await read($, team)
  if (teamName !== null) {
    const plugin = teamPluginOf(teamName, settings.teamPrefix)
    const found = (await installedTeamPlugins($, settings.teamPrefix)).get(plugin)
    lines.push(`plugin ${plugin}: ${found !== undefined ? `installed from ${found.marketplace}` : `not installed: ${installHintOf(plugin, settings)}`}`)
  }
  const trace = await read($, teamTrace)
  lines.push(...(trace.length === 0 ? ['last refresh: none yet'] : [`last refresh, ${trace[0] ?? ''}:`, ...trace.slice(1).map(line => `  ${line}`)]))
  return lines
}

// Finds the team and its skills and stores them for the panel to draw. Runs when the session starts,
// each time the panel opens and on its reload button, never while drawing (it reads files). Calls that
// overlap share one run. A read that fails keeps what an earlier one found, and a run that came up short
// (team not read, or no team skill where an earlier run found some) tries again a few times.
let teamInFlight: Promise<void> | null = null
let teamRetries = 0
let teamRetryTimer: { cancel: () => void } | null = null
export function refreshTeam($: EngineInterface, settings: Settings, isRetry = false): Promise<void> {
  // The Team section switched off: nothing reads the team, so neither git nor the plugins are asked.
  if (!settings.showTeam) return Promise.resolve()
  // A refresh asked for (session start, panel open, the reload button) starts a fresh set of tries
  // and drops a try still waiting, so two chains never share the count.
  if (!isRetry) {
    teamRetries = 0
    teamRetryTimer?.cancel()
    teamRetryTimer = null
  }
  teamInFlight ??= loadTeam($, settings).finally(() => {
    teamInFlight = null
  })
  return teamInFlight
}

// The tty of this session's tab, looked up once per session; null when there is none.
let sessionTty: string | null | undefined
async function readTerminalLight($: EngineInterface): Promise<void> {
  let light: boolean | null = null
  try {
    light = isLightColorFgBg(await $.env.get('COLORFGBG'))
    if (light === null && (await $.env.get('TERM_PROGRAM')) === 'Apple_Terminal') {
      if (sessionTty === undefined) {
        const found = await $.process.run(['sh', '-c', TTY_SCRIPT], { timeoutMs: 5000 })
        sessionTty = found.exitCode === 0 && found.stdout.trim() !== '' ? `/dev/${found.stdout.trim()}` : null
      }
      if (sessionTty !== null) {
        const asked = await $.process.run(backgroundArgv(sessionTty), { timeoutMs: 5000 })
        light = asked.exitCode === 0 ? isLightBackground(asked.stdout) : null
      }
    }
  } catch {
    light = null
  }
  if (light !== (await read($, terminalLight))) await update($, terminalLight, () => light)
}

// The team is named by git config (here, or remembered from an earlier read, not guessed from the
// plugin) and its skills were found: nothing left for the "why" check to explain.
async function isTeamResolved($: EngineInterface): Promise<boolean> {
  return (await read($, team)) !== null && (await read($, teamGuessedFrom)) === null && (await read($, teamSkills)).entries.length > 0
}

async function loadTeam($: EngineInterface, settings: Settings): Promise<void> {
  const startedAt = await $.clock.now()
  const trace: string[] = []
  const prefix = settings.teamPrefix
  const [teamRead, installed, commands, storedTeam] = await Promise.all([
    configReadOf($, 'user.team'),
    installedTeamPlugins($, prefix),
    $.command.list(),
    $.store.get(TEAM_STORE_KEY),
  ])
  // git config names the team where it is set; elsewhere the name it gave last is remembered.
  const remembered = typeof storedTeam === 'string' && storedTeam !== '' ? storedTeam : null
  const fromGit = teamRead.failure === null ? teamRead.value : null
  // Last, the one team plugin installed (a newcomer has it before git config names the team).
  // Not remembered: a guess, and the panel says so under Team.
  const teamPlugins = new Set([...installed.keys(), ...teamPluginsOf(commands, prefix)])
  const onlyPlugin = teamPlugins.size === 1 ? ([...teamPlugins][0] ?? null) : null
  const kept = fromGit ?? remembered ?? (teamRead.failure === null ? null : await read($, team))
  const guessedFrom = kept === null ? onlyPlugin : null
  const teamName = kept ?? (guessedFrom === null ? null : teamNameOfPlugin(guessedFrom, prefix))
  if (fromGit !== null && fromGit !== remembered) await $.store.set(TEAM_STORE_KEY, fromGit)
  const notHere = teamRead.failure === null ? 'not set here' : `not read here: ${teamRead.failure}`
  trace.push(
    fromGit !== null
      ? `team: ${fromGit} (via ${teamRead.via})`
      : remembered !== null
        ? `team: ${remembered} (remembered; git config user.team ${notHere})`
        : guessedFrom !== null
          ? `team: ${teamName} (from the installed ${guessedFrom}; git config user.team ${notHere})`
          : teamRead.failure === null
            ? `team: not set (via ${teamRead.via}${teamPlugins.size > 1 ? `; ${teamPlugins.size} team plugins installed, none taken` : ''})`
            : `team: not read (${teamRead.failure}), kept ${teamName ?? 'nothing'}`,
  )
  await update($, team, () => teamName)
  await update($, teamGuessedFrom, () => guessedFrom)
  const names = commands.map(command => command.name)
  const taken = new Set<string>([COMMAND])
  for (const item of [...GENERAL, ...SESSION]) {
    const command = item.candidates.map(short => resolveCommand(names, short)).find(name => name !== undefined)
    if (command !== undefined) taken.add(command)
  }
  const found = teamCommandsOf(commands, taken, teamName, prefix)
  trace.push(`commands in the session: ${commands.length}; team skills found: ${found.length}`)
  const kinds = await Promise.all(found.map(async command => skillKindOf($, await skillPathOf($, command, installed))))
  // Every team skill is a row that can be started, a context skill too (it also loads by itself).
  const next: TeamSkills = {
    entries: found.map(
      (command, index): TeamSkill => ({
        name: command.info.name,
        label: labelOf(command.info.name),
        description: command.info.description,
        source: installed.get(command.plugin)?.marketplace ?? command.plugin,
        auto: kinds[index] === 'context',
      }),
    ),
  }
  const before = await read($, teamSkills)
  // None found where some were before while a team plugin is installed: the session is still loading
  // its commands, so the earlier list stays and the run is tried again. With no team plugin installed
  // there is nothing to wait for, and an earlier list (one read another way) is dropped.
  const isShort = next.entries.length === 0 && before.entries.length > 0 && installed.size > 0
  if (isShort) trace.push(`kept the earlier ${before.entries.length} skill(s)`)
  else await update($, teamSkills, () => next)
  const shouldRetry = (isShort || teamRead.failure !== null) && teamRetries < TEAM_RETRY_MS.length
  if (shouldRetry) {
    const delay = TEAM_RETRY_MS[teamRetries] ?? 0
    teamRetries += 1
    trace.push(`trying again in ${Math.round(delay / 1000)} s (${teamRetries} of ${TEAM_RETRY_MS.length})`)
    teamRetryTimer = $.clock.after(delay, () => {
      teamRetryTimer = null
      void refreshTeam($, settings, true).catch(() => undefined)
    })
  }
  // Fixed since the check was opened (user.team set, a plugin installed): the check closes itself.
  if ((await read($, teamDiagnosis)) !== null && (await isTeamResolved($))) await update($, teamDiagnosis, () => null)
  const took = (await $.clock.now()) - startedAt
  await update($, teamTrace, () => [`${clockTimeOf(startedAt)}, ${took} ms`, ...trace])
}

// One click at a time: a second press while the first is still running is dropped, not queued.
// The flag is set and checked without an await in between, so two quick presses cannot both pass.
let inFlight: string | null = null
export const isClickRunning = () => inFlight !== null
export async function once($: EngineInterface, key: string, work: () => Promise<void>): Promise<void> {
  if (inFlight !== null) {
    $.ui.toast('One moment, the last click is still running', { timeoutMs: 1500 })
    return
  }
  inFlight = key
  try {
    await update($, pending, () => key)
    await work()
  } catch (error) {
    $.ui.toast(`Did not work: ${errorTextOf(error)}`)
  } finally {
    inFlight = null
    await update($, pending, () => null)
  }
}

// Two-step press: the first arms the control and says why; a second press confirms when it comes
// after CONFIRM_MIN_MS (a double click is one gesture) and within CONFIRM_MS.
export async function confirmed($: EngineInterface, key: string, message: string): Promise<boolean> {
  const now = await $.clock.now()
  const current = await read($, armed)
  if (current !== null && current.key === key && now < current.until) {
    if (now - current.at < CONFIRM_MIN_MS) return false
    await update($, armed, () => null)
    return true
  }
  await update($, armed, () => ({ key, at: now, until: now + CONFIRM_MS, message }))
  // Only this arming: a later one of the same control has its own timer.
  $.clock.after(CONFIRM_MS, () => void update($, armed, value => (value !== null && value.key === key && value.at === now ? null : value)))
  return false
}

// Starting a command that starts a turn: one start at a time (the flag is taken before any await, so
// a double click cannot pass twice). While Claude is still answering the command simply queues behind
// the answer, said in the toast: a run or an Enter in a field is a clear intent, and asking again lost
// what had been typed. Only the costly commands carry a confirmation of their own (`confirm`).
let isStarting = false
export async function startCommand(
  $: EngineInterface,
  options: { key: string; command: string; args: string; label: string; confirm: string | null },
  beforeStart: () => Promise<void>,
): Promise<void> {
  if (isStarting) {
    $.ui.toast(`${options.label} is already starting`, { timeoutMs: 2000 })
    return
  }
  isStarting = true
  let started = false
  try {
    if (options.confirm !== null && !(await confirmed($, options.key, options.confirm))) return
    const busy = await read($, isBusy)
    started = true
    $.clock.after(STARTING_MS, () => {
      isStarting = false
    })
    await beforeStart()
    $.ui.toast(busy ? `${options.label} queued, it runs after the current answer` : `${options.label} started`, { timeoutMs: 3000 })
    void $.command.run({ command: options.command, args: options.args }).catch(error => {
      $.ui.toast(`${options.label} failed: ${errorTextOf(error)}`)
    })
  } catch (error) {
    $.ui.toast(`${options.label} did not start: ${errorTextOf(error)}`)
  } finally {
    if (!started) isStarting = false
  }
}

// Notes a Catchup or Wrapup in this conversation, for the confirmations on Catchup, Wrapup and Clear.
async function noteRun($: EngineInterface, command: string): Promise<void> {
  if (command === OWN_SETUP) {
    await setSetup($, 'done')
    return
  }
  const short = shortNameOf(command)
  if (short.endsWith('catchup')) await update($, ran, value => ({ ...value, catchup: true }))
  else if (short.endsWith('wrapup')) await update($, ran, value => ({ ...value, wrapup: true }))
}

// ---- Folds: which sections are closed, remembered across sessions.

async function loadFolded($: EngineInterface): Promise<void> {
  const stored = await $.store.get(FOLDED_STORE_KEY)
  const list: string[] = Array.isArray(stored) ? stored.filter(isFold) : [...FOLDED_BY_DEFAULT]
  await update($, folded, () => list)
}

// ---- Pinned commands: any command of the session, added under Work with the ＋, kept across sessions.

async function loadPinned($: EngineInterface): Promise<void> {
  const stored = isDemo ? [] : await $.store.get(PINNED_STORE_KEY)
  const list = Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : []
  await update($, pinned, () => list)
}

async function setPinned($: EngineInterface, change: (current: string[]) => string[]): Promise<void> {
  const next = change(await read($, pinned))
  await update($, pinned, () => next)
  await $.store.set(PINNED_STORE_KEY, next)
}

// Returns whether the section is open after the press.
async function foldSection($: EngineInterface, key: Fold): Promise<boolean> {
  const current = await read($, folded)
  const next = current.includes(key) ? current.filter(item => item !== key) : [...current, key]
  await update($, folded, () => next)
  await $.store.set(FOLDED_STORE_KEY, next)
  return !next.includes(key)
}

// ---- Toasts about the feeds. A prompt band mod (a `/band` command), when installed, already toasts
// the context nudges, PR changes, new mail and newly assigned tickets, so the panel then only shows them.


async function hasBand($: EngineInterface): Promise<boolean> {
  return (await $.command.list()).some(command => shortNameOf(command.name) === 'band')
}

async function notify($: EngineInterface, texts: readonly string[]): Promise<void> {
  if (texts.length === 0 || (await hasBand($))) return
  for (const text of texts) $.ui.toast(text, { timeoutMs: 8000 })
}

// ---- Pomodoro, in the plugin store (a running round survives /exit, every window shows the same).

async function loadPomodoro($: EngineInterface): Promise<Pomodoro> {
  return pomodoroClock.pomodoroFrom(await $.store.get(POMODORO_STORE_KEY))
}

async function tickPomodoro($: EngineInterface, settings: Settings): Promise<void> {
  const time = await $.clock.now()
  const stored = await loadPomodoro($)
  const step = pomodoroClock.advance(stored, time, settings.pomodoroLengths)
  if (step.pomodoro !== stored) await $.store.set(POMODORO_STORE_KEY, step.pomodoro)
  if (step.message !== null) {
    $.ui.toast(step.message, { timeoutMs: 15_000 })
    // Also a macOS notification (silent by itself); a failure (not a Mac, notifications off) costs nothing.
    void $.process.run(pomodoroClock.notificationArgv(step.message), { timeoutMs: 10_000 }).catch(() => undefined)
    // With the sound on, the sound, and the terminal's own channel (preferredNotifChannel): in Apple
    // Terminal the bell, which marks the tab and bounces the Dock icon; in iTerm, Ghostty and Kitty a
    // notification. Both are heard, so both stay quiet with the sound off.
    if (settings.pomodoroSound) {
      void $.process.run(pomodoroClock.soundArgv(), { timeoutMs: 10_000 }).catch(() => undefined)
      void $.ui.notify(step.message, { title: 'Pomodoro' }).catch(() => undefined)
    }
  }
  const shown = await read($, pomodoro)
  if (JSON.stringify(shown) !== JSON.stringify(step.pomodoro)) await update($, pomodoro, () => step.pomodoro)
  if (step.pomodoro.phase !== 'idle' || shown.phase !== 'idle') await update($, nowAtom, () => time)
}

async function changePomodoro($: EngineInterface, change: (current: Pomodoro, time: number) => Pomodoro): Promise<Pomodoro> {
  const time = await $.clock.now()
  const next = change(await loadPomodoro($), time)
  await $.store.set(POMODORO_STORE_KEY, next)
  await update($, pomodoro, () => next)
  await update($, nowAtom, () => time)
  return next
}

// ---- The slow feeds: pull requests, the ticket list, mail. One read at a time each; a failed read
// retries soon and backs off up to the regular poll, the wait said in the panel.

type Poller = { inFlight: Promise<void> | null; retryMs: number; retry: Timer | null }
const pollerOf = (): Poller => ({ inFlight: null, retryMs: FIRST_RETRY_MS, retry: null })
type Pollers = { prs: Poller; issues: Poller; mail: Poller; spotify: { inFlight: Promise<void> | null }; sessions: { inFlight: Promise<void> | null; isStale: boolean } }

function refreshWith(poller: { inFlight: Promise<void> | null }, load: () => Promise<void>): Promise<void> {
  poller.inFlight ??= load().finally(() => {
    poller.inFlight = null
  })
  return poller.inFlight
}

function scheduleRetry($: EngineInterface, poller: Poller, rerun: () => void): number {
  poller.retry?.cancel()
  const delay = poller.retryMs
  poller.retry = $.clock.after(delay, () => {
    poller.retry = null
    rerun()
  })
  poller.retryMs = Math.min(delay * 2, FEED_POLL_MS)
  return delay
}


// ---- Which MCP server a feed asks. Not a setting: the session's own tool list names the server each
// tool is on (`$.session.usage` with a `summary` breakdown, counted locally, no request). The list is
// read once, and again after a call no server answered, since a server may have connected meanwhile;
// the server that answered last goes first, the usual names last, for a list that cannot be read.
type McpResult = Awaited<ReturnType<EngineInterface['mcp']['call']>>
let mcpTools: Promise<readonly { name: string; serverName: string }[]> | null = null
const answeredBy = new Map<string, string>()

// The servers to try, and of them the ones the session lists the tool on (whatever their name).
async function serversFor($: EngineInterface, tool: string, usual: readonly string[]): Promise<{ servers: string[]; listed: string[] }> {
  mcpTools ??= $.session
    .usage({ breakdown: 'summary' })
    .then(usage => usage.context.breakdown?.mcpTools ?? [])
    .catch(() => [])
  const listed = (await mcpTools).filter(item => item.name.endsWith(`__${tool}`)).map(item => item.serverName)
  const last = answeredBy.get(tool)
  return { servers: [...new Set([...(last === undefined ? [] : [last]), ...listed, ...usual])], listed }
}

async function callMcp($: EngineInterface, tool: string, args: Record<string, unknown>, usual: readonly string[]): Promise<McpResult> {
  const { servers, listed } = await serversFor($, tool, usual)
  const isListed = listed.length > 0
  let lastError: unknown = new MissingTool(missingToolText(tool))
  for (const server of servers) {
    try {
      const result = await $.mcp.call(server, tool, args)
      answeredBy.set(tool, server)
      return result
    } catch (error) {
      // Refused by the permission check: another server would be refused the same way, and its
      // "not connected" would hide the hint to add an allow rule (util.ts, retryLineOf).
      if (isPermissionRefusal(errorTextOf(error))) throw error
      lastError = error
    }
  }
  answeredBy.delete(tool)
  mcpTools = null
  // No server lists the tool and none of the usual names answered: nothing to log in to.
  if (!isListed) throw new MissingTool(missingToolText(tool))
  throw lastError
}

// ---- Pull requests, from each source on its own. A source that is not set up here (no gh logged in,
// no Bitbucket server connected) is left out without a word while the source setting is auto; one
// that is set up and fails is said, and the others still show.

type SourcePrs = { source: PrSource; mine: PullRequest[]; reviewing: PullRequest[]; me: string | null }
type SourceFailure = { source: PrSource | TicketSource; error: unknown }
class NotSetUp extends Error {}

// A forge CLI (gh, glab): one that is not installed or not logged in is "not set up here", any other
// failure is said.
const ghLoggedOut = (exitCode: number) => exitCode === GH_NOT_LOGGED_IN
const glabLoggedOut = (exitCode: number, stderr: string) => exitCode !== 0 && isGlabLoggedOut(stderr)
async function runForgeCli($: EngineInterface, argv: string[], isLoggedOut: (exitCode: number, stderr: string) => boolean): Promise<string> {
  const tool = argv[0] ?? ''
  let result: Awaited<ReturnType<EngineInterface['process']['run']>>
  try {
    result = await $.process.run(argv, { timeoutMs: CLI_TIMEOUT_MS })
  } catch (error) {
    // Not installed, or not on the PATH Claude Code was started with.
    throw new NotSetUp(`${tool} not found (${errorTextOf(error)}): install it and run ${tool} auth login`)
  }
  if (isLoggedOut(result.exitCode, result.stderr)) throw new NotSetUp(`${tool} is not logged in: run ${tool} auth login`)
  if (result.exitCode !== 0) throw new Error(result.stderr.trim().split('\n')[0] || `${tool} exited ${result.exitCode}`)
  return result.stdout
}

// A source's failure in the panel, named by its source; an MCP source with the fix where one is known.
function failureLineOf(failure: SourceFailure, delayMs: number): string {
  const text = MCP_SOURCES.includes(failure.source) ? retryLineOf(failure.error, delayMs) : `${errorTextOf(failure.error)}, retrying in ${Math.round(delayMs / 1000)}s`
  return `${SOURCE_LABEL[failure.source]}: ${text}`
}

async function fetchBitbucket($: EngineInterface, previousMe: string | null): Promise<SourcePrs> {
  const [mine, reviewing] = await Promise.all(
    (['AUTHOR', 'REVIEWER'] as const).map(async role =>
      parsePullRequests(await callMcp($, BITBUCKET_TOOL, { role, state: 'OPEN', limit: 25 }, USUAL_BITBUCKET_SERVERS)),
    ),
  )
  return { source: 'bitbucket', mine: mine ?? [], reviewing: reviewing ?? [], me: await meOf($, mine ?? [], previousMe) }
}

async function fetchGithub($: EngineInterface, settings: Settings): Promise<SourcePrs> {
  const found = parseGithubPullRequests(await runForgeCli($, githubArgv(settings.githubHost), ghLoggedOut))
  return { source: 'github', ...found }
}

async function fetchGitlab($: EngineInterface, settings: Settings): Promise<SourcePrs> {
  const run = (endpoint: string) => runForgeCli($, glabArgv(settings.gitlabHost, endpoint), glabLoggedOut)
  const me = usernameOf(await run(GITLAB_USER))
  const [mine, reviewing] = await Promise.all([run(GITLAB_MINE), run(GITLAB_REVIEWING)])
  // Who approved mine, one call each. One that fails leaves that merge request without approvals.
  const mineApprovals = new Map(
    await Promise.all(
      approvalTargetsOf(mine).map(async target => [target.id, await run(gitlabApprovals(target.projectId, target.iid)).then(approversOf, () => new Set<string>())] as const),
    ),
  )
  // Which of the others I approved: a filter an older GitLab may lack, so a failure leaves them unmarked.
  const approvedByMe = me === null ? new Set<number>() : await run(gitlabApprovedBy(me)).then(idsOf, () => new Set<number>())
  const reviewingApprovals = new Map([...approvedByMe].map(id => [id, new Set([me ?? ''])] as const))
  return { source: 'gitlab', me, mine: parseMergeRequests(mine, mineApprovals), reviewing: parseMergeRequests(reviewing, reviewingApprovals) }
}

async function fetchPrs($: EngineInterface, settings: Settings, previous: Me): Promise<{ found: SourcePrs[]; failures: SourceFailure[] }> {
  const isAuto = settings.prSources.length > 1
  const tries = await Promise.all(
    settings.prSources.map(async (source): Promise<SourcePrs | SourceFailure | null> => {
      try {
        if (source === 'github') return await fetchGithub($, settings)
        if (source === 'gitlab') return await fetchGitlab($, settings)
        return await fetchBitbucket($, previous.bitbucket ?? null)
      } catch (error) {
        if (isAuto && (error instanceof NotSetUp || error instanceof MissingTool)) return null
        return { source, error }
      }
    }),
  )
  const found = tries.filter((item): item is SourcePrs => item !== null && 'mine' in item)
  const failures = tries.filter((item): item is SourceFailure => item !== null && 'error' in item)
  if (found.length === 0 && failures.length === 0) {
    throw new MissingTool('no pull request source: log in with gh or glab, or connect a Bitbucket MCP server')
  }
  return { found, failures }
}

// Bitbucket's dashboard has no "who am I" answer: an authored PR names me, else the login name does
// (Bitbucket slugs often match it).
async function meOf($: EngineInterface, mine: PullRequest[], previous: string | null): Promise<string | null> {
  const fromPr = mine.find(pr => pr.authorSlug !== '')?.authorSlug
  if (fromPr !== undefined) return fromPr
  if (previous !== null) return previous
  return (await $.env.get('USER')) ?? null
}

const refreshPrs = ($: EngineInterface, settings: Settings, pollers: Pollers) => refreshWith(pollers.prs, () => loadPrs($, settings, pollers))

async function loadPrs($: EngineInterface, settings: Settings, pollers: Pollers): Promise<void> {
  const poller = pollers.prs
  if (isDemo) {
    const now = await $.clock.now()
    await update($, prs, () => demo.demoPrs(now))
    return
  }
  try {
    const previous = await read($, prs)
    const { found, failures } = await fetchPrs($, settings, previous?.me ?? {})
    // A source that failed this time keeps nothing: its rows would be stale, and the line says why.
    if (found.length > 0) {
      const mine = found.flatMap(item => item.mine)
      const reviewing = found.flatMap(item => item.reviewing)
      const me: Me = Object.fromEntries(found.map(item => [item.source, item.me]))
      const sources = found.map(item => item.source)
      if (previous !== null) {
        // Only the sources that answered both times are compared: one that failed, or connected only
        // now, would read as every one of its PRs merged, or newly requested.
        const isCompared = comparedSources(answeredOf(previous.sources, [...previous.mine, ...previous.reviewing]), sources)
        const before = (list: PullRequest[]) => list.filter(pr => isCompared(pr.source))
        await notify($, [...changesBetween(before(previous.mine), before(mine)), ...reviewChangesBetween(before(previous.reviewing), before(reviewing), me)])
      }
      const fetchedAt = await $.clock.now()
      await update($, prs, () => ({ mine, reviewing: sortForReview(reviewing, me), me, sources, fetchedAt }))
    }
    if (failures.length === 0) {
      await update($, prsError, () => null)
      poller.retryMs = FIRST_RETRY_MS
    } else {
      const delay = scheduleRetry($, poller, () => void refreshPrs($, settings, pollers))
      await update($, prsError, () => failures.map(failure => failureLineOf(failure, delay)).join(' · '))
    }
  } catch (error) {
    const delay = scheduleRetry($, poller, () => void refreshPrs($, settings, pollers))
    await update($, prsError, () => retryLineOf(error, delay))
  }
}

// The sources a feed kept from an earlier read answered: as it says, or for a feed from before it said,
// the sources of its items.
function answeredOf<T extends string>(said: readonly T[] | undefined, items: readonly { source: T }[]): readonly T[] {
  return said ?? [...new Set(items.map(item => item.source))]
}
const comparedSources =
  <T extends string>(before: readonly T[], now: readonly T[]) =>
  (source: T) =>
    before.includes(source) && now.includes(source)

// ---- Tickets, from each source on its own, the same way as the pull requests.

async function fetchIssuesFrom($: EngineInterface, settings: Settings, source: TicketSource): Promise<Issue[]> {
  if (source === 'jira') {
    const args = { cloudId: await jiraSiteOf($, settings), jql: settings.jiraQuery, fields: ['summary', 'status'], maxResults: 50, responseContentFormat: 'markdown' }
    return jiraFeed.parseJiraIssues(await callMcp($, JIRA_TOOL, args, USUAL_JIRA_SERVERS))
  }
  if (source === 'linear') return issueFeed.parseLinearIssues(await callMcp($, issueFeed.LINEAR_LIST_TOOL, issueFeed.LINEAR_LIST_ARGS, USUAL_LINEAR_SERVERS))
  if (source === 'github') return issueFeed.parseGithubIssues(await runForgeCli($, issueFeed.githubIssuesArgv(settings.githubHost), ghLoggedOut))
  return issueFeed.parseGitlabIssues(await runForgeCli($, glabArgv(settings.gitlabHost, issueFeed.GITLAB_ISSUES), glabLoggedOut))
}

const refreshIssues = ($: EngineInterface, settings: Settings, pollers: Pollers) => refreshWith(pollers.issues, () => loadIssues($, settings, pollers))

async function loadIssues($: EngineInterface, settings: Settings, pollers: Pollers): Promise<void> {
  const poller = pollers.issues
  if (isDemo) {
    const now = await $.clock.now()
    await update($, ticketList, () => demo.demoIssues(now))
    return
  }
  const isAuto = settings.ticketSources.length > 1
  try {
    type SourceIssues = { source: TicketSource; issues: Issue[] }
    const tries = await Promise.all(
      settings.ticketSources.map(async (source): Promise<SourceIssues | SourceFailure | null> => {
        try {
          return { source, issues: await fetchIssuesFrom($, settings, source) }
        } catch (error) {
          if (isAuto && (error instanceof NotSetUp || error instanceof MissingTool)) return null
          return { source, error }
        }
      }),
    )
    const found = tries.filter((item): item is SourceIssues => item !== null && 'issues' in item)
    const failures = tries.filter((item): item is SourceFailure => item !== null && 'error' in item)
    if (found.length === 0 && failures.length === 0) throw new MissingTool('no ticket source: connect Jira or Linear, or log in with gh or glab')
    if (found.length > 0) {
      const next = found.flatMap(item => item.issues)
      const sources = found.map(item => item.source)
      const previous = await read($, ticketList)
      if (previous !== null) {
        // As with the PRs: a source that comes back is not every one of its tickets newly assigned.
        const isCompared = comparedSources(answeredOf(previous.sources, previous.issues), sources)
        const fresh = issueFeed.newlyAssignedOf(
          previous.issues.filter(issue => isCompared(issue.source)),
          next.filter(issue => isCompared(issue.source)),
        )
        await notify($, fresh.map(issue => `Assigned to you: ${issue.key} ${issue.summary}`))
      }
      const fetchedAt = await $.clock.now()
      await update($, ticketList, () => ({ issues: next, sources, fetchedAt }))
    }
    if (failures.length === 0) {
      await update($, ticketListError, () => null)
      poller.retryMs = FIRST_RETRY_MS
    } else {
      const delay = scheduleRetry($, poller, () => void refreshIssues($, settings, pollers))
      await update($, ticketListError, () => failures.map(failure => failureLineOf(failure, delay)).join(' · '))
    }
  } catch (error) {
    const delay = scheduleRetry($, poller, () => void refreshIssues($, settings, pollers))
    await update($, ticketListError, () => retryLineOf(error, delay))
  }
}

const refreshMail = ($: EngineInterface, settings: Settings, pollers: Pollers) => refreshWith(pollers.mail, () => loadMail($, settings, pollers))

async function loadMail($: EngineInterface, settings: Settings, pollers: Pollers): Promise<void> {
  const poller = pollers.mail
  if (isDemo) {
    // Read once: the meetings count down from the moment the demo started.
    if ((await read($, mail)) === null) {
      const now = await $.clock.now()
      await update($, mail, () => demo.demoMail(now))
    }
    return
  }
  try {
    const time = await $.clock.now()
    const [unreadResult, calendar] = await Promise.all([
      callMcp($, mailFeed.MAIL_TOOL, { unread_only: true, count: 50 }, USUAL_MAIL_SERVERS),
      callMcp($, mailFeed.CALENDAR_TOOL, { days: CALENDAR_DAYS, count: 20 }, USUAL_MAIL_SERVERS),
    ])
    const unread = mailFeed.parseUnread(unreadResult)
    const meetings = mailFeed.parseMeetings(calendar, time)
    const previous = await read($, mail)
    if (previous !== null) {
      const fresh = mailFeed.newMailOf(previous.unread, unread)
      await notify($, fresh.length > MAIL_TOASTS ? [`${fresh.length} new emails`] : fresh.map(item => `New mail from ${item.from}: ${item.subject}`))
    }
    await update($, mail, () => ({ unread, meetings, fetchedAt: time }))
    await update($, mailError, () => null)
    poller.retryMs = FIRST_RETRY_MS
  } catch (error) {
    const delay = scheduleRetry($, poller, () => void refreshMail($, settings, pollers))
    await update($, mailError, () => retryLineOf(error, delay))
  }
}

// ---- Spotify, over osascript (no account, no network): one read at a time, since osascript waits
// while macOS asks for permission and the poll would pile reads behind it.

const refreshSpotify = ($: EngineInterface, settings: Settings, pollers: Pollers) => refreshWith(pollers.spotify, () => loadSpotify($, settings))

async function loadSpotify($: EngineInterface, settings: Settings): Promise<void> {
  if (isDemo) {
    // Set once, so the track's position runs on instead of starting over at each read.
    if ((await read($, spotify)) === null) {
      const now = await $.clock.now()
      await update($, spotify, () => demo.demoPlayer(now))
    }
    return
  }
  try {
    const result = await $.process.run(spotifyPlayer.nowPlayingArgv(settings.musicApps))
    const player = spotifyPlayer.parseNowPlaying(result, await $.clock.now())
    await update($, spotify, () => player)
    if ((await read($, spotifyError)) !== null) await update($, spotifyError, () => null)
  } catch (error) {
    await update($, spotifyError, () => errorTextOf(error))
  }
}

async function controlSpotify($: EngineInterface, settings: Settings, pollers: Pollers, action: spotifyPlayer.Action): Promise<void> {
  if (isDemo) {
    $.ui.toast('Demo: no music app is controlled', { timeoutMs: 2000 })
    return
  }
  try {
    const result = await $.process.run(spotifyPlayer.actionArgv(action, (await read($, spotify))?.app ?? ''))
    if (result.exitCode !== 0) throw spotifyPlayer.errorOf(result)
  } catch (error) {
    await update($, spotifyError, () => errorTextOf(error))
    return
  }
  // A read started before the action would answer with the old track.
  await pollers.spotify.inFlight
  await refreshSpotify($, settings, pollers)
  $.clock.after(SPOTIFY_SETTLE_MS, () => void refreshSpotify($, settings, pollers))
}

// ---- The other Claude Code sessions on this machine, from the files Claude Code keeps for them.
// `isStale` marks the shown list as too old to compare against (the panel was closed meanwhile).

const refreshSessions = ($: EngineInterface, pollers: Pollers) => refreshWith(pollers.sessions, () => loadSessions($, pollers))

async function readSessionFiles($: EngineInterface): Promise<ClaudeSession[]> {
  const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await homeOf($)) ?? '~'}/.claude`
  const dir = `${configDir}/sessions`
  if (!(await $.fs.exists(dir))) return []
  const names = (await $.fs.list(dir)).filter(entry => entry.kind === 'file' && claudeSessions.SESSION_FILE.test(entry.name))
  // A session that exits between the listing and the read takes its file with it.
  const texts = await Promise.all(names.map(entry => $.fs.read(`${dir}/${entry.name}`).then(String, () => '')))
  return texts.map(claudeSessions.parseSessionFile).filter((session): session is ClaudeSession => session !== null)
}

async function loadSessions($: EngineInterface, pollers: Pollers): Promise<void> {
  const poller = pollers.sessions
  if (isDemo) {
    if ((await read($, sessions)) === null) {
      const now = await $.clock.now()
      await update($, sessions, () => demo.demoSessions(now))
    }
    return
  }
  try {
    const found = await readSessionFiles($)
    const starts =
      found.length === 0
        ? new Map<number, string>()
        : claudeSessions.startsOf(await $.process.run(claudeSessions.psArgv(found.map(session => session.pid)), { env: claudeSessions.PS_ENV, timeoutMs: 5000 }))
    const next = claudeSessions.liveSessions(found, starts, await $.session.id())
    const shown = await read($, sessions)
    if (shown !== null && !poller.isStale) await notify($, claudeSessions.finishedBetween(shown, next))
    poller.isStale = false
    if (JSON.stringify(shown) !== JSON.stringify(next)) await update($, sessions, () => next)
    if ((await read($, sessionsError)) !== null) await update($, sessionsError, () => null)
  } catch (error) {
    await update($, sessionsError, () => errorTextOf(error))
  }
}

// ---- When the feeds are read. The slow ones poll on their own while the band is not installed
// (they are the notifications then), otherwise only while the panel is open; the fast ones only
// while it is open. Opening the panel reads again whatever is older than a minute.

async function slowPoll($: EngineInterface, settings: Settings, pollers: Pollers): Promise<void> {
  if (!(await read($, isOpen)) && (await hasBand($))) return
  if (readsPrs(settings)) void refreshPrs($, settings, pollers)
  if (settings.showTickets) void refreshIssues($, settings, pollers)
  if (settings.showMail) void refreshMail($, settings, pollers)
}

async function fastPoll($: EngineInterface, settings: Settings, pollers: Pollers): Promise<void> {
  if (!(await read($, isOpen))) return
  void loadTodos($, settings)
  if (settings.showSpotify) void refreshSpotify($, settings, pollers)
  if (settings.showSessions) void refreshSessions($, pollers)
}

async function refreshOnOpen($: EngineInterface, settings: Settings, pollers: Pollers, force: boolean): Promise<void> {
  const time = await $.clock.now()
  const isStale = (fetchedAt: number | undefined) => force || fetchedAt === undefined || time - fetchedAt > STALE_MS
  if (readsPrs(settings) && isStale((await read($, prs))?.fetchedAt)) void refreshPrs($, settings, pollers)
  if (settings.showTickets && isStale((await read($, ticketList))?.fetchedAt)) void refreshIssues($, settings, pollers)
  if (settings.showMail && isStale((await read($, mail))?.fetchedAt)) void refreshMail($, settings, pollers)
  if (settings.showSpotify) void refreshSpotify($, settings, pollers)
  if (settings.showSessions) {
    pollers.sessions.isStale = true
    void refreshSessions($, pollers)
  }
  await update($, nowAtom, () => time)
}

// A playing track moves the clock once a second (a running pomodoro already does).
async function tickSpotify($: EngineInterface): Promise<void> {
  if (!(await read($, isOpen))) return
  if ((await read($, spotify))?.state !== 'playing' || (await read($, pomodoro)).phase !== 'idle') return
  const time = await $.clock.now()
  await update($, nowAtom, () => time)
}

// ---- Setting Pelyar up. Nothing it reads PRs or tickets from is there: no CLI logged in, no server
// with the tools. Only once the reads have said so, and not while both parts are switched off (that
// is a choice, not a missing setup).
async function isNothingConnected($: EngineInterface, settings: Settings): Promise<boolean> {
  const isMissing = (isOn: boolean, feed: unknown, error: string | null) => !isOn || (feed === null && error !== null && error.startsWith('not connected'))
  if (!readsPrs(settings) && !settings.showTickets) return false
  return (
    isMissing(readsPrs(settings), await read($, prs), await read($, prsError)) &&
    isMissing(settings.showTickets, await read($, ticketList), await read($, ticketListError))
  )
}

async function setSetup($: EngineInterface, value: 'offered' | 'done' | 'dismissed'): Promise<void> {
  // 'done' and 'dismissed' are final: a later offer does not undo them.
  const current = await read($, setupState)
  if (current === 'done' || current === 'dismissed' || current === value) return
  await $.store.set(SETUP_STORE_KEY, value)
  await update($, setupState, () => value)
}

// What Claude reads while Pelyar has never been set up and nothing is connected: offer the setup once.
const SETUP_SECTION =
  'The Pelyar panel plugin is installed in this session, but none of the sources it reads pull requests and tickets from is ' +
  'set up yet (no gh or glab login, no Jira, Linear or Bitbucket MCP server). At the end of your next answer, add one short ' +
  'sentence offering to set it up with the pelyar:setup skill (/pelyar:setup). Do not bring it up again unless the person asks.'
// Set while the section went into the request of the current turn; the turn's end marks the offer made.
let isOfferingSetup = false

// Opens or closes the card. It is a pane of its own, so no other plugin's band can cover it.
async function toggle($: EngineInterface, settings: Settings, pollers: Pollers, open?: boolean): Promise<boolean> {
  const wanted = open ?? !(await read($, isOpen))
  if (wanted) {
    // The team and its skills, the branch's ticket and the feeds are found here (not while drawing).
    void refreshTeam($, settings).catch(() => undefined)
    void refreshTicket($, settings, false, true)
    void refreshOnOpen($, settings, pollers, false)
    void loadTodos($, settings)
    const title = titleOf(settings.title)
    await $.ui.open({ id: PANE, title, closeOnEscape: true, rows: PANE_ROWS, columns: PANE_COLUMNS })
    // Taller than the window, the panel opens at its bottom (the tools and the session row), and
    // `end` keeps it there while rows are added above, until the person scrolls.
    void $.ui.scroll({ to: 'end', in: PANE }).catch(() => undefined)
  } else await $.ui.close({ id: PANE })
  await update($, isOpen, () => wanted)
  return wanted
}

export const register: Register = (on, options) => {
  let settings = settingsOf(options)
  const pollers: Pollers = { prs: pollerOf(), issues: pollerOf(), mail: pollerOf(), spotify: { inFlight: null }, sessions: { inFlight: null, isStale: false } }

  on('session.start', async ($, e, next) => {
    isDemo = demo.isDemoValue(await $.env.get('PELYAR_DEMO'))
    // The demo shows Mail too, and leaves out the team, which would read the person's own plugins.
    if (isDemo) settings = { ...settings, showMail: true, showTeam: false }
    try {
      await $.command.register({ name: COMMAND, description: 'Open, close or refresh the Pelyar panel, or set it up', argumentHint: '[open|close|refresh|setup]' })
    } catch {
      // Without /pelyar the footer button still opens it; the refreshes below must start either way.
    }
    sessionTty = undefined
    void readTerminalLight($)
    void refreshTeam($, settings).catch(() => undefined)
    void refreshTicket($, settings)
    void loadTodos($, settings)
    const storedSetup = await $.store.get(SETUP_STORE_KEY)
    await update($, setupState, () => (typeof storedSetup === 'string' ? storedSetup : null))
    await loadFolded($)
    await loadPinned($)
    // The pomodoro ticks from the start, panel open or not: a round that ends while it is closed is
    // still said. The panel reads the time from here, so the engine's clock rules it.
    await tickPomodoro($, settings)
    const startedAt = await $.clock.now()
    await update($, nowAtom, () => startedAt)
    $.clock.every(POMODORO_TICK_MS, () => void tickPomodoro($, settings))
    void slowPoll($, settings, pollers)
    // The demo's player and sessions are there before the panel first opens, for the screenshot.
    if (isDemo) {
      void refreshSpotify($, settings, pollers)
      void refreshSessions($, pollers)
    }
    $.clock.every(FEED_POLL_MS, () => void slowPoll($, settings, pollers))
    $.clock.every(FAST_POLL_MS, () => void fastPoll($, settings, pollers))
    $.clock.every(SPOTIFY_TICK_MS, () => void tickSpotify($))
    $.clock.every(MINUTE_MS, () => void $.clock.now().then(time => update($, nowAtom, () => time)))
    return next(e)
  })

  // A change of theme draws the panel again, in the background's shade for the new theme.
  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny === undefined) $.ui.invalidate('ui.render')
    return result
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'refresh') {
      await refreshOnOpen($, settings, pollers, true)
      return { text: 'Dashboard: refreshing' }
    }
    if (arg === 'setup') {
      // Not from within this hook: a command run here would wait on the turn the hook holds.
      $.clock.after(1, () => void $.command.run({ command: OWN_SETUP, args: '' }).catch(error => $.ui.toast(`Setup did not start: ${errorTextOf(error)}`)))
      return { text: 'Pelyar: setting up' }
    }
    if (arg !== '' && arg !== 'open' && arg !== 'close')
      return { text: `Usage: /${COMMAND}, /${COMMAND} open, /${COMMAND} close, /${COMMAND} refresh or /${COMMAND} setup` }
    const open = await toggle($, settings, pollers, arg === '' ? undefined : arg === 'open')
    return { text: open ? 'Pelyar open' : 'Pelyar closed' }
  }).catch(($, e, next) => (next.called ? next(e) : { text: 'Pelyar: could not open it' }))

  // Every close of the pane, the person's too (Esc, which closeOnEscape turns into a close, or the
  // close mark), so the footer button and /pelyar know it is closed.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    const result = await next(e)
    await update($, isOpen, () => false)
    return result
  })

  // Watches every command, typed or clicked: what ran this conversation decides the confirmations.
  on('command.run', async ($, e, next) => {
    const result = await next(e)
    const short = shortNameOf(e.command)
    if (short === 'clear') await update($, ran, () => ({ catchup: false, wrapup: false }))
    else await noteRun($, e.command)
    // A /model or /effort that ran, typed or pressed: the card reads the session's own values again
    // instead of the last request, which is from before the switch.
    if (short === 'model' || short === 'effort') {
      await update($, lastStep, () => null)
      await update($, chosen, value => ({ ...value, [short]: null }))
    }
    // A plugin installed, removed or reloaded changes the team's skills, and a reload that leaves this
    // plugin as it was does not start it again: read the team now, and once more when the session has
    // listed the new commands.
    if (RELOADING_COMMANDS.includes(short)) {
      void refreshTeam($, settings).catch(() => undefined)
      $.clock.after(RELOAD_SETTLE_MS, () => void refreshTeam($, settings).catch(() => undefined))
    }
    return result
    // An observer: whatever goes wrong here, the command itself runs (or keeps what it answered).
  }).catch(($, e, next) => next(e))

  // A conversation that ends (/clear, a resume into another one, an exit) takes its record along.
  on('session.end', async ($, e, next) => {
    const result = await next(e)
    await update($, ran, () => ({ catchup: false, wrapup: false }))
    return result
  }).catch(($, e, next) => next(e))

  // A Catchup or Wrapup the command watcher never sees: asked for in a sentence, so Claude
  // started it through the Skill tool. Fires for a typed /name too; counting twice is harmless.
  on('skill.prompt', async ($, e, next) => {
    const result = await next(e)
    await noteRun($, e.skill)
    return result
  }).catch(($, e, next) => next(e))

  // The context fill, and a nudge when it first passes 70% and 85% (the band toasts the same, so
  // only without it).
  on('session.measure', async ($, e, next) => {
    const percent = e.context.percent
    if (percent === undefined) return next(e)
    await update($, contextPercent, () => percent)
    const level = nudgeLevelOf(percent)
    const nudged = await read($, nudgeLevel)
    if (level > nudged && settings.showContext) {
      const names = (await $.command.list()).map(command => command.name)
      await notify($, [nudgeTextOf(percent, level, wrapupNameOf(settings, names))])
    }
    if (level !== nudged) await update($, nudgeLevel, () => level)
    return next(e)
  }).catch(($, e, next) => next(e))

  // Right after an install with nothing to read from, Claude offers the setup, once.
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    if (isDemo || (await read($, setupState)) !== null || !(await isNothingConnected($, settings))) return result
    isOfferingSetup = true
    return { sections: [...result.sections, { id: 'pelyar:setup', text: SETUP_SECTION, scope: 'session' as const }] }
  }).catch(($, e, next) => next(e))

  // Whether Claude is answering right now: the card says so, and a command started meanwhile queues.
  on('turn.start', async ($, e, next) => {
    await update($, isBusy, () => true)
    // The tab's profile may have changed since: its background is asked again.
    void readTerminalLight($)
    return next(e)
  })
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      await update($, isBusy, () => false)
      if (isOfferingSetup) {
        isOfferingSetup = false
        await setSetup($, 'offered')
      }
      // A turn may have switched the branch (git checkout); the tracker is asked only if the ticket changed.
      void refreshTicket($, settings)
    }
    return result
  })

  // What the engine really sent: shown in the card, so a change is visibly confirmed.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      await update($, lastStep, () => ({ model: e.model, effort: e.effort === undefined ? null : String(e.effort) }))
      // A pick stays shown until the engine really uses it (a /model queued behind an answer has not).
      const stepEffort = e.effort === undefined ? null : String(e.effort)
      await update($, chosen, value => ({
        model: value.model !== null && e.model.startsWith(value.model) ? null : value.model,
        effort: value.effort !== null && stepEffort === value.effort ? null : value.effort,
      }))
    }
    return yield* next(e)
  })

  // The button at the right of the prompt footer, beside the engine's own mode labels.
  on('ui.render', { component: 'SessionMode' }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const open = await read($, isOpen)
    const title = titleOf(settings.title)
    return (
      <Box flexDirection="row" columnGap={1}>
        {e.props.modes.length > 0 && <Text dimColor>{e.props.modes.join(' & ')}</Text>}
        <Button key="toggle-tools" plain onPress={() => void toggle($, settings, pollers)}>
          <Text backgroundColor="claude" color="inverseText" bold>
            {` ◆ ${titleCase(title)} ${open ? '▴' : '▾'} `}
          </Text>
        </Button>
      </Box>
    )
  })

  // The engine inverts whatever holds the focus ring, and it moves the ring to a neighbouring row
  // when a text field disappears (a row folding). Left alone that reads as a stuck highlight, so
  // every move to anything but a text field is sent to the status badge in the header instead. Every
  // text field of the panel has to be named here, or the cursor never gets into it.
  on('ui.focus', { requestId: PANE }, ($, e, next) => {
    const element = e.element
    if (element === undefined || element === FOCUS_HOME || TEXT_FIELDS.includes(element) || element.startsWith('arg-')) return next(e)
    return next({ ...e, element: FOCUS_HOME })
  }).catch(($, e, next) => (next.called ? next(e) : {}))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    // Every surface but mobile has a text field.
    const Input = 'Input' in elements ? elements.Input : null
    await read($, revision)
    const rows = await $.config.list()
    const commands = await $.command.list()
    const commandNames = commands.map(command => command.name)
    const commandOf = (short: string) => resolveCommand(commandNames, short)
    const now = await $.clock.now()
    const step = await read($, lastStep)
    const picked = await read($, chosen)
    const busy = await read($, isBusy)
    // An armed press past its time (its timer is lost on a reload) and a pending chip with no click
    // running (a reload drops the click) are drawn as nothing.
    const armedRead = await read($, armed)
    const armedNow = armedRead !== null && armedRead.until > now ? armedRead : null
    const pendingNow = isClickRunning() ? await read($, pending) : null
    const teamName = await read($, team)
    const guessedFrom = await read($, teamGuessedFrom)
    const diagnosis = await read($, teamDiagnosis)
    const folds = await read($, folded)
    const isUnfoldedSection = (key: Fold) => !folds.includes(key)
    const unfolded = await read($, openEntry)
    const branchTicket = await read($, ticket)
    const skills = await read($, teamSkills)
    const todoPath = await todoPathOf($, TODO_FILE)
    // A todo file that cannot be read must not take the whole panel down.
    const todoRead = await read($, todoFile)
    const todoProblem = todoPath === null ? 'no home directory for the todo file' : (todoRead?.problem ?? null)
    const todos = settings.showTodos ? openTodosOf(todoRead?.lines ?? []) : []
    const sessionModel = picked.model ?? step?.model ?? (await $.session.model())
    const effortRow = effortRowOf(rows)
    const currentEffort = picked.effort ?? step?.effort ?? (effortRow === undefined ? null : String(effortRow.value))
    const width = Math.min(CARD_WIDTH, e.props.bodyColumns)
    const inner = Math.max(10, width - 4)
    // The text width inside the team check's dashed frame: the indent and `╎ ` … ` ╎` taken off.
    const frameWidth = Math.max(20, inner - ITEM_INDENT - 4)
    const armedFor = (key: string) => (armedNow !== null && armedNow.key === key ? armedNow.message : null)
    // A prompt band mod may show the same todo file. Without it the todo list works the same (the
    // panel reads and writes the file itself).
    const band = commandOf('band') !== undefined
    const title = titleOf(settings.title)
    // What the context nudge suggests: the wrapup command where the session has one, else /compact.
    const saveCommand = wrapupNameOf(settings, commandNames) ?? '/compact'

    // The dashboard's feeds, as last read.
    const time = (await read($, nowAtom)) || now
    const percent = await read($, contextPercent)
    const level = percent === null ? 0 : nudgeLevelOf(percent)
    const timer = await read($, pomodoro)
    const player = await read($, spotify)
    const playerError = await read($, spotifyError)
    const mailbox = await read($, mail)
    const mailboxError = await read($, mailError)
    const feed = await read($, prs)
    const feedError = await read($, prsError)
    const tickets = await read($, ticketList)
    const ticketError = await read($, ticketListError)
    const otherSessions = (await read($, sessions)) ?? []
    const sessionError = await read($, sessionsError)

    const bump = () => update($, revision, value => value + 1)
    // The engine keeps the ring at a position, not on an element: when rows appear or vanish above
    // it, it lands on whatever now stands there. So every change of the list says where it goes:
    // into the field that is being typed in, or home to the status badge.
    const focusOn = (key: string) => void $.ui.focus({ requestId: PANE, key }).catch(() => undefined)
    // Opening a row puts the ring in its field, so the details can be typed straight away.
    const unfold = async (key: string) => {
      const next = (await read($, openEntry)) === key ? null : key
      await update($, openEntry, () => next)
      focusOn(next !== null && Input !== null ? `arg-${next}` : FOCUS_HOME)
    }
    const fold = async (key: Fold) => {
      const open = await foldSection($, key)
      focusOn(key === 'todo' && open && Input !== null ? 'todo-input' : FOCUS_HOME)
    }
    // Folding the open row before a command starts; the panel stays open, so the next run or the
    // todo list is one press away while the first one runs or waits in the queue.
    const beforeStart = async () => {
      await update($, openEntry, () => null)
      focusOn(FOCUS_HOME)
    }

    // Model and effort: read what is active at the moment of the press, not at the draw.
    const modelNow = async () => (await read($, chosen)).model ?? (await read($, lastStep))?.model ?? (await $.session.model())
    const effortNow = async () => {
      const row = effortRowOf(await $.config.list())
      return (await read($, chosen)).effort ?? (await read($, lastStep))?.effort ?? (row === undefined ? null : String(row.value))
    }
    const pickModel = (model: (typeof MODELS)[number]) =>
      once($, `model:${model.arg}`, async () => {
        if ((await modelNow()).startsWith(model.id)) {
          $.ui.toast(`${model.label} is already the active model`, { timeoutMs: 2000 })
          return
        }
        const command = commandOf('model')
        if (command === undefined) {
          $.ui.toast('/model is not available in this session')
          return
        }
        await update($, chosen, value => ({ ...value, model: model.id }))
        // Not awaited: a command waits until Claude is idle, and the other chips stay usable meanwhile.
        void $.command
          .run({ command, args: model.arg })
          .then(() => $.ui.toast(`Model: ${model.label} (also your default for new sessions)`, { timeoutMs: 3000 }))
          .catch(async error => {
            await update($, chosen, value => ({ ...value, model: null }))
            $.ui.toast(`Model not switched: ${errorTextOf(error)}`)
          })
      })
    const pickEffort = (effort: (typeof EFFORTS)[number]) =>
      once($, `effort:${effort.level}`, async () => {
        if ((await effortNow()) === effort.level) {
          $.ui.toast(`Effort is already ${effort.label}`, { timeoutMs: 2000 })
          return
        }
        const command = commandOf('effort')
        if (command !== undefined) {
          await update($, chosen, value => ({ ...value, effort: effort.level }))
          void $.command
            .run({ command, args: effort.level })
            .then(() => $.ui.toast(`Effort: ${effort.label}`, { timeoutMs: 2000 }))
            .catch(async error => {
              await update($, chosen, value => ({ ...value, effort: null }))
              $.ui.toast(`Effort not switched: ${errorTextOf(error)}`)
            })
          return
        }
        const row = effortRowOf(await $.config.list())
        if (row === undefined || row.isLocked) {
          $.ui.toast('This session has neither /effort nor an effort setting you can change')
          return
        }
        const { deny } = await $.config.set({ key: row.key, value: effort.level })
        if (deny !== undefined) throw new Error(deny)
        await update($, chosen, value => ({ ...value, effort: effort.level }))
        $.ui.toast(`Effort: ${effort.label}`, { timeoutMs: 2000 })
      })

    // TODO list: no empty, overlong or duplicate items; the item is found again before it changes;
    // the write goes through only if no one else wrote the file meanwhile; a failure is said.
    const todoAction = async (work: (path: string) => Promise<void>) => {
      if (isDemo) {
        $.ui.toast('Demo: the todo list is not written', { timeoutMs: 2000 })
        return
      }
      if (todoPath === null) {
        $.ui.toast('No home directory: cannot place the todo file')
        return
      }
      try {
        await work(todoPath)
      } catch (error) {
        $.ui.toast(`Todo: ${errorTextOf(error)}`)
      }
      await loadTodos($, settings)
    }
    const addTodo = (value: string) =>
      todoAction(async path => {
        const text = value.replace(/\s+/g, ' ').trim()
        focusOn('todo-input')
        if (text === '') {
          $.ui.toast('Type the todo first, then Enter', { timeoutMs: 2000 })
          return
        }
        if (text.length > TODO_MAX) {
          $.ui.toast(`Too long: ${text.length} characters, at most ${TODO_MAX}`)
          return
        }
        let isDuplicate = false
        const written = await changeTodos($, path, lines => {
          if (openTodosOf(lines).some(todo => todo.text.toLowerCase() === text.toLowerCase())) {
            isDuplicate = true
            return null
          }
          const kept = [...lines]
          while (kept.length > 0 && kept[kept.length - 1] === '') kept.pop()
          return [...kept, `- [ ] ${text}`]
        })
        if (isDuplicate) $.ui.toast('That one is already on the list', { timeoutMs: 2000 })
        if (written) $.ui.toast(`Added: ${text}`, { timeoutMs: 1500 })
        focusOn('todo-input')
      })
    // The removal is confirmed by the item's text, not its line: lines can move meanwhile.
    const finishTodo = (todo: OpenTodo, remove: boolean) =>
      todoAction(async path => {
        if (remove && !(await confirmed($, `todo-rm-${todo.line}:${todo.text}`, `Remove "${todo.text}"? Press ✕ again.`))) return
        let isGone = false
        const written = await changeTodos($, path, lines => {
          const index = locateTodo(lines, todo)
          if (index === null) {
            isGone = true
            return null
          }
          return remove ? lines.filter((_line, i) => i !== index) : lines.map((line, i) => (i === index ? line.replace(TODO_LINE, '$1x$3$4') : line))
        })
        if (isGone) $.ui.toast('The list changed in the meantime, nothing done', { timeoutMs: 2500 })
        if (written) {
          const undo = !remove && commandOf('todos') !== undefined ? ' (undo: /todos undo)' : ''
          $.ui.toast(remove ? `Removed: ${todo.text}` : `Done: ${todo.text}${undo}`, { timeoutMs: 2500 })
        }
        focusOn(FOCUS_HOME)
      })

    // The general entries and the team's skills, each with the command it runs.
    type Runnable = Entry & { command: string; description: string; origin?: string; isPinned?: boolean }
    const general: Runnable[] = GENERAL.flatMap(item => {
      const command = item.candidates.map(commandOf).find(name => name !== undefined)
      return command === undefined ? [] : [{ ...item, command, description: commands.find(info => info.name === command)?.description ?? '' }]
    })
    const session = SESSION.flatMap(item => {
      const found = sessionCommandOf(item, settings, commandNames)
      return found === null ? [] : [{ ...item, ...found }]
    })
    // A team skill found at the last refresh but gone from the session now is left out.
    const teamEntries: Runnable[] = skills.entries
      .filter((skill: TeamSkill) => commandNames.includes(skill.name))
      .map((skill: TeamSkill) => ({
        key: `team-${shortNameOf(skill.name)}`,
        label: skill.label,
        note: '',
        candidates: [skill.name],
        argHint: 'what to do (optional), Enter runs',
        command: skill.name,
        description: skill.description,
        origin: `from ${skill.source}${skill.auto ? ' · also loads itself when needed' : ''}`,
      }))
    const teamSources = [...new Set(skills.entries.filter((skill: TeamSkill) => commandNames.includes(skill.name)).map((skill: TeamSkill) => skill.source))]
    const teamPlugin = teamName === null ? null : teamPluginOf(teamName, settings.teamPrefix)
    // The commands pinned with the ＋, each a row like a team skill. One whose plugin is gone stays,
    // said so, until it is removed.
    const pinnedNames = await read($, pinned)
    const pinnedEntries: Runnable[] = pinnedNames.map(name => {
      const info = commands.find(command => command.name === name)
      return {
        key: `pin-${name}`,
        label: labelOf(name),
        note: '',
        candidates: [name],
        argHint: 'what to do (optional), Enter runs',
        command: name,
        description: info?.description ?? '',
        origin: info === undefined ? 'not in this session: its plugin is not installed or not loaded' : `pinned · from ${info.plugin?.split('@')[0] ?? info.source}`,
        isPinned: true,
      }
    })
    // The ＋ search: every command the session has that is not on the panel already, by name first,
    // then by what its description says.
    const isPinOpen = await read($, pinOpen)
    // As typed (shown in the new-skill row), and lowercased for the search.
    const typed = (await read($, pinQuery)).trim()
    const query = typed.toLowerCase()
    const onPanel = new Set([...pinnedNames, ...general.map(entry => entry.command), ...session.map(item => item.command), ...teamEntries.map(entry => entry.command)])
    const pinMatches =
      query === ''
        ? []
        : [
            ...commands.filter(command => !onPanel.has(command.name) && command.name.toLowerCase().includes(query)),
            ...commands.filter(
              command => !onPanel.has(command.name) && !command.name.toLowerCase().includes(query) && command.description.toLowerCase().includes(query),
            ),
          ]
    const pin = async (name: string) => {
      await setPinned($, current => (current.includes(name) ? current : [...current, name]))
      await update($, pinQuery, () => '')
      await update($, pinOpen, () => false)
      $.ui.toast(`Pinned under Work: /${shortNameOf(name)}`, { timeoutMs: 2000 })
      focusOn(FOCUS_HOME)
    }
    const unpin = async (name: string) => {
      await setPinned($, current => current.filter(item => item !== name))
      await update($, openEntry, () => null)
      focusOn(FOCUS_HOME)
    }
    // Nothing that exists fits: the same field starts a new skill, with any skill-creator the session has.
    const skillCreator = commands.find(command => shortNameOf(command.name) === 'skill-creator')
    const createSkill = async (text: string) => {
      if (skillCreator === undefined) return
      await update($, pinQuery, () => '')
      await update($, pinOpen, () => false)
      await startCommand($, { key: 'new-skill', command: skillCreator.name, args: `create a new skill: ${text}`, label: 'New skill', confirm: null }, beforeStart)
    }
    const togglePin = async () => {
      const open = !(await read($, pinOpen))
      await update($, pinOpen, () => open)
      await update($, pinQuery, () => '')
      if (open && !isUnfoldedSection('work')) await foldSection($, 'work')
      focusOn(open && Input !== null ? 'pin-search' : FOCUS_HOME)
    }

    const runEntry = async (entry: Runnable, value: string) => {
      const args = value.replace(/\s+/g, ' ').trim()
      if (entry.requires !== undefined && !entry.requires.test.test(args)) {
        $.ui.toast(entry.requires.message, { timeoutMs: 2500 })
        return
      }
      await startCommand($, { key: entry.key, command: entry.command, args, label: entry.label, confirm: null }, beforeStart)
    }
    // Pelyar's own wrapup commits CLAUDE.md where it is tracked, unless the settings say not to.
    const isCommittingWrapup = (command: string) => command === OWN_WRAPUP && settings.wrapupCommit
    const sessionConfirm = async (key: string, command: string): Promise<string | null> => {
      const done = await read($, ran)
      if (key === 'catchup') return done.catchup ? 'Catchup already ran in this conversation. Press again to run it once more.' : null
      if (key === 'wrapup') {
        if (done.wrapup) return 'Wrapup already ran in this conversation. Press again to run it once more.'
        return isCommittingWrapup(command)
          ? 'Wrapup updates CLAUDE.md and commits it when it is tracked. Press again to start it.'
          : 'Wrapup saves this session. Press again to start it.'
      }
      if (key === 'clear') {
        if ((await $.session.turns()) === 0) return null
        // Not "no Wrapup yet": whether one ran is not always seen (one Claude ran through another skill, or
        // in another window), so the warning is the same either way and claims nothing.
        return CLEAR_WARNING
      }
      return null
    }
    const refreshTicketNow = () => {
      if (isTicketLoading()) {
        $.ui.toast('The ticket is still being looked up', { timeoutMs: 2000 })
        return
      }
      void refreshTicket($, settings, true)
    }
    const openSettings = () =>
      void $.command.run({ command: 'plugin', args: `configure ${PLUGIN_ID}` }).catch(error => $.ui.toast(`Settings not opened: ${errorTextOf(error)}`, { timeoutMs: 4000 }))
    // The one ↻ in the header: the dashboard's feeds, the team and its skills, the branch's ticket.
    const refreshAll = () => {
      $.ui.toast('Refreshing', { timeoutMs: 1500 })
      void refreshOnOpen($, settings, pollers, true)
      void refreshTeam($, settings).catch(error => $.ui.toast(`Team not read: ${String(error)}`, { timeoutMs: 6000 }))
      void refreshTicket($, settings, true)
      void readTerminalLight($)
      void loadTodos($, settings)
    }
    // The tools' own reload: the team and its skills and the branch's ticket, read again. A failure is
    // said instead of swallowed, so a panel that loaded half shows why.
    // The team is read again first: when that now finds it, the check has nothing to say and is closed.
    const explainTeam = () => {
      if (isDiagnosing) {
        $.ui.toast('Still checking, one moment', { timeoutMs: 1500 })
        return
      }
      isDiagnosing = true
      $.ui.toast('Checking how the team is read', { timeoutMs: 1500 })
      void refreshTeam($, settings)
        .catch(() => undefined)
        .then(async () => (await isTeamResolved($) ? null : await diagnoseTeam($, settings)))
        .then(lines => update($, teamDiagnosis, () => lines))
        .catch(error => $.ui.toast(`Check failed: ${errorTextOf(error)}`, { timeoutMs: 6000 }))
        .finally(() => {
          isDiagnosing = false
        })
    }

    // Drawing helpers. The terminal has no pointer cursor, so every clickable thing lights under
    // the mouse instead: the keyed Box scopes the hover, and the Text inside it changes style.
    const HOVER = { underline: true, bold: true, dimColor: false } as const
    const divider = (key: string) => (
      <Box key={key}>
        <Text dimColor>{'─'.repeat(inner)}</Text>
      </Box>
    )
    const label = (text: string) => (
      <Box width={LABEL_WIDTH} flexShrink={0}>
        <Text dimColor bold>
          {text}
        </Text>
      </Box>
    )
    // A section title reads as a title: in colour, spaced out, a dim summary beside it while folded
    // or not, and the fold mark at the right. The rows under it are indented by ITEM_INDENT.
    const sectionHead = (key: Fold, text: string, summary: string, controls?: RenderChildren) => {
      const open = isUnfoldedSection(key)
      return (
        <Box key={`${key}-head`} flexDirection="row" justifyContent="space-between" marginBottom={open ? 1 : 0}>
          {/* The title, its summary and, a little apart from them, the section's own controls (Work's ＋). */}
          <Box key={`${key}-title`} flexShrink={1} flexDirection="row" columnGap={2}>
            <Button key={`${key}-btn`} plain onPress={() => void fold(key)}>
              <Text color="claude" bold>
                {spaced(text)}
              </Text>
              {summary !== '' && <Text dimColor>{`  ·  ${fit(summary, Math.max(8, inner - text.length * 2 - (controls === undefined || controls === false ? 8 : 14)))}`}</Text>}
            </Button>
            {controls}
          </Box>
          <Box key={`${key}-fold`}>
            <Button key={`${key}-fold-btn`} plain onPress={() => void fold(key)}>
              <Text dimColor hover={HOVER}>
                {open ? '▾' : '▸'}
              </Text>
            </Button>
          </Box>
        </Box>
      )
    }
    // A list inside a section: a fold arrow, a name with its count, a note; on the right, when
    // the list was read, the time and a refresh mark.
    const listHead = (key: Fold, name: string, note: string, color: string, fetchedAt: number | null, refresh: (() => void) | null) => {
      const open = isUnfoldedSection(key)
      return (
        <Box key={`${key}-head`} flexDirection="row" justifyContent="space-between">
          <Box key={`${key}-title`} flexShrink={1}>
            <Button key={`${key}-btn`} plain onPress={() => void fold(key)}>
              <Text color={color}>{open ? '▾ ' : '▸ '}</Text>
              <Text bold={open} hover={HOVER}>
                {fit(name, NAME_WIDTH - 2).padEnd(NAME_WIDTH - 2)}
              </Text>
              <Text dimColor>{` ${fit(note, Math.max(8, inner - ITEM_INDENT - NAME_WIDTH - 10))}`}</Text>
            </Button>
          </Box>
          {refresh !== null && (
            <Box key={`${key}-refresh`}>
              <Button key={`${key}-refresh-btn`} plain onPress={refresh}>
                <Text dimColor hover={HOVER}>
                  {`${fetchedAt === null ? '' : `${clockTimeOf(fetchedAt)} `}↻`}
                </Text>
              </Button>
            </Box>
          )}
        </Box>
      )
    }
    // A chip with a hotkey: the engine draws "1: " in front of it, so the text starts right after the
    // colon and the room between chips comes from the row's gap, not from padding in the text.
    const chip = (key: string, text: string, hotkey: string, state: 'active' | 'pending' | 'idle', activeColor: string, onPress: () => void) => (
      <Box key={key}>
        <Button key={`${key}-btn`} plain hotkey={hotkey} onPress={onPress}>
          {state === 'active' ? (
            <Text backgroundColor={activeColor} color="inverseText" bold>{`${text} `}</Text>
          ) : state === 'pending' ? (
            <Text color="warning">{`${text}…`}</Text>
          ) : (
            <Text dimColor hover={{ dimColor: false, underline: true }}>{text}</Text>
          )}
        </Button>
      </Box>
    )
    // A small control: a glyph and a word, lit under the mouse.
    const control = (key: string, text: string, onPress: () => void, isDim = true) => (
      <Box key={key}>
        <Button key={`${key}-btn`} plain onPress={onPress}>
          <Text dimColor={isDim && !isPlayerIcon(text)} bold={isPlayerIcon(text)} hover={HOVER}>
            {text}
          </Text>
        </Button>
      </Box>
    )
    // A text field the eye finds: a caption saying what to type and what Enter does, then the field
    // in a thin frame with a prompt mark. A bare Input reads as one more line of text.
    const field = (key: string, caption: string, placeholder: string, submitLabel: string, onSubmit: (value: string) => void, onInput?: (value: string) => void) =>
      Input === null ? null : (
        <Box key={`${key}-field`} flexDirection="column">
          <Text color="suggestion" dimColor>{`✎ ${caption}`}</Text>
          <Box borderStyle="round" borderColor="suggestion" borderDimColor paddingX={1} flexDirection="row">
            {/* The mark is drawn beside the field, not as its label: the engine follows a label with
                ": ". The placeholder starts with a space so the empty field's cursor block sits on
                that space instead of inverting the placeholder's first letter. */}
            <Text color="suggestion">{'› '}</Text>
            <Input
              key={key}
              placeholder={` ${placeholder}`}
              submitLabel={submitLabel}
              onSubmit={(value: string) => onSubmit(value)}
              {...(onInput === undefined ? {} : { onInput: (value: string) => onInput(value) })}
            />
          </Box>
        </Box>
      )
    // A row that unfolds: glyph, name, a short note; open, the description, an argument field and
    // a run button underneath.
    const entryRow = (entry: Runnable, color: string, indent: number) => {
      const isUnfolded = unfolded === entry.key
      // A row shows a short note of its own (Review a PR, Search) beside the name; a skill shows its
      // full name only, and its description when the row is unfolded, not cut off in the row.
      const hasNote = entry.note !== ''
      const nameWidth = hasNote ? NAME_WIDTH : inner - indent
      const noteWidth = Math.max(8, inner - indent - nameWidth - 2)
      return (
        <Box key={entry.key} flexDirection="column" paddingLeft={indent}>
          <Box key={`${entry.key}-head`}>
            <Button key={`${entry.key}-btn`} plain onPress={() => void unfold(entry.key)}>
              <Text color={color}>{isUnfolded ? '▾ ' : '▸ '}</Text>
              <Text bold={isUnfolded} dimColor={busy} hover={HOVER}>
                {hasNote ? fit(entry.label, nameWidth - 2).padEnd(nameWidth - 2) : fit(entry.label, nameWidth - 2)}
              </Text>
              {hasNote && <Text dimColor>{` ${fit(entry.note, noteWidth)}`}</Text>}
            </Button>
          </Box>
          {isUnfolded && (
            <Box key={`${entry.key}-body`} flexDirection="column" paddingLeft={2} marginBottom={1}>
              {entry.description !== '' && <Text dimColor wrap="wrap">{shortDescriptionOf(entry.description)}</Text>}
              <Text dimColor italic>{`runs /${shortNameOf(entry.command)}${entry.requires === undefined ? ' [details]' : ' <details>'}`}</Text>
              {entry.origin !== undefined && <Text dimColor italic wrap="wrap">{entry.origin}</Text>}
              {busy && <Text color="warning">Claude is answering: a run now queues behind the answer.</Text>}
              {Input !== null ? (
                field(`arg-${entry.key}`, entry.requires === undefined ? 'details · Enter runs' : 'required · Enter runs', entry.argHint, 'run', value => void runEntry(entry, value))
              ) : (
                <Text dimColor>{`type /${shortNameOf(entry.command)} at the prompt`}</Text>
              )}
              {entry.isPinned === true && (
                <Box key={`${entry.key}-unpin`}>
                  <Button key={`${entry.key}-unpin-btn`} plain onPress={() => void unpin(entry.command)}>
                    <Text dimColor hover={{ dimColor: false, color: 'error', bold: true }}>{'✕ remove from Work'}</Text>
                  </Button>
                </Box>
              )}
              {entry.requires === undefined && (
                <Box key={`${entry.key}-run`}>
                  <Button key={`${entry.key}-run-btn`} plain onPress={() => void runEntry(entry, '')}>
                    <Text color="success">{'▶ '}</Text>
                    <Text hover={HOVER}>run without details</Text>
                  </Button>
                </Box>
              )}
            </Box>
          )}
        </Box>
      )
    }
    // The branch and its ticket, under the header; a press opens the ticket, ↻ asks its tracker again.
    // The status shows the reason when the tracker could not say (not found, no answer, no access).
    const shownStatus =
      branchTicket === null || branchTicket.key === null
        ? ''
        : branchTicket.error !== null
          ? branchTicket.error
          : branchTicket.status === ''
            ? 'loading…'
            : branchTicket.status
    const ticketRow =
      branchTicket === null ? null : (
        <Box key="ticket-row" flexDirection="row" justifyContent="space-between">
          <Box key="ticket-open" flexShrink={1}>
            <Button key="ticket-btn" plain onPress={() => void (branchTicket.key === null ? undefined : openLink($, branchTicket.url))}>
              {!settings.showContext && <Text dimColor>{'⎇ '}</Text>}
              {branchTicket.key === null ? (
                <Text dimColor>{fit(branchTicket.branch, inner - 4)}</Text>
              ) : (
                <Text bold hover={HOVER}>
                  {branchTicket.key}
                </Text>
              )}
              {branchTicket.key !== null && (
                <Text
                  color={branchTicket.error !== null ? undefined : branchTicket.category === 'done' ? 'success' : branchTicket.category === 'indeterminate' ? 'warning' : undefined}
                  dimColor={branchTicket.status === '' || branchTicket.error !== null}
                >
                  {` · ${fit(shownStatus, Math.max(8, inner - branchTicket.key.length - 8))}`}
                </Text>
              )}
              {branchTicket.key !== null && branchTicket.error === null && branchTicket.summary !== '' && (
                <Text dimColor>{` ${fit(branchTicket.summary, Math.max(4, inner - branchTicket.key.length - shownStatus.length - 10))}`}</Text>
              )}
            </Button>
          </Box>
          {branchTicket.key !== null && (
            <Box key="ticket-refresh">
              <Button key="ticket-refresh-btn" plain onPress={refreshTicketNow}>
                <Text dimColor hover={HOVER}>
                  ↻
                </Text>
              </Button>
            </Box>
          )}
        </Box>
      )
    // The palette's shade for the theme in use, read with the other /config rows above.
    // The terminal's own background when it says, else the Theme row.
    const isLight = (await read($, terminalLight)) ?? isLightThemeName(rows.find(row => row.key === 'theme')?.value)
    const background = settings.background?.[isLight ? 'light' : 'dark']
    const statusDot = busy ? <Text color="warning">● working</Text> : <Text color="success">● ready</Text>
    const sessionWarning = session.map(item => armedFor(`s-${item.key}`)).find(message => message !== null)

    // ---- The dashboard, drawn like the prompt band: each part a bold title with its summary and its
    // controls on one line, its items under it, one per line. Lists show up to DASH_ITEMS; the rest
    // is "+n more".
    const DASH_ITEMS = 8
    const MAIL_ITEMS = 3
    const MEETING_ITEMS = 3
    const contentRoom = (used: number) => Math.max(10, inner - ITEM_INDENT - used)
    const contextColor = level === 2 ? 'red' : level === 1 ? 'yellow' : undefined
    const hasPlayer = player !== null && player.state !== 'off'
    const mine = feed?.mine ?? []
    const reviewing = feed?.reviewing ?? []
    const me: Me = feed?.me ?? {}
    const issues = tickets?.issues ?? []
    const ticketsWithPr = new Set(mine.map(pr => ticketOf(pr)))
    const unreadCount = mailbox?.unread.length ?? 0
    const upcoming = (mailbox?.meetings ?? []).filter(meeting => meeting.end > time)
    const hasSessionRow = settings.showSessions && (otherSessions.length > 0 || sessionError !== null)
    const ready = mine.filter(pr => statusOf(pr).label === 'ready').length
    const attention = mine.filter(pr => statusOf(pr).color === 'red').length
    const toReview = reviewing.filter(pr => myReviewOf(pr, me).isPending).length
    const working = otherSessions.filter(claudeSessions.isWorking).length
    const dim = (key: string, text: string) => (
      <Text key={key} dimColor>
        {fit(text, contentRoom(0))}
      </Text>
    )
    const more = (key: string, hidden: number) => (hidden > 0 ? dim(key, `+${hidden} more`) : null)
    // A part whose server is not connected says so dimly: nothing is broken, it is not set up.
    const failed = (key: string, text: string | null) =>
      text === null ? null : (
        <Text key={key} color={text.startsWith('not connected') ? undefined : 'error'} dimColor={text.startsWith('not connected')}>
          {fit(text, contentRoom(0))}
        </Text>
      )
    // A part: the title line (name, summary, controls at the right), then its lines, indented.
    // A part of the dashboard: its name, a one-line summary and the controls on one row, its lines
    // below. A press anywhere on the row left of the controls folds the lines; the summary stays.
    type Summary = { text: string; color?: string; isDim?: boolean; isBold?: boolean; tail?: string }
    type Control = { key: string; text: string; onPress: () => void; isDim?: boolean }
    const part = (key: string, name: string, color: string, summary: Summary, lines: RenderChildren, controls: Control[] = []) => {
      // The context row is not a fold: its lines always show.
      const canFold = isFold(key)
      const open = !canFold || isUnfoldedSection(key)
      const controlsWidth = controls.reduce((width, item) => width + item.text.length + 2, 0) + (canFold ? 2 : 0)
      const room = Math.max(4, inner - name.length - controlsWidth - 2)
      const shown = fit(summary.text, room)
      const tail = summary.tail === undefined ? '' : fit(summary.tail, Math.max(0, room - shown.length))
      return (
        <Box key={key} flexDirection="column">
          <Box key={`${key}-head`} flexDirection="row" justifyContent="space-between">
            <Box key={`${key}-title`} flexShrink={1}>
              <Button key={`${key}-btn`} plain onPress={() => void (canFold ? fold(key as Fold) : undefined)}>
                <Text bold color={color} hover={canFold ? HOVER : undefined}>
                  {name}
                </Text>
                <Text color={summary.color} dimColor={summary.isDim} bold={summary.isBold}>
                  {` ${shown}`}
                </Text>
                {tail !== '' && <Text dimColor>{tail}</Text>}
                <Text>{' '.repeat(Math.max(0, room - shown.length - tail.length))}</Text>
              </Button>
            </Box>
            <Box key={`${key}-controls`} flexDirection="row" columnGap={2} flexShrink={0}>
              {controls.map(item => control(item.key, item.text, item.onPress, item.isDim ?? true))}
              {canFold && (
                <Box key={`${key}-fold`}>
                  <Button key={`${key}-fold-btn`} plain onPress={() => void fold(key as Fold)}>
                    {/* A space before the mark, so it sits as far from the last control as the controls from each other. */}
                    <Text dimColor hover={HOVER}>
                      {open ? ' ▾' : ' ▸'}
                    </Text>
                  </Button>
                </Box>
              )}
            </Box>
          </Box>
          {open && (
            <Box key={`${key}-lines`} flexDirection="column" paddingLeft={ITEM_INDENT}>
              {lines}
            </Box>
          )}
        </Box>
      )
    }
    const linkText = (key: string, text: string, color: string, url: string, isDim = false) => (
      <Box key={key}>
        <Button key={`${key}-btn`} plain onPress={() => void openLink($, url)}>
          <Text color={color} dimColor={isDim} hover={HOVER}>
            {text}
          </Text>
        </Button>
      </Box>
    )
    const prLine = (pr: PullRequest, color: string, isDim: boolean, state: { text: string; color: string | undefined }, tail: string) => (
      <Box key={`pr-${pr.key}`} flexDirection="row" columnGap={1}>
        {linkText(`pr-open-${pr.key}`, `[${ticketOf(pr)}]`, color, pr.url, isDim)}
        <Text color={color}>{fit(pr.repo, 18)}</Text>
        {state.color === undefined ? <Text dimColor>{state.text}</Text> : <Text color={state.color}>{state.text}</Text>}
        <Text dimColor>{fit(tail, Math.max(4, contentRoom(0) - ticketOf(pr).length - Math.min(18, pr.repo.length) - state.text.length - 6))}</Text>
      </Box>
    )
    // The context row also says where the session works, as the status line does: ⎇ branch · repo.
    const whereText =
      branchTicket === null ? '' : ` · ⎇ ${branchTicket.branch}${typeof branchTicket.repo === 'string' ? ` · ${branchTicket.repo}` : ''}`
    const sections: RenderChildren[] = []
    // The context row and the session commands sit above the parts and stay when the dashboard folds.
    // A thin line above every part, the first (Pomodoro) too, which sets the parts apart from the
    // session buttons above them.
    const add = (part: RenderChildren) => {
      sections.push(
        <Box key={`part-sep-${sections.length}`}>
          <Text dimColor>{'─'.repeat(inner)}</Text>
        </Box>,
        part,
      )
    }

    const contextPart = !settings.showContext
      ? null
      : part(
          'context',
          'Context',
          'claude',
          { ...(contextColor === undefined ? { isDim: true } : { color: tone(contextColor), isBold: level === 2 }), text: meterOf(percent), tail: whereText },
          [
            // The branch's ticket, when its name carries one: key, status, summary.
            branchTicket !== null && branchTicket.key !== null && ticketRow,
            level === 0 ? (
              dim('context-nudge', `${saveCommand} nudge at ${NUDGE_PERCENT}%`)
            ) : (
              <Text key="context-nudge" color={tone(contextColor)} bold={level === 2}>
                {level === 2 ? `${saveCommand} now, then /clear` : `time to ${saveCommand}, then /clear`}
              </Text>
            ),
          ],
        )

    // The pomodoro is one row and does not fold. It always reads "Pomodoro" in the panel's orange; the
    // phase and the time follow it: focus in the same orange, break in green, paused in yellow, idle dim.
    if (settings.showPomodoro) {
      const isPaused = pomodoroClock.isPaused(timer)
      const phaseColor = timer.phase === 'idle' ? undefined : isPaused ? 'warning' : timer.phase === 'break' ? BREAK_COLOR : 'claude'
      add(
        <Box key="pomodoro" flexDirection="row" justifyContent="space-between" columnGap={1}>
          <Box key="pomodoro-title" flexDirection="row" columnGap={1} flexShrink={1}>
            <Text key="pomodoro-name" bold color="claude">
              Pomodoro
            </Text>
            <Text key="pomodoro-dot" color={phaseColor} dimColor={phaseColor === undefined}>
              ●
            </Text>
            <Text key="pomodoro-phase" color={phaseColor} dimColor={phaseColor === undefined} bold={phaseColor !== undefined}>
              {pomodoroLineOf(timer, time)}
            </Text>
            {timer.completed > 0 && timer.day === pomodoroClock.dayOf(time) && <Text dimColor>{`· ${timer.completed} today`}</Text>}
          </Box>
          {/* The controls stand in Spotify's columns: pause/resume, skip and stop under prev, play and
              next, the last cell empty where Spotify has its fold; idle, the ▶ of Start right under Spotify's ▶. */}
          <Box key="pomodoro-controls" flexDirection="row" columnGap={2} flexShrink={0}>
            {timer.phase === 'idle' && control('pomodoro-start', POMODORO_ICONS.start, () => void changePomodoro($, (current, time) => pomodoroClock.start(current, time, settings.pomodoroLengths)), false)}
            {timer.phase !== 'idle' && !isPaused && control('pomodoro-pause', POMODORO_ICONS.pause, () => void changePomodoro($, pomodoroClock.pause))}
            {isPaused && control('pomodoro-resume', POMODORO_ICONS.resume, () => void changePomodoro($, pomodoroClock.resume), false)}
            {timer.phase !== 'idle' && control('pomodoro-skip', POMODORO_ICONS.skip, () => void changePomodoro($, (current, time) => pomodoroClock.skip(current, time, settings.pomodoroLengths)))}
            {timer.phase !== 'idle' && control('pomodoro-stop', POMODORO_ICONS.stop, () => void changePomodoro($, pomodoroClock.stop))}
            <Text key="pomodoro-fold-cell">{'  '}</Text>
          </Box>
        </Box>,
      )
    }

    if (settings.showSpotify && (hasPlayer || playerError !== null))
      add(
        part(
          'spotify',
          spotifyPlayer.appLabelOf(player?.app ?? ''),
          SPOTIFY_COLOR,
          player?.state === 'playing' ? { text: spotifyLineOf(player, time), color: SPOTIFY_COLOR } : { text: spotifyLineOf(player, time), isDim: true },
          [
            player !== null && spotifyPlayer.isLoaded(player) && (
              <Text key="spotify-track" dimColor={player.state !== 'playing'}>
                {fit(spotifyPlayer.trackOf(player), contentRoom(0))}
              </Text>
            ),
            failed('spotify-error', playerError),
          ],
          hasPlayer
            ? [
                // Icons only, a space either side so each is a wider target and they stand apart.
                { key: 'spotify-prev', text: SPOTIFY_ICONS.prev, onPress: () => void controlSpotify($, settings, pollers, 'prev') },
                player?.state === 'playing'
                  ? { key: 'spotify-pause', text: SPOTIFY_ICONS.pause, onPress: () => void controlSpotify($, settings, pollers, 'pause'), isDim: false }
                  : { key: 'spotify-play', text: SPOTIFY_ICONS.play, onPress: () => void controlSpotify($, settings, pollers, 'play'), isDim: false },
                { key: 'spotify-next', text: SPOTIFY_ICONS.next, onPress: () => void controlSpotify($, settings, pollers, 'next') },
              ]
            : [],
        ),
      )

    if (settings.showMail)
      add(
        part(
          'mail',
          'Mail',
          TICKET_COLOR,
          mailbox === null
            ? { text: mailboxError === null ? 'loading…' : 'not read yet', isDim: true }
            : unreadCount === 0
              ? { text: 'no unread mail', isDim: true }
              : { text: `${unreadCount >= 50 ? '50+' : unreadCount} unread`, color: 'warning' },
          [
            ...(mailbox?.unread ?? []).slice(0, MAIL_ITEMS).map(mail => (
              <Box key={`mail-${mail.id}`} flexDirection="row" columnGap={1}>
                <Text color="warning">✉</Text>
                <Text bold>{fit(firstNameOf(mail.from), 14)}</Text>
                <Text dimColor>{fit(mail.subject, Math.max(4, contentRoom(0) - Math.min(14, firstNameOf(mail.from).length) - 4))}</Text>
              </Box>
            )),
            more('mail-more', unreadCount - MAIL_ITEMS),
            mailbox !== null && upcoming.length === 0 && dim('meetings-none', `no meetings in ${CALENDAR_DAYS} days`),
            ...upcoming.slice(0, MEETING_ITEMS).map(meeting => {
              const when = mailFeed.whenOf(meeting, time)
              const color = meetingColorOf(meeting, time)
              return (
                <Box key={`meeting-${meeting.start}-${meeting.subject}`} flexDirection="row" columnGap={1}>
                  <Text color={TICKET_COLOR}>▦</Text>
                  {color === undefined ? <Text dimColor>{when}</Text> : <Text color={tone(color)}>{when}</Text>}
                  <Text>{fit(`${meeting.subject}${meeting.isUnanswered ? ' ?' : ''}`, Math.max(4, contentRoom(0) - when.length - 3))}</Text>
                </Box>
              )
            }),
            failed('mail-error', mailboxError),
          ],
        ),
      )

    if (settings.showPrs)
      add(
        part(
          'prs',
          'My PRs',
          MINE_COLOR,
          { text: feed === null ? (feedError === null ? 'loading…' : 'not read yet') : `${mine.length} open · ${ready} ready · ${attention} need attention`, isDim: true },
          [
            feed !== null && mine.length === 0 && dim('prs-none', 'none open'),
            ...mine.slice(0, DASH_ITEMS).map(pr => {
              const status = statusOf(pr)
              return prLine(pr, MINE_COLOR, false, { text: status.label, color: tone(status.color) }, `✓${pr.approvals}/${pr.reviewers}`)
            }),
            more('prs-more', mine.length - DASH_ITEMS),
            failed('prs-error', feedError),
          ],
        ),
      )
    // Other PRs waits for the read while My PRs shows it; on its own it says loading and the error itself.
    if (settings.showReviewPrs && (feed !== null || !settings.showPrs))
      add(
        part(
          'review',
          'Other PRs',
          OTHER_COLOR,
          { text: feed === null ? (feedError === null ? 'loading…' : 'not read yet') : `${reviewing.length} open · ${toReview} to review`, isDim: true },
          [
            feed !== null && reviewing.length === 0 && dim('review-none', 'nothing to review'),
            ...reviewing.slice(0, DASH_ITEMS).map(pr => {
              const review = myReviewOf(pr, me)
              const color = review.isPending ? 'warning' : review.label === 'approved' ? 'success' : undefined
              return prLine(pr, OTHER_COLOR, !review.isPending, { text: review.label, color }, firstNameOf(pr.author))
            }),
            more('review-more', reviewing.length - DASH_ITEMS),
            !settings.showPrs && failed('review-error', feedError),
          ],
        ),
      )

    if (settings.showTickets)
      add(
        part(
          'issues',
          'Tickets',
          TICKET_COLOR,
          { text: tickets === null ? (ticketError === null ? 'loading…' : 'not read yet') : `${issues.length} assigned`, isDim: true },
          [
            tickets !== null && issues.length === 0 && dim('issues-none', 'no open tickets'),
            ...issues.slice(0, DASH_ITEMS).map(issue => {
              const color = issueFeed.statusColorOf(issue)
              const hasPr = ticketsWithPr.has(issue.key)
              const room = contentRoom(0) - issue.key.length - issue.status.length - (hasPr ? 3 : 0) - 3
              return (
                <Box key={`issue-${issue.source}-${issue.key}`} flexDirection="row" columnGap={1}>
                  {linkText(`issue-open-${issue.key}`, issue.key, TICKET_COLOR, issue.url)}
                  {color === undefined ? <Text dimColor>{issue.status}</Text> : <Text color={tone(color)}>{issue.status}</Text>}
                  {hasPr && <Text color={MINE_COLOR}>PR</Text>}
                  <Text>{fit(issue.summary, Math.max(4, room))}</Text>
                </Box>
              )
            }),
            more('issues-more', issues.length - DASH_ITEMS),
            failed('issues-error', ticketError),
          ],
        ),
      )

    if (hasSessionRow)
      add(
        part(
          'sessions',
          'Claude sessions',
          SESSION_COLOR,
          { text: `${otherSessions.length} open · ${working} working`, isDim: true },
          [
            ...otherSessions.slice(0, DASH_ITEMS).map(item => {
              const state = claudeSessions.stateOf(item)
              const age = claudeSessions.ageOf(time - item.statusSince)
              const kind = item.kind === '' || item.kind === 'interactive' ? '' : ` (${item.kind})`
              return (
                <Box key={`session-${item.pid}`} flexDirection="row" columnGap={1}>
                  <Text>{fit(`${item.name}${kind}`, Math.max(8, contentRoom(0) - state.label.length - age.length - 2))}</Text>
                  {state.color === undefined ? <Text dimColor>{state.label}</Text> : <Text color={tone(state.color)}>{state.label}</Text>}
                  <Text dimColor>{age}</Text>
                </Box>
              )
            }),
            more('sessions-more', otherSessions.length - DASH_ITEMS),
            failed('sessions-error', sessionError),
          ],
        ),
      )

    // Catchup, Wrapup and Clear on a row of their own right under the context they act on, between two
    // lines; each guarded by a second press where it costs, the warning of an armed one under them.
    const sessionRow =
      session.length === 0 || !settings.showSessionCommands ? null : (
        // The three session commands as buttons of equal width, each framed in its own colour so they
        // stand out from the rows of text around them; the frames dim while Claude answers.
        // Without the context row the header's own bottom margin already sets the buttons apart.
        <Box key="session" flexDirection="column" marginTop={contextPart === null ? 0 : 1} marginBottom={1}>
          <Box key="session-row" flexDirection="row" columnGap={1}>
            {session.map(item => (
              <Box
                key={`s-${item.key}`}
                width={Math.floor((inner - (session.length - 1)) / session.length)}
                justifyContent="center"
                borderStyle="round"
                borderColor={armedFor(`s-${item.key}`) !== null ? 'warning' : item.color}
                borderDimColor={busy}
              >
                <Button
                  key={`s-${item.key}-btn`}
                  plain
                  onPress={() => {
                    if (item.isMissing) {
                      $.ui.toast(`/${item.command} is not in this session: check the ${item.label} command in Settings`, { timeoutMs: 4000 })
                      return
                    }
                    const args = item.command === OWN_WRAPUP && !settings.wrapupCommit ? 'no-commit' : ''
                    void sessionConfirm(item.key, item.command).then(confirm =>
                      startCommand($, { key: `s-${item.key}`, command: item.command, args, label: item.label, confirm }, beforeStart),
                    )
                  }}
                >
                  <Text color={item.color} dimColor={busy}>{`${item.glyph} `}</Text>
                  <Text bold dimColor={busy} color={armedFor(`s-${item.key}`) !== null ? 'warning' : undefined} hover={HOVER}>
                    {armedFor(`s-${item.key}`) !== null ? `${item.label}?` : item.label}
                  </Text>
                </Button>
              </Box>
            ))}
          </Box>
          {sessionWarning !== undefined && sessionWarning !== null && <Text color="warning">{sessionWarning}</Text>}
        </Box>
      )
    // Nothing to read PRs or tickets from, and the setup has not run: a row that starts it, and a ✕.
    const setupNow = await read($, setupState)
    const setupRow =
      setupNow === 'done' || setupNow === 'dismissed' || !(await isNothingConnected($, settings)) || commandOf(OWN_SETUP) === undefined ? null : (
        <Box key="setup" flexDirection="row" justifyContent="space-between" marginBottom={1}>
          <Box key="setup-start" flexShrink={1}>
            <Button
              key="setup-btn"
              plain
              onPress={() => void startCommand($, { key: 'setup', command: OWN_SETUP, args: '', label: 'Setup', confirm: null }, beforeStart)}
            >
              <Text color="warning">{'⚑ '}</Text>
              <Text dimColor>{fit('No PR or ticket source connected yet. ', Math.max(4, inner - 20))}</Text>
              <Text color="suggestion" bold hover={HOVER}>
                Set up
              </Text>
            </Button>
          </Box>
          <Box key="setup-dismiss">
            <Button key="setup-dismiss-btn" plain onPress={() => void setSetup($, 'dismissed')}>
              <Text dimColor hover={{ dimColor: false, color: 'error', bold: true }}>{' ✕ '}</Text>
            </Button>
          </Box>
        </Box>
      )
    const dashboard = (
      <Box key="dashboard" flexDirection="column" marginBottom={1}>
        {/* The title on a row of its own, centred, so a narrow panel cuts neither it nor the controls;
            spaced out while it fits, plain when not. */}
        <Box key="dash-title" flexDirection="row" justifyContent="center" marginBottom={1}>
          <Button key="dashboard-btn" plain onPress={() => void fold('dashboard')}>
            <Text color="claude" bold>
              {`◆ ${spaced(title).length + 2 <= inner ? spaced(title) : fit(title, inner - 2)}`}
            </Text>
          </Button>
        </Box>
        <Box key="dash-head" flexDirection="row" justifyContent="space-between" marginBottom={1}>
          {/* The panel's own settings: /plugin configure, where its parts are switched on and off. */}
          <Box key="dash-settings">
            <Button key="settings-btn" plain onPress={openSettings}>
              <Text dimColor hover={HOVER}>
                {'⚙\uFE0E Settings'}
              </Text>
            </Button>
          </Box>
          <Box key="dash-controls" flexDirection="row" columnGap={2}>
            <Box key="dash-refresh">
              <Button key="refresh-all-btn" plain onPress={refreshAll}>
                <Text color="claude" hover={HOVER}>
                  {'↻ Refresh'}
                </Text>
              </Button>
            </Box>
            <Box key="focus-home-box">
              <Button key={FOCUS_HOME} plain onPress={() => void bump()}>
                {statusDot}
              </Button>
            </Box>
            <Box key="dash-fold">
              <Button key="dashboard-fold-btn" plain onPress={() => void fold('dashboard')}>
                <Text dimColor hover={HOVER}>
                  {isUnfoldedSection('dashboard') ? '▾' : '▸'}
                </Text>
              </Button>
            </Box>
          </Box>
        </Box>
        {setupRow}
        {contextPart}
        {sessionRow}
        {isUnfoldedSection('dashboard') && sections}
        {isUnfoldedSection('dashboard') && sections.length === 0 && contextPart === null && sessionRow === null && (
          <Text dimColor>every part is switched off in /plugin configure</Text>
        )}
      </Box>
    )

    // ---- The tools box: the todo list, then the commands.
    // Work shows while the todo list or a command of it is switched on; its summary counts what it holds.
    // With the commands on, Work shows even when none is found: its ＋ adds them.
    const commandsShown = settings.showCommands ? general.length + pinnedEntries.length : 0
    const hasWork = settings.showTodos || settings.showCommands
    const workSummary = settings.showTodos
      ? `${todos.length} todo${todos.length === 1 ? '' : 's'}`
      : `${commandsShown} command${commandsShown === 1 ? '' : 's'}`
    const todoRows = (
      <Box key="todo-section" flexDirection="column" paddingLeft={ITEM_INDENT + 2} marginBottom={1}>
        {todoProblem !== null && <Text color="error">{todoProblem}</Text>}
        {todoProblem === null && todos.length === 0 && <Text dimColor>nothing open, add one below</Text>}
        {todos.map(todo => {
          const isArmed = armedFor(`todo-rm-${todo.line}:${todo.text}`) !== null
          return (
            <Box key={`todo-${todo.line}`} flexDirection="row" justifyContent="space-between" columnGap={1}>
              <Box flexDirection="row" flexShrink={1}>
                <Box key={`todo-check-${todo.line}`}>
                  <Button key={`todo-done-${todo.line}`} plain onPress={() => void finishTodo(todo, false)}>
                    <Text dimColor hover={{ dimColor: false, color: 'success', bold: true }}>{'[ ]'}</Text>
                  </Button>
                </Box>
                <Text wrap="truncate-end">{` ${todo.text}`}</Text>
              </Box>
              <Box key={`todo-x-${todo.line}`}>
                <Button key={`todo-remove-${todo.line}`} plain onPress={() => void finishTodo(todo, true)}>
                  {isArmed ? (
                    <Text color="error" bold>{' sure? ✕ '}</Text>
                  ) : (
                    <Text dimColor hover={{ dimColor: false, color: 'error', bold: true }}>{' ✕ '}</Text>
                  )}
                </Button>
              </Box>
            </Box>
          )
        })}
        {todoProblem === null && field('todo-input', 'new todo · Enter adds', 'what needs doing', 'add', value => void addTodo(value))}
      </Box>
    )

    return (
      // Shorter than the window, everything sits at its bottom, next to the prompt; taller, it grows
      // upwards and the window stays at the bottom (see `toggle`).
      <Box flexDirection="column" justifyContent="flex-end" alignItems="flex-end" minHeight={e.props.scroll.bodyRows} backgroundColor={background}>
        {/* One box: the title and the dashboard on top (what is going on, one row per thing), then a
            line, then the tools. */}
        <Box key="panel-box" flexDirection="column" width={width} borderStyle="round" borderColor="claude" borderDimColor paddingX={1} backgroundColor={background}>
          {dashboard}
          {!settings.showContext && ticketRow}
          {settings.showModel && divider('d-top')}
          {settings.showModel && sectionHead('model', 'Model', [modelLabelOf(sessionModel), currentEffort === null ? '' : titleCase(currentEffort)].filter(piece => piece !== '').join(' · '))}
          {settings.showModel && isUnfoldedSection('model') && (
          <Box key="model-chips" flexDirection="column">
          <Box flexDirection="row">
            {label('MODEL')}
            <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
              {MODELS.map(model =>
                chip(
                  `m-${model.arg}`,
                  model.label,
                  model.hotkey,
                  sessionModel.startsWith(model.id) ? 'active' : pendingNow === `model:${model.arg}` ? 'pending' : 'idle',
                  'claude',
                  () => void pickModel(model),
                ),
              )}
            </Box>
          </Box>
          <Box flexDirection="row" marginTop={1}>
            {label('EFFORT')}
            <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
              {EFFORTS.map(effort =>
                chip(
                  `e-${effort.level}`,
                  effort.label,
                  effort.hotkey,
                  currentEffort === effort.level ? 'active' : pendingNow === `effort:${effort.level}` ? 'pending' : 'idle',
                  'merged',
                  () => void pickEffort(effort),
                ),
              )}
            </Box>
          </Box>
          <Box flexDirection="row">
            {label('')}
            <Text dimColor italic>
              a switch is also saved as your default
            </Text>
          </Box>
          </Box>
          )}

          {/* Work: the todo list and the commands every developer has. */}
          {hasWork && divider('d-work')}
          {hasWork &&
            sectionHead(
              'work',
              'Work',
              workSummary,
              settings.showCommands && (
                <Box key="pin-plus">
                  <Button key="pin-plus-btn" plain onPress={() => void togglePin()}>
                    <Text color={isPinOpen ? 'warning' : 'suggestion'} hover={HOVER}>
                      {isPinOpen ? '✕' : '＋'}
                    </Text>
                  </Button>
                </Box>
              ),
            )}
          {hasWork && settings.showCommands && isPinOpen && (
            <Box key="pin-search-box" flexDirection="column" paddingLeft={ITEM_INDENT} marginBottom={1}>
              <Text dimColor wrap="wrap">
                Pin a command you use often: it then has its own row under Work, in every session. Any command this session has can be pinned, from
                your plugins, your own skills or the built-in ones.
                {skillCreator === undefined ? '' : ' Nothing fits? Describe what you need and start a new skill from here.'}
              </Text>
              {field(
                'pin-search',
                'a name or what it does · Enter pins the first',
                skillCreator === undefined ? 'e.g. review, deploy, catchup' : 'e.g. review, deploy, or what a new skill should do',
                'pin',
                () => void (pinMatches[0] === undefined ? undefined : pin(pinMatches[0].name)),
                value => void update($, pinQuery, () => value),
              )}
              {query !== '' && pinMatches.length === 0 && <Text dimColor>{`nothing matches "${query}"`}</Text>}
              {pinMatches.slice(0, PIN_RESULTS).map(command => (
                <Box key={`pin-match-${command.name}`}>
                  <Button key={`pin-match-${command.name}-btn`} plain onPress={() => void pin(command.name)}>
                    <Text color="suggestion">{'＋ '}</Text>
                    <Text hover={HOVER}>{fit(`/${shortNameOf(command.name)}`, Math.max(12, inner - ITEM_INDENT - 24))}</Text>
                    <Text dimColor>{` ${fit(command.plugin?.split('@')[0] ?? command.source, 20)}`}</Text>
                  </Button>
                </Box>
              ))}
              {pinMatches.length > PIN_RESULTS && <Text dimColor>{`${pinMatches.length - PIN_RESULTS} more: type more to narrow`}</Text>}
              {query !== '' && skillCreator !== undefined && (
                <Box key="pin-new-skill">
                  <Button key="pin-new-skill-btn" plain onPress={() => void read($, pinQuery).then(text => createSkill(text.trim()))}>
                    <Text color="success">{'✚ '}</Text>
                    <Text hover={HOVER}>{fit(`New skill: "${typed}"`, Math.max(12, inner - ITEM_INDENT - 24))}</Text>
                    <Text dimColor>{` runs /${shortNameOf(skillCreator.name)}`}</Text>
                  </Button>
                </Box>
              )}
            </Box>
          )}
          {hasWork && settings.showTodos && isUnfoldedSection('work') && (
          <Box key="todo" flexDirection="column" paddingLeft={ITEM_INDENT}>
            {listHead(
              'todo',
              `Todo (${todos.length})`,
              band ? 'your list, shared with the band' : `your list in ~/${TODO_FILE}`,
              'warning',
              null,
              null,
            )}
          </Box>
          )}
          {hasWork && settings.showTodos && isUnfoldedSection('work') && isUnfoldedSection('todo') && todoRows}
          {hasWork && settings.showCommands && isUnfoldedSection('work') && general.map(entry => entryRow(entry, 'suggestion', ITEM_INDENT))}
          {hasWork && settings.showCommands && isUnfoldedSection('work') && pinnedEntries.map(entry => entryRow(entry, 'suggestion', ITEM_INDENT))}

          {/* Team: the skills of the person's own team, read from the team plugin, each a row that starts it. */}
          {settings.showTeam && (
          <Box key="team-section" flexDirection="column">
          {divider('d-team')}
          {sectionHead(
            'team',
            'Team',
            [teamName ?? '', teamEntries.length === 0 ? '' : `${teamEntries.length} skill${teamEntries.length === 1 ? '' : 's'}`, teamSources.join(' + ')]
              .filter(piece => piece !== '')
              .join(' · '),
          )}
          {/* The name was only taken from the team plugin: say that user.team is not set and how to set it. */}
          {guessedFrom !== null && teamName !== null && (
            <Box key="team-guessed" flexDirection="column" paddingLeft={ITEM_INDENT}>
              <Text color="warning">{fit('No user.team set: the name is taken from the team plugin.', inner - ITEM_INDENT)}</Text>
              <Text color="warning">{fit(`Set it: git config user.team "${teamName}"`, inner - ITEM_INDENT)}</Text>
            </Box>
          )}
          {/* When the team or its skills did not come through, the check that says why; shown folded too. */}
          {(teamName === null || teamEntries.length === 0) && diagnosis === null && (
            <Box key="team-why" flexDirection="row" paddingLeft={ITEM_INDENT}>
              <Box key="team-why-box">
                <Button key="team-why-btn" plain onPress={explainTeam}>
                  <Text color="warning" hover={HOVER}>{'? why is it missing'}</Text>
                </Button>
              </Box>
            </Box>
          )}
          {/* The check in a dashed yellow frame, drawn in text (the engine's borders are solid), so its
              lines do not run into the dim ones under it that say what is missing. Each line is wrapped
              by hand to the frame's width, so the frame's sides stay straight. */}
          {diagnosis !== null && (
            <Box key="team-diagnosis" flexDirection="column" paddingLeft={ITEM_INDENT} marginBottom={1}>
              <Text color="warning">{`┌${'╌'.repeat(frameWidth + 2)}┐`}</Text>
              <Box key="team-diagnosis-head" flexDirection="row">
                <Text color="warning">{'╎ '}</Text>
                <Text color="warning" bold>
                  {DIAGNOSIS_TITLE}
                </Text>
                <Text>{' '.repeat(Math.max(1, frameWidth - DIAGNOSIS_TITLE.length - 4))}</Text>
                <Box key="team-diagnosis-again">
                  <Button key="team-diagnosis-again-btn" plain onPress={explainTeam}>
                    <Text dimColor hover={HOVER}>↻</Text>
                  </Button>
                </Box>
                <Text>{'  '}</Text>
                <Box key="team-diagnosis-close">
                  <Button key="team-diagnosis-close-btn" plain onPress={() => void update($, teamDiagnosis, () => null)}>
                    <Text dimColor hover={{ dimColor: false, color: 'error', bold: true }}>✕</Text>
                  </Button>
                </Box>
                <Text color="warning">{' ╎'}</Text>
              </Box>
              {diagnosis.flatMap((line, index) =>
                wrapRows(line, frameWidth).map((row, part) => (
                  <Box key={`team-diagnosis-${index}-${part}`} flexDirection="row">
                    <Text color="warning">{'╎ '}</Text>
                    <Text dimColor={!line.includes('FAILED')} color={line.includes('FAILED') ? 'error' : undefined}>
                      {row.padEnd(frameWidth)}
                    </Text>
                    <Text color="warning">{' ╎'}</Text>
                  </Box>
                )),
              )}
              <Text color="warning">{`└${'╌'.repeat(frameWidth + 2)}┘`}</Text>
            </Box>
          )}
          {isUnfoldedSection('team') && teamEntries.map(entry => entryRow(entry, 'claude', ITEM_INDENT))}
          {isUnfoldedSection('team') && teamEntries.length === 0 && (
            <Box key="team-empty" flexDirection="column" paddingLeft={ITEM_INDENT}>
              <Text dimColor wrap="wrap">
                {teamName === null
                  ? 'No team set. `git config user.team "<your team>"` names it.'
                  : `No ${teamName} skills: the ${teamPluginOf(teamName, settings.teamPrefix)} plugin is not installed.`}
              </Text>
              {teamPlugin !== null && <Text dimColor wrap="wrap">{`Install them: ${installHintOf(teamPlugin, settings)}, then /reload-plugins.`}</Text>}
            </Box>
          )}
          </Box>
          )}


          {divider('d-foot')}
          <Box flexDirection="row" justifyContent="space-between">
            <Text dimColor>{settings.showModel ? '1-4 model · 5-9 effort · esc closes' : 'esc closes'}</Text>
            <Box key="close-box">
              <Button key="close-tools" plain onPress={() => void toggle($, settings, pollers, false)}>
                <Text dimColor hover={HOVER}>close ▴</Text>
              </Button>
            </Box>
          </Box>
        </Box>
      </Box>
    )
  })
}
