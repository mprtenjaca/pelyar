import type { On, PromptComposeInput, PromptComposeResult, RenderInput, SessionMeasureInput } from 'claude-code'
import { describe, expect, mock, test, tier } from 'claude-code/testing'

import { GENERAL } from '../hooks/catalog'
import { githubArgv, parseGithubPullRequests } from '../hooks/pull-requests'
import { ticketKeyOf } from '../hooks/ticket'
import { MissingTool, retryLineOf, ticketErrorOf } from '../hooks/util'

tier('user')

const SESSION = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const
const PANE: RenderInput<'Pane'> = {
  component: 'Pane',
  surface: 'terminal',
  requestId: 'pelyar',
  viewport: { columns: 200, rows: 50 },
  props: { title: 'Pelyar', isFocused: true, bodyColumns: 64, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } } as const
const TODO_PATH = '/home/test/.claude/todos.md'

type Command = { name: string; source?: 'builtin' | 'plugin' | 'user' | 'mcp'; plugin?: string; description?: string }
type WorldOptions = {
  commands?: readonly (string | Command)[]
  model?: string
  turns?: number
  files?: Record<string, string>
  team?: string | null
  linked?: readonly string[]
  branch?: string | null
  jira?: () => unknown
  jiraHangs?: boolean
  jiraError?: string
  prsError?: string
  // A Bitbucket call refused the way the permission check refuses it (`{ deny }` rejects the caller).
  prsRefused?: string
  // The MCP tools the session lists, as `$.session.usage` breaks them down; with `onlyServers`, every
  // other server answers as not connected.
  mcpTools?: readonly { name: string; serverName: string }[]
  onlyServers?: readonly string[]
  // The /config theme; the panel background takes its shade from it.
  theme?: string
  // The dashboard's feeds, in the shapes the servers answer with.
  prs?: { mine: unknown[]; reviewing: unknown[] }
  tickets?: unknown[]
  unread?: unknown[]
  meetings?: unknown[]
  // What osascript answers for Spotify: null while the app is not running.
  spotify?: unknown
  sessionFiles?: Record<string, unknown>[]
  // What `gh api graphql` prints; undefined: gh is not installed, 'logged-out': gh answers 4.
  github?: unknown
  // What `glab api <endpoint>` prints, by endpoint; undefined: glab is not installed, 'logged-out':
  // glab says to log in.
  gitlab?: ((endpoint: string) => unknown) | 'logged-out'
  // The Atlassian sites the server can reach.
  sites?: unknown
  // What Linear's list_issues and get_issue answer; null: no Linear server connected.
  linear?: unknown[] | null
  linearIssue?: unknown
  // The checkout's origin, as `git remote get-url origin` prints it.
  remote?: string | null
  // Whether the session's directory is in a repository.
  repo?: boolean
  // git config gives no answer (a timeout); switchable later through the returned `git`.
  gitFails?: boolean
  // A detached HEAD at this commit (no branch).
  detached?: string | null
  // The folds kept in the store from an earlier session; null: none kept, the defaults apply.
  // Most tests read the rows, so by default only the todo list is folded.
  folds?: string[] | null
  // Other values kept in the plugin store from an earlier session (the last team read).
  stored?: Record<string, unknown>
  // More environment variables than HOME and USER.
  env?: Record<string, string>
  // The effort setting's value in /config; null: the session has none.
  effort?: string | null
}
const NOW = 1_800_000_000_000
const DEFAULT_COMMANDS = ['model', 'effort', 'clear', 'catchup', 'wrapup', 'code-review', 'security-review'] as const
const SESSIONS_DIR = '/home/test/.claude/sessions'

// Everything beneath the plugin: the commands the session has, the files, the clock, the toasts,
// and the servers the dashboard reads.
function world(
  on: On,
  {
    commands = DEFAULT_COMMANDS,
    model = 'claude-opus-5-5',
    turns = 3,
    files: initial = {},
    team = null,
    linked = [],
    branch = null,
    jira = () => ({ issues: { nodes: [] } }),
    jiraHangs = false,
    jiraError,
    prsError,
    prsRefused,
    mcpTools,
    onlyServers,
    theme = 'dark',
    prs = { mine: [], reviewing: [] },
    tickets = [],
    unread = [],
    meetings = [],
    spotify = null,
    sessionFiles = [],
    github,
    gitlab,
    sites = [{ id: 'cloud-1', url: 'https://example.atlassian.net', name: 'example' }],
    linear = [],
    linearIssue = null,
    remote = null,
    repo = false,
    gitFails = false,
    detached = null,
    folds = ['todo'],
    stored = {},
    env = {},
    effort = null,
  }: WorldOptions = {},
) {
  const git = { fails: gitFails, team }
  const ran: string[] = []
  const notifications: string[] = []
  const sounds: string[] = []
  const toasts: string[] = []
  const closes: string[] = []
  const files: Record<string, string> = { ...initial }
  // The repository: /work holds a .git folder.
  const dirs = new Set<string>()
  if (repo) {
    files['/work/.git'] = ''
    dirs.add('/work/.git')
  }
  for (const session of sessionFiles) files[`${SESSIONS_DIR}/${String(session.pid)}.json`] = JSON.stringify(session)
  const clock = mock.clock(on, { now: NOW })

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: SESSION.cwd }))
  on('session.id', () => ({ value: 'this-session' }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({
    value: [...commands, 'pelyar'].map(command =>
      typeof command === 'string'
        ? { name: command, description: command, source: 'builtin' as const }
        : { description: `${command.name} does its job.`, source: 'builtin' as const, ...command },
    ),
  }))
  const opened: string[] = []
  const spotifyActions: string[] = []
  const runs: string[] = []
  on('process.run', ($, e) => {
    const command = e.argv.join(' ')
    runs.push(command)
    const answer = (stdout: string | null) => ({
      value: { exitCode: stdout === null ? 1 : 0, stdout: stdout ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (git.fails && e.argv[0] === 'git' && e.argv[1] === 'config') throw new Error('timed out after 15000 ms')
    if (command === 'git config --get user.team') return answer(git.team === null ? null : `${git.team}\n`)
    if (command === 'git rev-parse --show-toplevel') return answer(repo ? '/home/test/repo\n' : null)
    if (command === 'git remote get-url origin') return answer(remote === null ? null : `${remote}\n`)
    if (command === 'git symbolic-ref --short -q HEAD') return answer(branch === null ? null : `${branch}\n`)
    if (command === 'git rev-parse --short HEAD') return answer(detached === null ? null : `${detached}\n`)
    if (e.argv[0] === 'open') {
      opened.push(e.argv[1] ?? '')
      return answer('')
    }
    if (e.argv[0] === 'afplay') {
      sounds.push(e.argv[1] ?? '')
      return answer('')
    }
    if (e.argv[0] === 'osascript' && (e.argv[4] ?? '').includes('displayNotification')) {
      notifications.push(e.argv[4] ?? '')
      return answer('')
    }
    if (e.argv[0] === 'osascript') {
      const action = /app\.running\(\)\) app\.(\w+)\(\)/.exec(e.argv[4] ?? '')?.[1]
      if (action !== undefined) {
        spotifyActions.push(action)
        return answer('')
      }
      return answer(spotify === null ? 'null' : JSON.stringify(spotify))
    }
    // Windows: the same answer, from the system media controls over Windows PowerShell.
    if (e.argv[0] === 'powershell.exe') {
      const script = e.argv[e.argv.length - 1] ?? ''
      const action = /\$session\.(Try(?!GetMedia)\w+)\(\)/.exec(script)?.[1]
      if (action !== undefined) {
        spotifyActions.push(action)
        return answer('')
      }
      return answer(spotify === null || script === "'null'" ? 'null' : JSON.stringify(spotify))
    }
    if (e.argv[0] === 'ps') return answer(sessionFiles.map(session => `${String(session.pid)} ${String(session.procStart)}`).join('\n'))
    if (e.argv[0] === 'gh') {
      if (github === undefined) throw new Error('spawn gh ENOENT')
      if (github === 'logged-out') return { value: { exitCode: 4, stdout: '', stderr: 'To get started with GitHub CLI, please run:  gh auth login', isStdoutTruncated: false, isStderrTruncated: false } }
      // A single issue of the checkout's repository: `gh api repos/{owner}/{repo}/issues/<n>`.
      const single = /^repos\/\{owner\}\/\{repo\}\/issues\/(\d+)$/.exec(e.argv[2] ?? '')
      if (single !== null) return answer(JSON.stringify(Reflect.get(Object(github), `issue-${single[1]}`) ?? null))
      return answer(JSON.stringify(github))
    }
    if (e.argv[0] === 'glab') {
      if (gitlab === undefined) throw new Error('spawn glab ENOENT')
      if (gitlab === 'logged-out') return { value: { exitCode: 1, stdout: '', stderr: 'glab: no token found, run glab auth login', isStdoutTruncated: false, isStderrTruncated: false } }
      const found = gitlab(e.argv[e.argv.length - 1] ?? '')
      return found === undefined ? answer(null) : answer(JSON.stringify(found))
    }
    return answer(null)
  })
  // Every server call, and apart from them the lookups of the branch's own ticket.
  const calls: string[] = []
  const jiraCalls: string[] = []
  const reply = (value: unknown) => ({ value: { isError: false, content: [{ type: 'text' as const, text: JSON.stringify(value) }] } })
  const servers: string[] = []
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { window: 1_000_000, breakdown: { mcpTools: mcpTools ?? [] } } } }) as never)
  on('mcp.call', ($, e) => {
    if (onlyServers !== undefined && !onlyServers.includes(e.server)) throw new Error(`${e.server} not connected`)
    servers.push(`${e.server}/${e.tool}`)
    calls.push(e.tool)
    const argOf = (key: string) => String(Reflect.get(Object(e.args), key) ?? '')
    if (e.tool === 'bitbucket_getDashboardPullRequests' && prsRefused !== undefined && (onlyServers === undefined || onlyServers.includes(e.server))) return { deny: prsRefused }
    if (e.tool === 'bitbucket_getDashboardPullRequests' && prsError !== undefined) return { value: { isError: true, content: [{ type: 'text' as const, text: prsError }] } }
    if (e.tool === 'bitbucket_getDashboardPullRequests') return reply({ success: true, data: { values: argOf('role') === 'AUTHOR' ? prs.mine : prs.reviewing } })
    if (e.tool === 'list_recent_emails') return reply({ result: unread })
    if (e.tool === 'list_calendar_events') return reply({ events: meetings })
    if (e.tool === 'getAccessibleAtlassianResources') return reply(sites)
    if (e.tool === 'list_issues' || e.tool === 'get_issue') {
      if (linear === null) throw new Error(`${e.server} not connected`)
      return reply(e.tool === 'list_issues' ? linear : linearIssue)
    }
    if (e.tool === 'searchJiraIssuesUsingJql' && !argOf('jql').startsWith('key =')) return reply({ issues: { nodes: tickets } })
    jiraCalls.push(e.tool)
    if (jiraHangs) return new Promise<never>(() => undefined)
    if (jiraError !== undefined) return { value: { isError: true, content: [{ type: 'text' as const, text: jiraError }] } }
    return reply(jira())
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('fs.list', ($, e) => {
    if (e.path === '/home/test/.claude/skills')
      return { value: [...linked.map(name => ({ name, kind: 'other' as const, size: 0, mtimeMs: 0, isLink: true })), { name: 'my-own', kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }] }
    if (e.path === SESSIONS_DIR) return { value: sessionFiles.map(session => ({ name: `${String(session.pid)}.json`, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })) }
    return { value: [] }
  })
  on('command.run', ($, e) => {
    ran.push(`${e.command} ${e.args}`.trim())
    return {}
  })
  on('skill.prompt', ($, e) => ({ text: e.text }))
  on('prompt.compose', () => ({ sections: [{ id: 'engine', text: 'You are Claude.', scope: 'shared' as const }] }))
  on('config.list', () => ({
    value: [
      { key: 'theme', label: 'Theme', kind: 'choice' as const, value: theme, provider: { plugin: 'engine', tier: 'core' as const }, isLocked: false },
      // A switch with "effort" in its name, ahead of the effort itself: not the effort.
      { key: 'showEffortHint', label: 'Show effort hint', kind: 'boolean' as const, value: true, provider: { plugin: 'engine', tier: 'core' as const }, isLocked: false },
      ...(effort === null ? [] : [{ key: 'effortLevel', label: 'Effort', kind: 'choice' as const, value: effort, provider: { plugin: 'engine', tier: 'core' as const }, isLocked: false }]),
    ],
  }))
  on('session.model', () => ({ value: model }))
  on('session.turns', () => ({ value: turns }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => {
    closes.push('pane')
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('fs.exists', ($, e) => ({ value: e.path in files || e.path === '/home/test/.claude/skills' || (e.path === SESSIONS_DIR && sessionFiles.length > 0) }))
  on('fs.read', ($, e) => {
    const text = files[e.path]
    if (text === undefined) throw new Error(`no such file: ${e.path}`)
    return { value: text }
  })
  // Each write moves the file's time on, as a real write does; `touch` stands for another plugin writing.
  const mtimes: Record<string, number> = {}
  const touch = (path: string, text: string) => {
    files[path] = text
    mtimes[path] = (mtimes[path] ?? 0) + 1
  }
  on('fs.write', ($, e) => {
    touch(e.path, e.text)
    return { value: undefined }
  })
  on('fs.stat', ($, e) => ({ value: { kind: dirs.has(e.path) ? ('dir' as const) : ('file' as const), size: files[e.path]?.length ?? 0, mtimeMs: mtimes[e.path] ?? 0, isLink: false, realPath: e.path } }))
  mock.store(on, { ...stored, ...(folds === null ? {} : { 'folded-v2': folds }) })
  mock.env(on, { HOME: '/home/test', USER: 'sam', ...env })
  return { ran, toasts, files, clock, opened, touch, jiraCalls, calls, spotifyActions, closes, git, notifications, sounds, runs, servers }
}

function measure(percent: number): SessionMeasureInput {
  return { context: { tokens: percent * 10_000, window: 1_000_000, percent }, rateLimits: [], changed: ['context'] }
}

// Fixtures in the shapes the servers answer with.
function pullRequest(id: number, title: string, author: string, approvals: number, reviewers: number, reviewerSlug = 'sam') {
  return {
    id,
    title,
    draft: false,
    toRef: { repository: { project: { key: 'APP' }, slug: 'app' } },
    fromRef: { latestCommit: 'abc' },
    links: { self: [{ href: `https://bitbucket.example.com/projects/APP/repos/app/pull-requests/${id}` }] },
    author: { user: { displayName: author, slug: author.toLowerCase() } },
    reviewers: Array.from({ length: reviewers }, (_item, index) => ({
      user: { slug: index === 0 ? reviewerSlug : `r${index}` },
      status: index < approvals ? 'APPROVED' : 'UNAPPROVED',
      approved: index < approvals,
      lastReviewedCommit: index < approvals ? 'abc' : '',
    })),
    properties: { openTaskCount: 0, qgStatus: '', mergeResult: { outcome: 'CLEAN' } },
  }
}
function jiraNode(key: string, summary: string, status: string, category: string) {
  return { key, webUrl: `https://example.atlassian.net/browse/${key}`, fields: { summary, status: { name: status, statusCategory: { key: category } } } }
}
// A pull request as GitHub's GraphQL answers it, with the reviews and requests on it.
type GithubReview = { login: string; state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED'; oid: string }
function githubPr(number: number, title: string, author: string, { repo = 'acme/web', head = 'h2', reviews = [] as GithubReview[], requested = [] as string[], checks = 'SUCCESS' } = {}) {
  return {
    number,
    title,
    url: `https://github.com/${repo}/pull/${number}`,
    isDraft: false,
    mergeable: 'MERGEABLE',
    reviewDecision: reviews.some(review => review.state === 'APPROVED') ? 'APPROVED' : 'REVIEW_REQUIRED',
    headRefOid: head,
    repository: { nameWithOwner: repo },
    author: { login: author.toLowerCase(), name: author },
    reviewRequests: { nodes: requested.map(login => ({ requestedReviewer: { login } })) },
    latestReviews: { nodes: reviews.map(review => ({ author: { login: review.login }, state: review.state, commit: { oid: review.oid } })) },
    commits: { nodes: [{ commit: { statusCheckRollup: { state: checks } } }] },
  }
}
function githubAnswer(login: string, { mine = [] as unknown[], requested = [] as unknown[], reviewed = [] as unknown[] } = {}) {
  return { data: { viewer: { login }, mine: { nodes: mine }, requested: { nodes: requested }, reviewed: { nodes: reviewed } } }
}
const TEAM = { options: { showTeam: true } }
const inMinutes = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString()

describe('model and effort', () => {
  test('a press on the model that is already active runs nothing', async ($, on) => {
    const kept = world(on)
    await $.session.start(SESSION)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })

    await ui.press({ key: 'm-opus-btn' })

    expect(kept.ran).toEqual([])
    expect(kept.toasts).toContain('Opus 5.5 is already the active model')
    await ui.unmount()
  })

  test('two quick presses on another model run /model once', async ($, on) => {
    const kept = world(on)
    await $.session.start(SESSION)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })

    await Promise.all([ui.press({ key: 'm-sonnet-btn' }), ui.press({ key: 'm-sonnet-btn' })])
    await ui.press({ key: 'm-sonnet-btn' })

    expect(kept.ran).toEqual(['model sonnet'])
    await ui.unmount()
  })
})

describe('session rows', () => {
  test('Clear after a conversation without Wrapup needs a second press', async ($, on) => {
    const kept = world(on)
    await $.session.start(SESSION)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })

    await ui.press({ key: 's-clear-btn' })
    expect(kept.ran).toEqual([])

    await kept.clock.advance(600)
    await ui.press({ key: 's-clear-btn' })
    expect(kept.ran).toEqual(['clear'])
    await ui.unmount()
  })

  test('an armed Clear disarms itself after a few seconds', async ($, on) => {
    const kept = world(on)
    await $.session.start(SESSION)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })

    await ui.press({ key: 's-clear-btn' })
    await kept.clock.advance(5000)
    await ui.press({ key: 's-clear-btn' })

    expect(kept.ran).toEqual([])
    await ui.unmount()
  })

  test('Clear in a fresh conversation goes through at once', async ($, on) => {
    const kept = world(on, { turns: 0 })
    await $.session.start(SESSION)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })

    await ui.press({ key: 's-clear-btn' })

    expect(kept.ran).toEqual(['clear'])
    await ui.unmount()
  })

  test('Clear warns to run Wrapup first, and claims nothing about whether one ran', async ($, on) => {
    const kept = world(on)
    await $.session.start(SESSION)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })
    await ui.press({ key: 's-clear-btn' })
    const before = textOf(await $.ui.render(PANE))
    await kept.clock.advance(5000)

    await $.skill.prompt({ skill: 'workflow:wrapup', text: '# Wrapup' })
    await ui.press({ key: 's-clear-btn' })
    const after = textOf(await $.ui.render(PANE))

    expect(kept.ran).toEqual([])
    for (const text of [before, after]) {
      expect(text).toContain('Run Wrapup first so nothing is lost')
      expect(text).not.toContain('No Wrapup')
    }
    await ui.unmount()
  })

  test('Catchup runs the catchup command the session has, a plugin one too', async ($, on) => {
    const kept = world(on, { commands: ['model', 'effort', 'clear', 'workflow:catchup', 'workflow:wrapup'] })
    await $.session.start(SESSION)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })
    await ui.press({ key: 's-catchup-btn' })
    expect(kept.ran).toEqual(['workflow:catchup'])
    await ui.unmount()
  })

  test('Pelyar\'s own catchup comes before another plugin\'s', async ($, on) => {
    const kept = world(on, { commands: ['model', 'effort', 'clear', 'workflow:catchup', 'pelyar:catchup', 'pelyar:wrapup'] })
    await $.session.start(SESSION)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })
    await ui.press({ key: 's-catchup-btn' })
    expect(kept.ran).toEqual(['pelyar:catchup'])
    await ui.unmount()
  })

  test('the Catchup command setting runs the command it names', { options: { catchupCommand: '/project-catchup' } }, async ($, on) => {
    const kept = world(on, { commands: ['model', 'clear', 'pelyar:catchup', 'team-x:project-catchup'] })
    await $.session.start(SESSION)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })
    await ui.press({ key: 's-catchup-btn' })
    expect(kept.ran).toEqual(['team-x:project-catchup'])
    await ui.unmount()
  })

  test('a Catchup command the session does not have is said, and nothing else runs', { options: { catchupCommand: 'gone:catchup' } }, async ($, on) => {
    const kept = world(on, { commands: ['model', 'clear', 'pelyar:catchup'] })
    await $.session.start(SESSION)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })
    await ui.press({ key: 's-catchup-btn' })
    expect(kept.ran).toEqual([])
    expect(kept.toasts).toContain('/gone:catchup is not in this session: check the Catchup command in Settings')
    await ui.unmount()
  })

  test('Pelyar\'s wrapup says it commits, and runs without committing when the setting is off', { options: { wrapupCommit: false } }, async ($, on) => {
    const kept = world(on, { commands: ['model', 'clear', 'pelyar:wrapup'] })
    await $.session.start(SESSION)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })
    await ui.press({ key: 's-wrapup-btn' })
    expect(textOf(await $.ui.render(PANE))).toContain('Wrapup saves this session. Press again to start it.')
    await kept.clock.advance(600)
    await ui.press({ key: 's-wrapup-btn' })
    expect(kept.ran).toEqual(['pelyar:wrapup no-commit'])
    await ui.unmount()
  })

  test('with commits on, the confirmation says Wrapup commits CLAUDE.md', async ($, on) => {
    world(on, { commands: ['model', 'clear', 'pelyar:wrapup'] })
    await $.session.start(SESSION)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })
    await ui.press({ key: 's-wrapup-btn' })
    expect(textOf(await $.ui.render(PANE))).toContain('Wrapup updates CLAUDE.md and commits it when it is tracked.')
    await ui.unmount()
  })

  test('without catchup or wrapup commands only Clear is offered', async ($, on) => {
    world(on, { commands: ['model', 'effort', 'clear'] })
    await $.session.start(SESSION)

    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('Clear')
    expect(text).not.toContain('Catchup')
    expect(text).not.toContain('Wrapup')
  })

  test('a second Catchup in the same conversation needs a second press', async ($, on) => {
    const kept = world(on)
    await $.session.start(SESSION)
    await $.command.run({ command: 'catchup', args: '', ...RUN })
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })

    await ui.press({ key: 's-catchup-btn' })
    expect(kept.ran).toEqual(['catchup'])
    await kept.clock.advance(3500)

    await ui.press({ key: 's-catchup-btn' })
    expect(kept.ran).toEqual(['catchup', 'catchup'])
    await ui.unmount()
  })
})

describe('todo list', () => {
  test('empty and duplicate todos are not added, a new one is', async ($, on) => {
    const kept = world(on, { files: { [TODO_PATH]: '- [ ] call Alex\n' } })
    await $.session.start(SESSION)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })
    await ui.press({ key: 'todo-btn' })

    await ui.input({ key: 'todo-input', text: '   ' })
    await ui.input({ key: 'todo-input', text: 'Call   ALEX' })
    await ui.input({ key: 'todo-input', text: 'reply to Sam' })

    expect(kept.files[TODO_PATH]).toBe('- [ ] call Alex\n- [ ] reply to Sam\n')
    expect(kept.toasts).toContain('That one is already on the list')
    await ui.unmount()
  })

  test('two todos with the same text are confirmed one by one', async ($, on) => {
    const kept = world(on, { files: { [TODO_PATH]: '- [ ] call Alex\n- [ ] call Alex\n' } })
    await $.session.start(SESSION)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })
    await ui.press({ key: 'todo-btn' })

    await ui.press({ key: 'todo-remove-0' })
    await kept.clock.advance(600)
    await ui.press({ key: 'todo-remove-1' })
    // The second cross armed its own row; it did not confirm the first one's question.
    expect(kept.files[TODO_PATH]).toBe('- [ ] call Alex\n- [ ] call Alex\n')
    await ui.unmount()
  })

  test('removing a todo needs a second press on the cross', async ($, on) => {
    const kept = world(on, { files: { [TODO_PATH]: '- [ ] call Alex\n' } })
    await $.session.start(SESSION)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })
    await ui.press({ key: 'todo-btn' })

    await ui.press({ key: 'todo-remove-0' })
    expect(kept.files[TODO_PATH]).toBe('- [ ] call Alex\n')

    await kept.clock.advance(600)
    await ui.press({ key: 'todo-remove-0' })
    expect(kept.files[TODO_PATH]).toBe('')
    await ui.unmount()
  })
})

// The colour of the Text whose whole text is `text`, or undefined when there is no such Text.
function colorOf(tree: unknown, text: string): unknown {
  if (Array.isArray(tree)) {
    for (const node of tree) {
      const found = colorOf(node, text)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (typeof tree !== 'object' || tree === null) return undefined
  const props: unknown = Reflect.get(tree, 'props')
  if (Reflect.get(tree, 'type') === 'Text' && textOf(tree) === text) return Reflect.get(Object(props), 'color') ?? Reflect.get(tree, 'color')
  return colorOf(Reflect.get(tree, 'children'), text)
}

// The props of the first Text whose whole text starts with `prefix`.
function propsOfText(tree: unknown, prefix: string): Record<string, unknown> | undefined {
  if (Array.isArray(tree)) {
    for (const node of tree) {
      const found = propsOfText(node, prefix)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (typeof tree !== 'object' || tree === null) return undefined
  if (Reflect.get(tree, 'type') === 'Text' && textOf(tree).startsWith(prefix)) return Object(Reflect.get(tree, 'props')) as Record<string, unknown>
  return propsOfText(Reflect.get(tree, 'children'), prefix)
}

function textOf(tree: unknown): string {
  if (Array.isArray(tree)) return tree.map(textOf).join('')
  if (typeof tree === 'string') return tree
  if (typeof tree !== 'object' || tree === null) return ''
  return textOf(Reflect.get(tree, 'children'))
}

describe('team', () => {
  const skill = (team: string, name: string, extra: Partial<Command> = {}): Command => ({ name: `team-${team}:${name}`, source: 'plugin', plugin: `team-${team}`, ...extra })

  test('the team section lists only the skills of the team plugin, not linked or personal ones', TEAM, async ($, on) => {
    const kept = world(on, {
      team: 'Platform Tools',
      linked: ['known-traps'],
      commands: [
        'model',
        { name: 'known-traps', source: 'user' },
        { name: 'my-own', source: 'user' },
        skill('platform-tools', 'build-known-traps'),
        skill('billing', 'invoice-check'),
        skill('platform-tools', 'review-inbox'),
        skill('platform-tools', 'local-stack'),
        { name: 'tools:code-review', source: 'plugin', plugin: 'tools' },
      ],
    })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    const text = textOf(await $.ui.render(PANE))

    expect(text).toContain('T E A M  ·  Platform Tools')
    expect(text).toContain('Review inbox')
    expect(text).toContain('Local stack')
    // Another team's plugin stays out once the team is known.
    expect(text).not.toContain('Invoice check')
    expect(text).not.toContain('My own')
    expect(text).toContain('Review changes')
    // A skill linked into ~/.claude/skills by hand is not a team skill.
    expect(text).not.toContain('▸ Known traps')
    expect(text).toContain('Build known traps')
    expect(text).toContain('3 skills')
    expect(text.split('Review inbox').length - 1).toBe(1)
  })

  test('the team plugin installed from a marketplace lists its context skills as rows that run', TEAM, async ($, on) => {
    const folder = '/home/test/.claude/plugins/cache/acme-plugins/team-platform-tools/abc123'
    const kept = world(on, {
      team: 'Platform Tools',
      files: {
        '/home/test/.claude/plugins/installed_plugins.json': JSON.stringify({
          version: 2,
          plugins: { 'team-platform-tools@acme-plugins': [{ scope: 'user', installPath: folder }] },
        }),
        [`${folder}/skills/local-stack/SKILL.md`]: '---\nname: local-stack\ndescription: Bring up the local stack.\n---\nbody',
        [`${folder}/skills/known-traps/SKILL.md`]: '---\nname: known-traps\ndescription: Traps.\n---\nbody',
      },
      // The engine does not always say which plugin a command came from; the name still does.
      commands: [
        { name: 'team-platform-tools:local-stack', source: 'plugin', description: 'Bring up the local stack.' },
        { name: 'team-platform-tools:known-traps', source: 'plugin', plugin: 'team-platform-tools@acme-plugins' },
      ],
    })
    await $.session.start(SESSION)
    await kept.clock.advance(1)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })

    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('Platform Tools · 2 skills · acme-plugins')
    expect(text).toContain('Local stack')
    expect(text).toContain('Known traps')

    await ui.press({ key: 'team-local-stack-btn' })
    expect(textOf(await $.ui.render(PANE))).toContain('from acme-plugins · also loads itself when needed')
    await ui.press({ key: 'team-local-stack-run-btn' })

    expect(kept.ran).toEqual(['team-platform-tools:local-stack'])
    await ui.unmount()
  })

  test('a team with no skills found says how to install them', TEAM, async ($, on) => {
    const kept = world(on, { team: 'Platform Tools' })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('No Platform Tools skills: the team-platform-tools plugin is not installed.')
    expect(text).toContain('Install them: /plugin install team-platform-tools, then /reload-plugins.')
  })

  test('the prefix and the marketplace come from the settings', { options: { showTeam: true, teamPrefix: 'acme-team-', teamMarketplace: 'acme-plugins' } }, async ($, on) => {
    const kept = world(on, {
      team: 'Platform Tools',
      commands: [{ name: 'acme-team-platform-tools:deploy-check', source: 'plugin' }, skill('platform-tools', 'other')],
    })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    let text = textOf(await $.ui.render(PANE))
    expect(text).toContain('Deploy check')
    expect(text).not.toContain('▸ Other')

    kept.git.team = 'Billing'
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })
    await ui.press({ key: 'refresh-all-btn' })
    await kept.clock.advance(1)
    text = textOf(await $.ui.render(PANE))
    expect(text).toContain('/plugin install acme-team-billing@acme-plugins')
    await ui.unmount()
  })

  test('the Team section is off by default, and then the team is not read', async ($, on) => {
    const kept = world(on, { team: 'Platform Tools' })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    expect(textOf(await $.ui.render(PANE))).not.toContain('T E A M')
    expect(kept.runs.filter(command => command.includes('user.team'))).toEqual([])
  })

  test('without a team the section says how to set one', TEAM, async ($, on) => {
    world(on)
    await $.session.start(SESSION)

    expect(textOf(await $.ui.render(PANE))).toContain('git config user.team')
  })

  test('a repository without user.team shows the team git config named last', TEAM, async ($, on) => {
    world(on, { stored: { team: 'Platform Tools' } })
    await $.session.start(SESSION)

    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('Platform Tools')
    expect(text).not.toContain('No team set')
  })

  test('with no user.team anywhere the name comes from the one team plugin, with a note to set it', TEAM, async ($, on) => {
    const kept = world(on, {
      commands: [...DEFAULT_COMMANDS, { name: 'team-platform-tools:local-stack', source: 'plugin', description: 'Bring up the local stack.' }],
    })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('T E A M  ·  Platform Tools')
    expect(text).toContain('No user.team set: the name is taken from the team plugin.')
    expect(text).toContain('Set it: git config user.team "Platform Tools"')
  })

  test('git config user.team wins over the team plugin, and then no note is shown', TEAM, async ($, on) => {
    const kept = world(on, {
      team: 'Billing',
      commands: [...DEFAULT_COMMANDS, { name: 'team-platform-tools:local-stack', source: 'plugin', description: 'Bring up the local stack.' }],
    })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('Billing')
    expect(text).not.toContain('No user.team set')
  })

  test('when git gives no answer the team comes from the git config files', TEAM, async ($, on) => {
    const kept = world(on, {
      gitFails: true,
      files: {
        '/work/.git': 'gitdir: /repo/.git/worktrees/work\n',
        '/repo/.git/worktrees/work/commondir': '../..\n',
        '/repo/.git/config': '[core]\n\tbare = false\n[user]\n\tteam = Platform Tools\n',
        '/home/test/.gitconfig': '[user]\n\tname = Sam Example\n',
      },
    })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    expect(textOf(await $.ui.render(PANE))).toContain('Platform Tools')
  })

  test('a read that fails keeps the team an earlier one found', TEAM, async ($, on) => {
    const kept = world(on, { team: 'Platform Tools' })
    await $.session.start(SESSION)
    expect(textOf(await $.ui.render(PANE))).toContain('Platform Tools')

    kept.git.fails = true
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })
    await ui.press({ key: 'refresh-all-btn' })
    await kept.clock.advance(1)

    expect(textOf(await $.ui.render(PANE))).toContain('Platform Tools')
    expect(textOf(await $.ui.render(PANE))).not.toContain('no team set')
    await ui.unmount()
  })

  test('config files without the key do not wipe a known team', TEAM, async ($, on) => {
    const kept = world(on, { team: 'Platform Tools', repo: true, files: { '/home/test/.gitconfig': '[user]\n\tname = Sam Example\n' } })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    kept.git.fails = true
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })
    await ui.press({ key: 'refresh-all-btn' })
    await kept.clock.advance(1)

    expect(textOf(await $.ui.render(PANE))).toContain('Platform Tools')
    await ui.unmount()
  })

  test('the config file fallback reads a .git folder, skips subsections and inline comments', TEAM, async ($, on) => {
    const kept = world(on, {
      gitFails: true,
      repo: true,
      // The subsection comes last, so reading it as [user] would make its value win.
      files: { '/work/.git/config': '[User]\n\tTeam = "Platform Tools" # mine\n[user "work"]\n\tteam = Wrong Team\n' },
    })
    await $.session.start(SESSION)
    await kept.clock.advance(1)
    const text = textOf(await $.ui.render(PANE))

    expect(text).toContain('Platform Tools')
    expect(text).not.toContain('Wrong Team')
    expect(text).not.toContain('# mine')
  })

  test('the why button says what each step of the team read returned', TEAM, async ($, on) => {
    const kept = world(on, { gitFails: true })
    await $.session.start(SESSION)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })

    await ui.press({ key: 'team-why-btn' })
    await kept.clock.advance(1)
    const text = textOf(await $.ui.render(PANE))

    expect(text).toContain('How the team is read')
    // The kit reports a hook that throws as missing, so the reason reads differently than in a session.
    expect(text).toContain('git config user.team: FAILED')
    expect(text).toContain('team: not read (git: ')
    expect(text).toContain('session directory: /work')
    await ui.press({ key: 'team-diagnosis-close-btn' })
    expect(textOf(await $.ui.render(PANE))).not.toContain('How the team is read')
    await ui.unmount()
  })

  test('once user.team is set, Refresh closes the check that said why the team was missing', TEAM, async ($, on) => {
    // Two team plugins: the name is not guessed from either, so the team is missing until user.team names it.
    const kept = world(on, {
      commands: [
        { name: 'team-platform-tools:deploy-check', source: 'plugin' },
        { name: 'team-billing:invoice-check', source: 'plugin' },
      ],
    })
    await $.session.start(SESSION)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })
    await ui.press({ key: 'team-why-btn' })
    await kept.clock.advance(1)
    expect(textOf(await $.ui.render(PANE))).toContain('How the team is read')

    kept.git.team = 'Platform Tools'
    await ui.press({ key: 'refresh-all-btn' })
    await kept.clock.advance(1)
    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('Platform Tools')
    expect(text).not.toContain('How the team is read')
    expect(text).not.toContain('why is it missing')
    await ui.unmount()
  })

  test('with no team plugin installed, Refresh drops a team list read earlier', TEAM, async ($, on) => {
    // The same command first from the team plugin, then only as a skill linked into ~/.claude/skills.
    const commands: (string | Command)[] = ['model', { name: 'deploy-check', source: 'plugin', plugin: 'team-platform-tools@acme-plugins' }]
    const kept = world(on, { team: 'Platform Tools', commands })
    await $.session.start(SESSION)
    await kept.clock.advance(1)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })
    expect(textOf(await $.ui.render(PANE))).toContain('Deploy check')

    commands.splice(1, 1, { name: 'deploy-check', source: 'user' })
    await ui.press({ key: 'refresh-all-btn' })
    await kept.clock.advance(1)
    const text = textOf(await $.ui.render(PANE))
    expect(text).not.toContain('Deploy check')
    expect(text).toContain('the team-platform-tools plugin is not installed')
    await ui.unmount()
  })

  test('a team plugin installed and /reload-plugins show its skills without Refresh', TEAM, async ($, on) => {
    const commands: (string | Command)[] = ['model']
    const kept = world(on, { team: 'Platform Tools', commands })
    await $.session.start(SESSION)
    await kept.clock.advance(1)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })
    expect(textOf(await $.ui.render(PANE))).toContain('plugin is not installed')

    commands.push({ name: 'team-platform-tools:deploy-check', source: 'plugin' })
    await $.command.run({ command: 'reload-plugins', args: '', ...RUN })
    await kept.clock.advance(1)
    expect(textOf(await $.ui.render(PANE))).toContain('Deploy check')
    await ui.unmount()
  })

  test('a team skill unfolds and runs with what was typed', TEAM, async ($, on) => {
    const kept = world(on, { team: 'Platform Tools', commands: [{ name: 'team-platform-tools:deploy-check', source: 'plugin' }] })
    await $.session.start(SESSION)
    await kept.clock.advance(1)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })

    await ui.press({ key: 'team-deploy-check-btn' })
    await ui.input({ key: 'arg-team-deploy-check', text: '  PROJ-1234 ' })

    expect(kept.ran).toEqual(['team-platform-tools:deploy-check PROJ-1234'])
    await ui.unmount()
  })
})

describe('general entries', () => {
  test('Review a PR runs /code-review only with a pull request', async ($, on) => {
    const kept = world(on)
    await $.session.start(SESSION)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })
    await ui.press({ key: 'review-pr-btn' })

    await ui.input({ key: 'arg-review-pr', text: 'please review' })
    expect(kept.ran).toEqual([])
    expect(kept.toasts).toContain('Expected a pull or merge request link, owner/repo#123, group/project!12 or a number')

    await ui.input({ key: 'arg-review-pr', text: 'https://github.com/acme/web/pull/42' })
    await kept.clock.advance(3500)
    await ui.press({ key: 'review-pr-btn' })
    await ui.input({ key: 'arg-review-pr', text: 'https://bitbucket.example.com/projects/APP/repos/app/pull-requests/81' })
    expect(kept.ran).toEqual(['code-review https://github.com/acme/web/pull/42', 'code-review https://bitbucket.example.com/projects/APP/repos/app/pull-requests/81'])
    await ui.unmount()
  })

  test('Review a PR takes GitHub, GitLab and Bitbucket references, nested GitLab groups too', () => {
    const accepts = (text: string) => GENERAL.find(entry => entry.key === 'review-pr')?.requires?.test.test(text)
    for (const text of [
      'https://github.com/acme/web/pull/42',
      'https://gitlab.com/acme/web/-/merge_requests/12',
      'https://bitbucket.example.com/projects/APP/repos/app/pull-requests/81',
      'acme/web#42',
      'acme/web!12',
      'acme/platform/web!12',
      '~sam/app/81',
      '42',
      '#42',
      '!12',
    ])
      expect(accepts(text)).toBe(true)
    for (const text of ['please review', 'acme/web', 'https://github.com/acme/web', 'main']) expect(accepts(text)).toBe(false)
  })

  test('the built-in review commands are offered, and nothing else without being pinned', async ($, on) => {
    world(on)
    await $.session.start(SESSION)

    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('Review changes')
    expect(text).toContain('Review a PR')
    expect(text).toContain('Security review')
  })
})

describe('pinned commands', () => {
  const DESIGN = { name: 'workflow:design', source: 'plugin' as const, description: 'Structured feature design that produces a Record.' }
  const SEARCH = { name: 'notes:find-notes', source: 'plugin' as const, description: 'Search the wiki, the chat and the code.' }

  test('the ＋ explains itself, finds a command by name or description, and a press pins it for the next session too', async ($, on) => {
    world(on, { commands: [...DEFAULT_COMMANDS, DESIGN, SEARCH] })
    await $.session.start(SESSION)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })

    await ui.press({ key: 'pin-plus-btn' })
    expect(textOf(await $.ui.render(PANE))).toContain('Pin a command you use often')
    await ui.input({ key: 'pin-search', text: 'wiki', kind: 'change' })
    let text = textOf(await $.ui.render(PANE))
    expect(text).toContain('/find-notes')
    expect(text).not.toContain('/design')

    await ui.press({ key: `pin-match-${SEARCH.name}-btn` })
    text = textOf(await $.ui.render(PANE))
    expect(text).not.toContain('Pin a command you use often')
    expect(text).toContain('Find notes')
    await $.session.start(SESSION)
    expect(textOf(await $.ui.render(PANE))).toContain('Find notes')
    await ui.unmount()
  })

  test('Enter pins the first match, and a pinned row runs and can be removed', async ($, on) => {
    const kept = world(on, { commands: [...DEFAULT_COMMANDS, DESIGN, SEARCH] })
    await $.session.start(SESSION)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })

    await ui.press({ key: 'pin-plus-btn' })
    await ui.input({ key: 'pin-search', text: 'design', kind: 'change' })
    await ui.input({ key: 'pin-search', text: 'design' })
    await ui.press({ key: `pin-${DESIGN.name}-btn` })
    await ui.input({ key: `arg-pin-${DESIGN.name}`, text: 'tab cache' })
    expect(kept.ran).toContain(`${DESIGN.name} tab cache`)

    await ui.press({ key: `pin-${DESIGN.name}-btn` })
    await ui.press({ key: `pin-${DESIGN.name}-unpin-btn` })
    expect(textOf(await $.ui.render(PANE))).not.toContain('Design')
    await $.session.start(SESSION)
    expect(textOf(await $.ui.render(PANE))).not.toContain('Design')
    await ui.unmount()
  })

  test('with nothing that fits, the search starts a new skill with skill-creator', async ($, on) => {
    const CREATOR = { name: 'skills:skill-creator', source: 'plugin' as const, description: 'Write a new skill.' }
    const kept = world(on, { commands: [...DEFAULT_COMMANDS, CREATOR] })
    await $.session.start(SESSION)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })

    await ui.press({ key: 'pin-plus-btn' })
    expect(textOf(await $.ui.render(PANE))).toContain('start a new skill from here')
    await ui.input({ key: 'pin-search', text: 'Check the build gate', kind: 'change' })
    expect(textOf(await $.ui.render(PANE))).toContain('New skill: "Check the build gate"')
    await ui.press({ key: 'pin-new-skill-btn' })

    expect(kept.ran).toContain(`${CREATOR.name} create a new skill: Check the build gate`)
    await ui.unmount()
  })

  test('a pinned command whose plugin is gone stays, and says so', async ($, on) => {
    world(on, { stored: { 'pinned-commands': [SEARCH.name] } })
    await $.session.start(SESSION)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })

    await ui.press({ key: `pin-${SEARCH.name}-btn` })
    expect(textOf(await $.ui.render(PANE))).toContain('not in this session')
    await ui.unmount()
  })
})

describe('focus ring', () => {
  test('the ring goes to the status badge instead of a row, and into a text field when asked', async ($, on) => {
    world(on)
    const landed: (string | undefined)[] = []
    on('ui.focus', ($, e) => {
      landed.push(e.element)
      return {}
    })
    await $.session.start(SESSION)
    await $.ui.render(PANE)

    const move = (element: string) =>
      $.ui.focus({ component: 'Pane', requestId: 'pelyar', plugin: 'pelyar', element, origin: { kind: 'person' } })
    await move('review-btn')
    await move('arg-review')
    await move('todo-input')
    await move('pin-search')

    expect(landed).toEqual(['focus-home', 'arg-review', 'todo-input', 'pin-search'])
  })
})

describe('background', () => {
  test('a palette picked in the settings paints the panel', { options: { background: 'midnight' } }, async ($, on) => {
    world(on)
    await $.session.start(SESSION)

    expect(JSON.stringify(await $.ui.render(PANE))).toContain('"backgroundColor":"#1c2233"')
  })

  test('a light theme paints the same palette off white', { options: { background: 'midnight' } }, async ($, on) => {
    world(on, { theme: 'light-daltonized' })
    await $.session.start(SESSION)

    expect(JSON.stringify(await $.ui.render(PANE))).toContain('"backgroundColor":"#e8ecf7"')
  })

  test('none, the default, leaves the engine look', async ($, on) => {
    world(on)
    await $.session.start(SESSION)

    expect(JSON.stringify(await $.ui.render(PANE))).not.toContain('backgroundColor":"#')
  })
})

describe('ticket', () => {
  const issue = (status: string, category: string) => ({
    issues: {
      nodes: [
        {
          key: 'PROJ-1234',
          webUrl: 'https://example.atlassian.net/browse/PROJ-1234',
          fields: { summary: 'Jump between tabs', status: { name: status, statusCategory: { key: category } } },
        },
      ],
    },
  })

  test('the ticket in the branch name shows with its Jira status, a press opens it', async ($, on) => {
    const kept = world(on, { branch: 'feature/PROJ-1234-tab-jump', jira: () => issue('In Testing', 'indeterminate') })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('PROJ-1234 · In Testing')
    expect(text).toContain('Jump between tabs')

    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })
    await ui.press({ key: 'ticket-btn' })
    expect(kept.opened).toEqual(['https://example.atlassian.net/browse/PROJ-1234'])
    await ui.unmount()
  })

  test('the Jira site setting is used as it is, without asking the server which sites it reaches', { options: { jiraSite: 'https://acme.atlassian.net/' } }, async ($, on) => {
    const kept = world(on, { branch: 'feature/PROJ-1234-tab-jump', jira: () => issue('Open', 'new') })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    expect(kept.calls).not.toContain('getAccessibleAtlassianResources')
    expect(kept.servers.some(call => call.endsWith('/searchJiraIssuesUsingJql'))).toBe(true)
  })

  test('without any ticket source the list says it is not connected, quietly', async ($, on) => {
    const kept = world(on, { onlyServers: [] })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    const tree = await $.ui.render(PANE)
    expect(textOf(tree)).toContain('not connected: no ticket source: connect Jira or Lin')
    expect(propsOfText(tree, 'not connected: no ticket source')).toEqual({ dimColor: true })
  })

  test('with the source set to jira, a Jira that is not connected is said', { options: { ticketSource: 'jira' } }, async ($, on) => {
    const kept = world(on, { onlyServers: [] })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    expect(textOf(await $.ui.render(PANE))).toContain('Jira: not connected: no connected MCP server has getAcc')
  })

  test('a key Jira does not have is asked of Linear', async ($, on) => {
    const kept = world(on, {
      branch: 'feature/ENG-42-login',
      onlyServers: ['claude.ai Linear'],
      linearIssue: { identifier: 'ENG-42', title: 'Login loops', url: 'https://linear.app/acme/issue/ENG-42', status: 'In Progress', statusType: 'started' },
    })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    expect(textOf(await $.ui.render(PANE))).toContain('ENG-42 · In Progress Login loops')
  })

  test('a key Jira fails on is still asked of Linear', async ($, on) => {
    const kept = world(on, {
      branch: 'feature/ENG-42-login',
      jiraError: 'The value ENG does not exist for the field project.',
      linearIssue: { identifier: 'ENG-42', title: 'Login loops', url: 'https://linear.app/acme/issue/ENG-42', status: 'In Progress', statusType: 'started' },
    })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    expect(textOf(await $.ui.render(PANE))).toContain('ENG-42 · In Progress Login loops')
  })

  test('a Jira that hangs on the key gives way to Linear after its 20 seconds', async ($, on) => {
    const kept = world(on, {
      branch: 'feature/ENG-42-login',
      jiraHangs: true,
      linearIssue: { identifier: 'ENG-42', title: 'Login loops', url: 'https://linear.app/acme/issue/ENG-42', status: 'In Progress', statusType: 'started' },
    })
    await $.session.start(SESSION)
    await kept.clock.advance(20_001)

    expect(textOf(await $.ui.render(PANE))).toContain('ENG-42 · In Progress Login loops')
  })

  test('a Jira failure is said when no tracker has the key', async ($, on) => {
    const kept = world(on, { branch: 'feature/PROJ-42-login', jiraError: 'Service unavailable', linearIssue: null })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    expect(textOf(await $.ui.render(PANE))).toContain('PROJ-42 · Service unavailable')
  })

  test('a server the session lists the tool on is not "not connected" when it fails, even under a usual name', { options: { ticketSource: 'jira', showPrs: false, showReviewPrs: false } }, async ($, on) => {
    const kept = world(on, {
      mcpTools: [
        { name: 'mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql', serverName: 'claude.ai Atlassian' },
        { name: 'mcp__claude_ai_Atlassian__getAccessibleAtlassianResources', serverName: 'claude.ai Atlassian' },
      ],
      onlyServers: [],
    })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('Jira: retrying in')
    expect(text).not.toContain('not connected')
  })

  test('an issue number in the branch is looked up on the forge the checkout is on', async ($, on) => {
    const kept = world(on, {
      branch: '123-fix-login',
      remote: 'git@github.com:acme/web.git',
      github: { 'issue-123': { title: 'Login fails on Safari', state: 'open', html_url: 'https://github.com/acme/web/issues/123' } },
    })
    await $.session.start(SESSION)
    await kept.clock.advance(1)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })

    expect(textOf(await $.ui.render(PANE))).toContain('#123 · open Login fails on Safari')
    await ui.press({ key: 'ticket-btn' })
    expect(kept.opened).toEqual(['https://github.com/acme/web/issues/123'])
    await ui.unmount()
  })

  test('a number in a branch of a repository on neither forge is no ticket', async ($, on) => {
    const kept = world(on, { branch: 'release/2026-10', remote: 'ssh://git@git.example.com/app.git', github: {} })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    expect(textOf(await $.ui.render(PANE))).toContain('⎇ release/2026-10')
    expect(kept.runs.filter(command => command.startsWith('gh api repos/'))).toEqual([])
  })

  test('a branch without a ticket shows its name only, and Jira is not asked', async ($, on) => {
    let asked = 0
    const kept = world(on, { branch: 'main', repo: true, jira: () => (asked++, issue('Open', 'new')) })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    // On the context row, as the status line shows it: the branch, then the checkout's folder.
    expect(textOf(await $.ui.render(PANE))).toContain('⎇ main · repo')
    expect(asked).toBe(0)
  })

  test('a detached HEAD shows its commit, not "HEAD"', async ($, on) => {
    const kept = world(on, { detached: 'abc1234' })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('⎇ detached abc1234')
  })

  test('a Jira error shows its reason next to the key', async ($, on) => {
    const kept = world(on, { branch: 'feature/PROJ-1234-tab-jump', jiraError: '403 app not installed' })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    expect(textOf(await $.ui.render(PANE))).toContain('PROJ-1234 · 403 app not installed')
  })
})

describe('review fixes', () => {
  test('a double click on Clear is one gesture, not a confirmation', async ($, on) => {
    const kept = world(on)
    await $.session.start(SESSION)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })

    await ui.press({ key: 's-clear-btn' })
    await kept.clock.advance(150)
    await ui.press({ key: 's-clear-btn' })

    expect(kept.ran).toEqual([])
    await ui.unmount()
  })

  test('a double click on run starts the command once', TEAM, async ($, on) => {
    const kept = world(on, { team: 'Platform Tools', commands: [{ name: 'team-platform-tools:deploy-check', source: 'plugin' }] })
    await $.session.start(SESSION)
    await kept.clock.advance(1)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })
    await ui.press({ key: 'team-deploy-check-btn' })

    await Promise.all([ui.press({ key: 'team-deploy-check-run-btn' }), ui.press({ key: 'team-deploy-check-run-btn' })])

    expect(kept.ran).toEqual(['team-platform-tools:deploy-check'])
    await ui.unmount()
  })

  test('a run leaves the panel open and folds its row', TEAM, async ($, on) => {
    const kept = world(on, { team: 'Platform Tools', commands: [{ name: 'team-platform-tools:deploy-check', source: 'plugin' }] })
    await $.session.start(SESSION)
    await kept.clock.advance(1)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })
    await ui.press({ key: 'team-deploy-check-btn' })

    await ui.press({ key: 'team-deploy-check-run-btn' })

    expect(kept.ran).toEqual(['team-platform-tools:deploy-check'])
    expect(kept.closes).toEqual([])
    expect(textOf(await $.ui.render(PANE))).not.toContain('run without details')
    await ui.unmount()
  })

  test('a command started while Claude answers queues at once, with no second press', async ($, on) => {
    const kept = world(on)
    await $.session.start(SESSION)
    await $.turn.start({ text: 'busy', turnId: 't-1' })
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })
    await ui.press({ key: 'review-pr-btn' })

    await ui.input({ key: 'arg-review-pr', text: 'acme/web#81' })

    expect(kept.ran).toEqual(['code-review acme/web#81'])
    expect(kept.toasts).toContain('Review a PR queued, it runs after the current answer')
    await ui.unmount()
  })

  test('Done finds the item again when the band moved the lines meanwhile', async ($, on) => {
    const kept = world(on, { files: { [TODO_PATH]: '- [ ] call Alex\n' } })
    await $.session.start(SESSION)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })
    await ui.press({ key: 'todo-btn' })

    kept.touch(TODO_PATH, '- [ ] added by the band\n- [ ] call Alex\n')
    await ui.press({ key: 'todo-done-0' })

    expect(kept.files[TODO_PATH]).toBe('- [ ] added by the band\n- [x] call Alex\n')
    await ui.unmount()
  })

  test('a Jira that never answers is given up after 20 seconds, and not asked again after the next turn', async ($, on) => {
    const kept = world(on, { branch: 'feature/PROJ-1234-tab-jump', jiraHangs: true })
    await $.session.start(SESSION)
    await kept.clock.advance(20_000)

    expect(textOf(await $.ui.render(PANE))).toContain('PROJ-1234 · no answer in 20 s')

    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't-1', reason: 'answer' })
    for (let step = 0; step < 5; step++) await kept.clock.advance(1)
    expect(kept.jiraCalls).toEqual(['searchJiraIssuesUsingJql'])
  })

  test('the title is Pelyar, on top of one box with the dashboard and then the tools', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    await $.command.run({ command: 'pelyar', args: 'open', ...RUN })

    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('◆ P E L Y A R')
    expect(text.indexOf('◆ P E L Y A R')).toBeLessThan(text.indexOf('M O D E L'))
  })

  test('the Panel title setting names the panel', { options: { title: 'Bridge' } }, async ($, on) => {
    world(on)
    await $.session.start(SESSION)

    expect(textOf(await $.ui.render(PANE))).toContain('◆ B R I D G E')
  })
})

describe('dashboard', () => {
  test('the context meter follows the session, and the nudge at 70% is toasted without the band', async ($, on) => {
    const kept = world(on)
    await $.session.start(SESSION)
    await $.session.measure(measure(42))
    expect(textOf(await $.ui.render(PANE))).toContain('▰▰▰▰▱▱▱▱▱▱ 42%')

    await $.session.measure(measure(71))
    expect(textOf(await $.ui.render(PANE))).toContain('time to /wrapup')
    expect(kept.toasts).toContain('Context at 71%: good moment to /wrapup, then /clear')
  })

  test('without a wrapup command the nudge suggests /compact', async ($, on) => {
    const kept = world(on, { commands: ['model', 'effort', 'clear'] })
    await $.session.start(SESSION)
    expect(textOf(await $.ui.render(PANE))).toContain('/compact nudge at 70%')

    await $.session.measure(measure(86))
    expect(textOf(await $.ui.render(PANE))).toContain('/compact now, then /clear')
    expect(kept.toasts).toContain('Context at 86%: /compact or /clear now (auto-compact is close)')
  })

  test('with the band installed the nudge is shown but not toasted (the band toasts it)', async ($, on) => {
    const kept = world(on, { commands: [...DEFAULT_COMMANDS, 'band'] })
    await $.session.start(SESSION)
    await $.session.measure(measure(86))

    expect(textOf(await $.ui.render(PANE))).toContain('/wrapup now, then /clear')
    expect(kept.toasts).toEqual([])
  })

  // 25 minutes of ticks, one a second: slow on a busy machine, so a longer limit than the default 5 s.
  test('the pomodoro starts a 25-minute focus round in the store and ends it into a break with a toast', { timeoutMs: 30_000 }, async ($, on) => {
    const kept = world(on)
    await $.session.start(SESSION)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })
    expect(textOf(await $.ui.render(PANE))).toContain('Start')

    await ui.press({ key: 'pomodoro-start-btn' })
    let tree = await $.ui.render(PANE)
    let text = textOf(tree)
    expect(text).toContain('Pomodoro●focus 25:00')
    // The word is always Pomodoro in the panel's orange; focus follows in the same orange.
    expect(colorOf(tree, 'Pomodoro')).toBe('claude')
    expect(colorOf(tree, 'focus 25:00')).toBe('claude')

    await kept.clock.advance(25 * 60_000 + 1000)
    tree = await $.ui.render(PANE)
    text = textOf(tree)
    expect(text).toContain('Pomodoro●break 04:59')
    expect(text).toContain('1 today')
    expect(colorOf(tree, 'Pomodoro')).toBe('claude')
    expect(colorOf(tree, 'break 04:59')).toBe('success')
    expect(kept.toasts).toContain('Focus round 1 done: take a 5-minute break')
    // And a macOS notification with a sound, seen outside the terminal too.
    expect(kept.notifications).toHaveLength(1)
    expect(kept.notifications[0]).toContain('"Focus round 1 done: take a 5-minute break"')
    expect(kept.sounds).toEqual(['/System/Library/Sounds/Glass.aiff'])
    await ui.unmount()
  })

  test('a pomodoro of 50/10 without sound runs 50 minutes and ends silently', { timeoutMs: 60_000, options: { pomodoroLength: '50/10', pomodoroSound: false } }, async ($, on) => {
    const kept = world(on)
    await $.session.start(SESSION)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })

    await ui.press({ key: 'pomodoro-start-btn' })
    expect(textOf(await $.ui.render(PANE))).toContain('focus 50:00')
    await kept.clock.advance(50 * 60_000 + 1000)

    expect(textOf(await $.ui.render(PANE))).toContain('break 09:59')
    expect(kept.toasts).toContain('Focus round 1 done: take a 10-minute break')
    expect(kept.notifications).toHaveLength(1)
    expect(kept.sounds).toEqual([])
    await ui.unmount()
  })

  test('my PRs, the PRs to review, my tickets, the mail and the meetings are listed', { options: { showMail: true } }, async ($, on) => {
    const kept = world(on, {
      // Mail has no usual server name: it is read from whichever server lists its tools.
      mcpTools: [
        { name: 'mcp__mail__list_recent_emails', serverName: 'mail' },
        { name: 'mcp__mail__list_calendar_events', serverName: 'mail' },
      ],
      prs: { mine: [pullRequest(1, '[PROJ-1] mine', 'Sam', 1, 2)], reviewing: [pullRequest(2, '[PROJ-2] theirs', 'Alex', 0, 1)] },
      tickets: [jiraNode('PROJ-3', 'Fix the thing', 'In Progress', 'indeterminate')],
      unread: [{ id: 'm1', from_name: 'Robin', subject: 'Hello' }],
      meetings: [{ subject: 'Standup', start: inMinutes(25), end: inMinutes(40), response: 'accepted' }],
    })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('My PRs')
    expect(text).toContain('[PROJ-1]')
    expect(text).toContain('ready')
    expect(text).toContain('Other PRs')
    expect(text).toContain('[PROJ-2]')
    expect(text).toContain('to review')
    expect(text).toContain('Tickets')
    expect(text).toContain('PROJ-3')
    expect(text).toContain('In Progress')
    expect(text).toContain('Mail')
    expect(text).toContain('1 unread')
    expect(text).toContain('RobinHello')
    // The dashboard sits above the tools, the model chips after it.
    expect(text.indexOf('P E L Y A R')).toBeLessThan(text.indexOf('MODEL'))
    expect(text).toContain('Standup')
    expect(text).toContain('in 25m')
  })

  test('a press on a PR or a ticket opens it in the browser', async ($, on) => {
    const kept = world(on, { prs: { mine: [pullRequest(7, '[PROJ-7] mine', 'Sam', 0, 1)], reviewing: [] }, tickets: [jiraNode('PROJ-8', 'Later', 'Open', 'new')] })
    await $.session.start(SESSION)
    await kept.clock.advance(1)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })

    await ui.press({ key: 'pr-open-bitbucket:APP/app#7-btn' })
    await ui.press({ key: 'issue-open-PROJ-8-btn' })

    expect(kept.opened).toEqual(['https://bitbucket.example.com/projects/APP/repos/app/pull-requests/7', 'https://example.atlassian.net/browse/PROJ-8'])
    await ui.unmount()
  })

  test('a part switched off asks its server nothing and shows no rows', { options: { showPrs: false, showReviewPrs: false, showTickets: false, showMail: false } }, async ($, on) => {
    const kept = world(on, { github: githubAnswer('sam') })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    expect(kept.calls).toEqual([])
    expect(kept.runs.filter(command => command.startsWith('gh '))).toEqual([])
    const text = textOf(await $.ui.render(PANE))
    expect(text).not.toContain('My PRs')
    expect(text).not.toContain('Other PRs')
    expect(text).not.toContain('Mail')
  })

  test('mail is off by default and its tools are not asked', async ($, on) => {
    const kept = world(on, { unread: [{ id: 'm1', from_name: 'Robin', subject: 'Hello' }] })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    expect(kept.calls).not.toContain('list_recent_emails')
    expect(textOf(await $.ui.render(PANE))).not.toContain('unread')
  })

  test('Other PRs shows without My PRs, from the same Bitbucket read', { options: { showPrs: false } }, async ($, on) => {
    const kept = world(on, { prs: { mine: [pullRequest(1, '[PROJ-1] mine', 'Sam', 1, 2)], reviewing: [pullRequest(2, '[PROJ-2] theirs', 'Alex', 0, 1)] } })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    expect(kept.calls).toContain('bitbucket_getDashboardPullRequests')
    const text = textOf(await $.ui.render(PANE))
    expect(text).not.toContain('My PRs')
    expect(text).not.toContain('[PROJ-1]')
    expect(text).toContain('Other PRs')
    expect(text).toContain('[PROJ-2]')
  })

  test('each feed asks the server the session has its tool on, whatever its name', async ($, on) => {
    const kept = world(on, {
      tickets: [jiraNode('PROJ-3', 'Fix the thing', 'In Progress', 'indeterminate')],
      prs: { mine: [pullRequest(1, '[PROJ-1] mine', 'Sam', 1, 2)], reviewing: [] },
      mcpTools: [
        { name: 'mcp__my_jira__getAccessibleAtlassianResources', serverName: 'my jira' },
        { name: 'mcp__my_jira__searchJiraIssuesUsingJql', serverName: 'my jira' },
        { name: 'mcp__my_bb__bitbucket_getDashboardPullRequests', serverName: 'my bb' },
      ],
      onlyServers: ['my jira', 'my bb'],
    })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    expect(kept.servers).toContain('my jira/searchJiraIssuesUsingJql')
    expect(kept.servers).toContain('my bb/bitbucket_getDashboardPullRequests')
    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('PROJ-3')
    expect(text).toContain('[PROJ-1]')
  })

  test('a call auto mode refuses keeps its hint, and no other server is tried after it', async ($, on) => {
    // Only the first usual Bitbucket server is connected; the second would answer "not connected".
    const kept = world(on, { prsRefused: 'The server-side auto mode classifier gave no verdict for mcp__bitbucket-dc__bitbucket_getDashboardPullRequests', onlyServers: ['bitbucket-dc', 'claude.ai Atlassian'] })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('auto mode refused')
    expect(text).not.toContain('not connected')
  })

  test('Other PRs on its own says when Bitbucket could not be read', { options: { showPrs: false } }, async ($, on) => {
    const kept = world(on, { prsError: '500 server error' })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('Other PRs')
    expect(text).toContain('not read yet')
    expect(text).toContain('Bitbucket: retrying in 5s, /mcp to log in: 500 server')
  })

  test('the tools switched off leave their sections out', {
    options: { showSessionCommands: false, showModel: false, showTodos: false, showCommands: false, showTeam: false },
  }, async ($, on) => {
    const kept = world(on, { team: 'Platform Tools' })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    const text = textOf(await $.ui.render(PANE))
    expect(text).not.toContain('Catchup')
    expect(text).not.toContain('M O D E L')
    expect(text).not.toContain('1-4 model')
    expect(text).not.toContain('W O R K')
    expect(text).not.toContain('T E A M')
    expect(text).toContain('esc closes')
    expect(kept.runs.filter(command => command.includes('user.team'))).toEqual([])
  })

  test('Work keeps its commands with the todo list off', { options: { showTodos: false } }, async ($, on) => {
    const kept = world(on)
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('W O R K')
    expect(text).toContain('Review a PR')
    expect(text).not.toContain('Todo (')
    expect(text).not.toContain('todo')
  })

  test('Work keeps its todo list with the commands off', { options: { showCommands: false } }, async ($, on) => {
    const kept = world(on)
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('Todo (')
    expect(text).not.toContain('Review a PR')
  })

  test('with the band installed the slow feeds are read only while the panel is open', async ($, on) => {
    const kept = world(on, { commands: [...DEFAULT_COMMANDS, 'band'] })
    await $.session.start(SESSION)
    await kept.clock.advance(1)
    expect(kept.calls).toEqual([])

    await $.command.run({ command: 'pelyar', args: 'open', ...RUN })
    await kept.clock.advance(1)
    expect(kept.calls).toContain('bitbucket_getDashboardPullRequests')
  })

  test('another Claude window shows under Work while it runs', async ($, on) => {
    const kept = world(on, {
      sessionFiles: [{ pid: 42, sessionId: 'other', name: 'api-server', cwd: '/w', kind: 'interactive', status: 'busy', startedAt: NOW - 120_000, statusUpdatedAt: NOW - 120_000, procStart: 'Mon Jan 1 00:00:00 2026' }],
    })
    await $.session.start(SESSION)
    await $.command.run({ command: 'pelyar', args: 'open', ...RUN })
    await kept.clock.advance(1)

    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('Claude sessions')
    expect(text).toContain('api-server')
    expect(text).toContain('working')
    expect(text).toContain('2m')
  })

  test('Spotify shows the track with its position, and a press controls the app', async ($, on) => {
    const kept = world(on, { spotify: { state: 'playing', title: 'Pretty Little Fears', artist: '6LACK', album: 'x', durationMs: 240_000, positionS: 7 } })
    await $.session.start(SESSION)
    await $.command.run({ command: 'pelyar', args: 'open', ...RUN })
    await kept.clock.advance(1)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })

    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('0:07/4:00')
    expect(text).toContain('Pretty Little Fears · 6LACK')
    await ui.press({ key: 'spotify-pause-btn' })
    expect(kept.spotifyActions).toEqual(['pause'])
    await ui.unmount()
  })

  test('Apple Music shows under its own name, and a press goes to the Music app', { options: { musicPlayer: 'music' } }, async ($, on) => {
    const kept = world(on, { spotify: { app: 'Music', state: 'playing', title: 'Halo', artist: 'Beyonce', album: 'x', durationMs: 261_000, positionS: 3 } })
    await $.session.start(SESSION)
    await $.command.run({ command: 'pelyar', args: 'open', ...RUN })
    await kept.clock.advance(1)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })

    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('Apple Music')
    expect(text).not.toContain('Spotify')
    expect(text).toContain('Halo · Beyonce')
    expect(kept.runs.some(command => command.includes('["Music"]') && !command.includes('Spotify'))).toBe(true)
    await ui.press({ key: 'spotify-pause-btn' })
    expect(kept.runs.some(command => command.includes("Application('Music'); if (app.running()) app.pause()"))).toBe(true)
    await ui.unmount()
  })

  test('on Windows Spotify is read over the system media controls, with text icons, and a press controls it', async ($, on) => {
    const kept = world(on, {
      env: { OS: 'Windows_NT' },
      spotify: { app: 'Spotify', state: 'playing', title: 'Pretty Little Fears', artist: '6LACK', album: 'x', durationMs: 240_000, positionS: 7 },
    })
    await $.session.start(SESSION)
    await $.command.run({ command: 'pelyar', args: 'open', ...RUN })
    await kept.clock.advance(1)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })

    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('0:07/4:00')
    expect(text).toContain('Pretty Little Fears · 6LACK')
    // Windows Terminal draws ⏸ and ⏭ as emoji, so the player draws these.
    expect(text).toContain('▮▮')
    expect(text).not.toContain('⏸')
    expect(kept.runs.some(command => command.startsWith('osascript'))).toBe(false)
    await ui.press({ key: 'spotify-pause-btn' })
    expect(kept.spotifyActions).toEqual(['TryPauseAsync'])
    await ui.unmount()
  })

  test('on Windows Apple Music, which has no Windows app, is not asked', { options: { musicPlayer: 'music' } }, async ($, on) => {
    const kept = world(on, {
      env: { OS: 'Windows_NT' },
      spotify: { app: 'Spotify', state: 'playing', title: 'Pretty Little Fears', artist: '6LACK', album: 'x', durationMs: 240_000, positionS: 7 },
    })
    await $.session.start(SESSION)
    await $.command.run({ command: 'pelyar', args: 'open', ...RUN })
    await kept.clock.advance(1)

    expect(textOf(await $.ui.render(PANE))).not.toContain('Pretty Little Fears')
    expect(kept.runs.some(command => command.startsWith('powershell.exe') && command.includes('Spotify'))).toBe(false)
  })

  test('the title has a row of its own, and the gear opens this plugin\'s settings', async ($, on) => {
    const kept = world(on)
    await $.session.start(SESSION)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })

    // The node drawn under a key, searched through the whole tree.
    const find = (tree: unknown, key: string): unknown => {
      if (Array.isArray(tree)) return tree.map(item => find(item, key)).find(item => item !== undefined)
      if (typeof tree !== 'object' || tree === null) return undefined
      if (Reflect.get(tree, 'key') === key || Reflect.get(Object(Reflect.get(tree, 'props')), 'key') === key) return tree
      return find(Reflect.get(tree, 'children'), key)
    }
    const tree = await $.ui.render(PANE)
    expect(textOf(find(tree, 'dash-title'))).toContain('P E L Y A R')
    const controlsRow = textOf(find(tree, 'dash-head'))
    expect(controlsRow).toContain('Refresh')
    expect(controlsRow).not.toContain('P E L Y A R')
    await ui.press({ key: 'settings-btn' })
    expect(kept.ran).toContain('plugin configure pelyar@pelyar')
    await ui.unmount()
  })

  test('a folded tool section stays folded in the next session', TEAM, async ($, on) => {
    world(on, { team: 'Platform Tools' })
    await $.session.start(SESSION)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })
    expect(textOf(await $.ui.render(PANE))).toContain('No Platform Tools skills')

    await ui.press({ key: 'team-btn' })
    expect(textOf(await $.ui.render(PANE))).not.toContain('No Platform Tools skills')
    await $.session.start(SESSION)
    expect(textOf(await $.ui.render(PANE))).not.toContain('No Platform Tools skills')
    await ui.unmount()
  })

  test('at the start everything but Model and Work is folded, the dashboard to one row per part', async ($, on) => {
    const kept = world(on, { folds: null, prs: { mine: [pullRequest(1, '[PROJ-1] mine', 'Sam', 1, 2)], reviewing: [] } })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('My PRs 1 open')
    expect(text).not.toContain('[PROJ-1]')
    expect(text).toContain('a switch is also saved')
    expect(text).toContain('Review a PR')
    expect(text).not.toContain('No team set')
  })

  test('a dashboard part folds to its summary, the dashboard and the model chips fold whole', async ($, on) => {
    const kept = world(on, { prs: { mine: [pullRequest(1, '[PROJ-1] mine', 'Sam', 1, 2)], reviewing: [] } })
    await $.session.start(SESSION)
    await kept.clock.advance(1)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })
    expect(textOf(await $.ui.render(PANE))).toContain('[PROJ-1]')

    await ui.press({ key: 'prs-btn' })
    let text = textOf(await $.ui.render(PANE))
    expect(text).toContain('My PRs')
    expect(text).toContain('1 open')
    expect(text).not.toContain('[PROJ-1]')

    await ui.press({ key: 'dashboard-btn' })
    text = textOf(await $.ui.render(PANE))
    expect(text).toContain('◆ P E L Y A R')
    expect(text).not.toContain('My PRs')
    // The context row, its nudge and the session commands stay, right under the title.
    expect(text).toContain('/wrapup nudge at 70%')
    expect(text.indexOf('Context')).toBeLessThan(text.indexOf('Catchup'))
    expect(text.indexOf('Catchup')).toBeLessThan(text.indexOf('M O D E L'))

    expect(text).toContain('MODEL')
    await ui.press({ key: 'model-btn' })
    expect(textOf(await $.ui.render(PANE))).not.toContain('a switch is also saved')
    await ui.unmount()
  })

  // The open also asks for `$.ui.scroll({ to: 'end' })`; the kit does not carry a plugin's scroll
  // to a hook, so that part is checked by eye.
  test('the panel sits at the bottom of its window', async ($, on) => {
    const kept = world(on)
    await $.session.start(SESSION)
    await $.command.run({ command: 'pelyar', args: 'open', ...RUN })
    await kept.clock.advance(1)

    expect(JSON.stringify(await $.ui.render(PANE))).toContain('"justifyContent":"flex-end"')
  })

  test('Spotify that is not running takes no row', async ($, on) => {
    const kept = world(on)
    await $.session.start(SESSION)
    await $.command.run({ command: 'pelyar', args: 'open', ...RUN })
    await kept.clock.advance(1)

    expect(textOf(await $.ui.render(PANE))).not.toContain('Spotify')
  })
})

describe('pull requests on GitHub', () => {
  test('gh lists my PRs and the ones to review, a stale review as re-review, failed checks in red', async ($, on) => {
    const kept = world(on, {
      onlyServers: [],
      github: githubAnswer('sam', {
        mine: [githubPr(5, 'Add login', 'Sam', { reviews: [{ login: 'alex', state: 'APPROVED', oid: 'h2' }] }), githubPr(6, 'Broken build', 'Sam', { checks: 'FAILURE' })],
        requested: [githubPr(9, '[WEB-12] Fix the nav', 'Alex', { requested: ['sam'] })],
        reviewed: [githubPr(11, 'Refactor', 'Robin', { reviews: [{ login: 'sam', state: 'APPROVED', oid: 'h1' }], head: 'h2' })],
      }),
    })
    await $.session.start(SESSION)
    await kept.clock.advance(1)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })

    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('2 open · 1 ready · 1 need attention')
    expect(text).toContain('[#5]acme/webready')
    expect(text).toContain('[#6]acme/webchecks failed')
    expect(text).toContain('[WEB-12]acme/webto review')
    expect(text).toContain('[#11]acme/webre-review')
    expect(text).toContain('2 open · 2 to review')
    expect(text).not.toContain('no pull request source')

    await ui.press({ key: 'pr-open-github:acme/web#9-btn' })
    expect(kept.opened).toEqual(['https://github.com/acme/web/pull/9'])
    await ui.unmount()
  })

  test('GitHub and Bitbucket show side by side, the same number in each kept apart', async ($, on) => {
    const kept = world(on, {
      github: githubAnswer('sam', { mine: [githubPr(7, 'From GitHub', 'Sam')] }),
      prs: { mine: [pullRequest(7, '[PROJ-7] from Bitbucket', 'Sam', 0, 1)], reviewing: [] },
    })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('2 open')
    expect(text).toContain('[#7]acme/web')
    expect(text).toContain('[PROJ-7]APP/app')
  })

  test('a source that fails once and comes back is not toasted as merged, nor its reviews as newly requested', async ($, on) => {
    const answer: Record<string, unknown> = githubAnswer('sam', { mine: [githubPr(7, 'Mine', 'Sam')], requested: [githubPr(8, 'Theirs', 'Alex', { requested: ['sam'] })] })
    const kept = world(on, { github: answer, prs: { mine: [pullRequest(1, '[PROJ-1] mine', 'Sam', 0, 1)], reviewing: [] } })
    await $.session.start(SESSION)
    await kept.clock.advance(1)
    expect(textOf(await $.ui.render(PANE))).toContain('[#7]acme/web')

    answer.errors = [{ message: 'Something went wrong' }]
    await kept.clock.advance(5 * 60_000)
    expect(textOf(await $.ui.render(PANE))).toContain('GitHub: Something went wrong')
    delete answer.errors
    await kept.clock.advance(5 * 60_000)

    expect(textOf(await $.ui.render(PANE))).toContain('[#7]acme/web')
    expect(kept.toasts.filter(text => text.includes('no longer open') || text.includes('Review requested'))).toEqual([])
  })

  test('with the source on auto, a gh that is missing or logged out is left out without a word', async ($, on) => {
    const kept = world(on, { github: 'logged-out', prs: { mine: [pullRequest(1, '[PROJ-1] mine', 'Sam', 1, 2)], reviewing: [] } })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('[PROJ-1]')
    expect(text).not.toContain('GitHub')
    expect(text).not.toContain('gh auth login')
  })

  test('with no source set up at all, the PR parts say so quietly', async ($, on) => {
    const kept = world(on, { onlyServers: [] })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    const tree = await $.ui.render(PANE)
    expect(textOf(tree)).toContain('not connected: no pull request source: log in with gh or')
    expect(propsOfText(tree, 'not connected: no pull request source')).toEqual({ dimColor: true })
  })

  test('with the source set to github, a logged-out gh is said', { options: { prSource: 'github' } }, async ($, on) => {
    const kept = world(on, { github: 'logged-out' })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    expect(textOf(await $.ui.render(PANE))).toContain('GitHub: gh is not logged in: run gh auth login, retrying')
    expect(kept.calls).not.toContain('bitbucket_getDashboardPullRequests')
  })

  test('one source failing leaves the other one listed, with the failure under it', async ($, on) => {
    const kept = world(on, { github: githubAnswer('sam', { mine: [githubPr(3, 'Still here', 'Sam')] }), prsError: '500 server error' })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('[#3]acme/web')
    expect(text).toContain('Bitbucket: retrying in 5s, /mcp to log in: 500 server')
  })

  test('a GitHub Enterprise host is passed to gh', { options: { githubHost: 'https://github.example.com/', showJira: false } }, async ($, on) => {
    const kept = world(on, { github: githubAnswer('sam') })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    expect(kept.runs.some(command => command.startsWith('gh api graphql --hostname github.example.com '))).toBe(true)
  })

  test('the query asks for mine, requested and reviewed, and a GraphQL error is thrown with its message', () => {
    const argv = githubArgv('')
    expect(argv.slice(0, 3)).toEqual(['gh', 'api', 'graphql'])
    expect(argv).toContain('mine=is:pr is:open archived:false author:@me')
    expect(argv).toContain('requested=is:pr is:open archived:false review-requested:@me')
    expect(argv).toContain('reviewed=is:pr is:open archived:false reviewed-by:@me -author:@me')
    expect(() => parseGithubPullRequests(JSON.stringify({ errors: [{ message: 'Bad credentials' }] }))).toThrow('Bad credentials')
  })

  test('a PR both requested and reviewed shows once, as a re-review once asked again after new commits', () => {
    const pr = githubPr(4, 'Twice', 'Alex', { reviews: [{ login: 'sam', state: 'CHANGES_REQUESTED', oid: 'h1' }], requested: ['sam'], head: 'h2' })
    const found = parseGithubPullRequests(JSON.stringify(githubAnswer('sam', { requested: [pr], reviewed: [pr] })))
    expect(found.reviewing).toHaveLength(1)
    expect(found.me).toBe('sam')
    expect(found.reviewing[0]?.reviews).toEqual([{ slug: 'sam', status: 'UNAPPROVED', lastReviewedCommit: 'h1' }])
  })
})

describe('GitLab and the ticket list', () => {
  // A merge request as GitLab's REST list answers it.
  function mergeRequest(iid: number, title: string, author: string, { id = iid * 100, status = 'not_approved', reviewers = [] as string[], conflicts = false } = {}) {
    return {
      id,
      iid,
      title,
      web_url: `https://gitlab.com/acme/api/-/merge_requests/${iid}`,
      draft: false,
      has_conflicts: conflicts,
      detailed_merge_status: status,
      project_id: 42,
      references: { full: `acme/api!${iid}` },
      author: { username: author.toLowerCase(), name: author },
      reviewers: reviewers.map(username => ({ username })),
      sha: 's1',
    }
  }

  test('glab lists my merge requests and the ones I review, with who approved each', async ($, on) => {
    const reviewing = [mergeRequest(8, 'Rate limits', 'Alex', { reviewers: ['sam'] }), mergeRequest(9, 'Cache headers', 'Robin', { reviewers: ['sam'] })]
    const kept = world(on, {
      onlyServers: [],
      gitlab: endpoint => {
        if (endpoint === 'user') return { username: 'sam' }
        // Robin approved !3 without being a reviewer; nobody approved !4; I approved !9.
        if (endpoint === 'projects/42/merge_requests/3/approvals') return { approved_by: [{ user: { username: 'alex' } }, { user: { username: 'robin' } }] }
        if (endpoint === 'projects/42/merge_requests/4/approvals') return { approved_by: [] }
        if (endpoint === 'projects/42/merge_requests/8/approvals') return { approved_by: [] }
        if (endpoint === 'projects/42/merge_requests/9/approvals') return { approved_by: [{ user: { username: 'sam' } }] }
        if (endpoint.includes('scope=created_by_me'))
          return [mergeRequest(3, 'Ready one', 'Sam', { status: 'mergeable', reviewers: ['alex'] }), mergeRequest(4, 'Red one', 'Sam', { status: 'ci_must_pass', reviewers: ['alex'] })]
        if (endpoint.includes('scope=reviews_for_me')) return reviewing
        return undefined
      },
    })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('[!3]acme/apiready✓2/1')
    expect(text).toContain('[!4]acme/apichecks failed✓0/1')
    expect(text).toContain('[!8]acme/apito review')
    expect(text).toContain('[!9]acme/apiapproved')
    expect(text).toContain('2 open · 1 to review')
  })

  test('approvals that could not be read keep the last ones, with no toast when they come back', async ($, on) => {
    let isApprovalsDown = false
    const kept = world(on, {
      onlyServers: [],
      gitlab: endpoint => {
        if (endpoint === 'user') return { username: 'sam' }
        if (endpoint === 'projects/42/merge_requests/3/approvals') return isApprovalsDown ? undefined : { approved_by: [{ user: { username: 'alex' } }] }
        if (endpoint.includes('scope=created_by_me')) return [mergeRequest(3, 'Ready one', 'Sam', { reviewers: ['alex'] })]
        if (endpoint.includes('scope=reviews_for_me')) return []
        return undefined
      },
    })
    await $.session.start(SESSION)
    await kept.clock.advance(1)
    expect(textOf(await $.ui.render(PANE))).toContain('[!3]acme/apiready✓1/1')

    isApprovalsDown = true
    await kept.clock.advance(5 * 60_000)
    expect(textOf(await $.ui.render(PANE))).toContain('[!3]acme/apiready✓1/1')
    isApprovalsDown = false
    await kept.clock.advance(5 * 60_000)

    expect(kept.toasts.filter(text => text.includes('approved'))).toEqual([])
  })

  test('a logged-out glab is left out on auto, and said with the source set to gitlab', { options: { prSource: 'gitlab', showTickets: false } }, async ($, on) => {
    const kept = world(on, { gitlab: 'logged-out' })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    expect(textOf(await $.ui.render(PANE))).toContain('GitLab: glab is not logged in: run glab auth login')
  })

  test('the ticket list joins Jira, Linear, GitHub and GitLab, and leaves out what Linear calls done', async ($, on) => {
    const kept = world(on, {
      tickets: [jiraNode('PROJ-3', 'Fix the thing', 'In Progress', 'indeterminate')],
      linear: [
        { identifier: 'ENG-7', title: 'Onboarding copy', url: 'https://linear.app/acme/issue/ENG-7', status: 'Todo', statusType: 'unstarted' },
        { identifier: 'ENG-8', title: 'Shipped already', url: 'https://linear.app/acme/issue/ENG-8', status: 'Done', statusType: 'completed' },
      ],
      github: { data: { search: { nodes: [{ number: 12, title: 'Dark mode', url: 'https://github.com/acme/web/issues/12', repository: { nameWithOwner: 'acme/web' } }] } } },
      gitlab: endpoint => (endpoint.startsWith('issues?') ? [{ iid: 5, title: 'Flaky test', web_url: 'https://gitlab.com/acme/api/-/issues/5', references: { full: 'acme/api#5' } }] : undefined),
    })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('Tickets 4 assigned')
    expect(text).toContain('PROJ-3In Progress')
    expect(text).toContain('ENG-7Todo')
    expect(text).not.toContain('ENG-8')
    expect(text).toContain('acme/web#12open')
    expect(text).toContain('acme/api#5open')
  })

  test('with the source set to github, only gh is asked for tickets', { options: { ticketSource: 'github', showPrs: false, showReviewPrs: false } }, async ($, on) => {
    const kept = world(on, { github: { data: { search: { nodes: [] } } } })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    expect(kept.calls).toEqual([])
    expect(textOf(await $.ui.render(PANE))).toContain('Tickets 0 assigned')
  })
})

describe('setup', () => {
  const COMMANDS = [...DEFAULT_COMMANDS, 'pelyar:setup']
  const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as const
  const TURN_END = { answer: '', durationMs: 1, isAborted: false, turnId: 't-1', reason: 'answer' } as const
  const sectionIds = async ($: { prompt: { compose: (input: PromptComposeInput) => Promise<PromptComposeResult> } }) =>
    (await $.prompt.compose(COMPOSE)).sections.map(section => section.id)

  test('with nothing connected, the panel offers the setup and a press runs it', async ($, on) => {
    const kept = world(on, { commands: COMMANDS, onlyServers: [] })
    await $.session.start(SESSION)
    await kept.clock.advance(1)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })

    expect(textOf(await $.ui.render(PANE))).toContain('No PR or ticket source connected yet. Set up')
    await ui.press({ key: 'setup-btn' })
    expect(kept.ran).toEqual(['pelyar:setup'])
    await ui.unmount()
  })

  test('the ✕ hides the setup row for good', async ($, on) => {
    const kept = world(on, { commands: COMMANDS, onlyServers: [] })
    await $.session.start(SESSION)
    await kept.clock.advance(1)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })

    await ui.press({ key: 'setup-dismiss-btn' })
    expect(textOf(await $.ui.render(PANE))).not.toContain('Set up')
    await ui.unmount()
    // Kept in the store: the next session does not show it either.
    await $.session.start(SESSION)
    await kept.clock.advance(1)
    expect(textOf(await $.ui.render(PANE))).not.toContain('Set up')
  })

  test('with one source connected there is no setup row', async ($, on) => {
    const kept = world(on, { commands: COMMANDS, prs: { mine: [pullRequest(1, '[PROJ-1] mine', 'Sam', 0, 1)], reviewing: [] } })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    expect(textOf(await $.ui.render(PANE))).not.toContain('Set up')
    expect(await sectionIds($)).toEqual(['engine'])
  })

  test('Claude is asked to offer the setup in one turn only, and not after it ran', async ($, on) => {
    const kept = world(on, { commands: COMMANDS, onlyServers: [] })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    expect(await sectionIds($)).toEqual(['engine', 'pelyar:setup'])
    await $.turn.start({ text: 'hello', turnId: 't-1' })
    await $.turn.complete(TURN_END)
    expect(await sectionIds($)).toEqual(['engine'])
    // Not in the next session either; the row stays until the setup ran.
    await $.session.start(SESSION)
    await kept.clock.advance(1)
    expect(await sectionIds($)).toEqual(['engine'])
    expect(textOf(await $.ui.render(PANE))).toContain('Set up')
    await $.skill.prompt({ skill: 'pelyar:setup', text: '# Set up Pelyar' })
    expect(textOf(await $.ui.render(PANE))).not.toContain('Set up')
  })

  test('a run nothing draws (claude -p) is not asked to offer the setup', async ($, on) => {
    const kept = world(on, { commands: COMMANDS, onlyServers: [] })
    await $.session.start(SESSION)
    await kept.clock.advance(1)

    expect((await $.prompt.compose({ ...COMPOSE, surfaces: [] })).sections.map(section => section.id)).toEqual(['engine'])
  })

  test('/pelyar setup starts the setup skill', async ($, on) => {
    const kept = world(on, { commands: COMMANDS })
    await $.session.start(SESSION)

    await $.command.run({ command: 'pelyar', args: 'setup', ...RUN })
    await kept.clock.advance(1)
    expect(kept.toasts).toEqual([])
    expect(kept.ran).toContain('pelyar:setup')
  })
})

describe('effort', () => {
  test('the effort comes from the effort setting, not from another row with effort in its name', async ($, on) => {
    world(on, { effort: 'high' })
    await $.session.start(SESSION)

    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('Opus 5.5 · High')
    expect(text).not.toContain('True')
  })
})

describe('demo', () => {
  test('PELYAR_DEMO shows made-up data and reads nothing of the person: no server, no CLI, no todo file', { options: { showPrs: true } }, async ($, on) => {
    const kept = world(on, {
      env: { PELYAR_DEMO: '1' },
      branch: 'bugfix/SECRET-99-internal',
      files: { [TODO_PATH]: '- [ ] my private todo\n' },
      stored: { 'pinned-commands': ['private:command'] },
      folds: [],
    })
    await $.session.start(SESSION)
    await kept.clock.advance(1)
    const ui = await $.ui.mount({ plugin: 'pelyar', ...PANE })

    const text = textOf(await $.ui.render(PANE))
    // The demo folds as a fresh install does, whatever the person's own folds are.
    expect(text).toContain('PROJ-128 · In Review')
    expect(text).toContain('My PRs 3 open · 1 ready · 1 need attention')
    expect(text).toContain('Tickets 3 assigned')
    expect(text).toContain('Mail 2 unread')
    expect(text).toContain('Spotify 1:23/3:34')
    expect(text).toContain('2 open · 1 working')
    expect(text).toContain('Answer Alex on the cache PR')
    expect(text).not.toContain('SECRET-99')
    expect(text).not.toContain('my private todo')
    expect(text).not.toContain('Private command')
    expect(kept.calls).toEqual([])
    expect(kept.runs.filter(command => command.startsWith('gh') || command.startsWith('glab') || command.startsWith('osascript -l JavaScript'))).toEqual([])

    await ui.press({ key: 'todo-input' }).catch(() => undefined)
    await ui.input({ key: 'todo-input', text: 'leak' })
    expect(kept.files[TODO_PATH]).toBe('- [ ] my private todo\n')

    // The model chips switch nothing, and the ＋ search shows none of the person's commands.
    await ui.press({ key: 'm-sonnet-btn' })
    expect(kept.ran).toEqual([])
    expect(kept.toasts).toContain('Demo: model and effort are not switched')
    await ui.press({ key: 'pin-plus-btn' })
    await ui.input({ key: 'pin-search', text: 'private', kind: 'change' })
    expect(textOf(await $.ui.render(PANE))).toContain('nothing matches "private"')
    await ui.unmount()
  })
})

describe('ticket key in a branch name', () => {
  test('a key needs at least two digits, and the configured projects narrow it', () => {
    expect(ticketKeyOf('feature/PROJ-1234-tab-jump', [])).toBe('PROJ-1234')
    expect(ticketKeyOf('bugfix/UTF-8-paths', [])).toBeNull()
    expect(ticketKeyOf('chore/JDK-17', [])).toBe('JDK-17')
    expect(ticketKeyOf('chore/JDK-17', ['PROJ', 'WEB'])).toBeNull()
    expect(ticketKeyOf('master', [])).toBeNull()
  })
})

describe('feed errors', () => {
  const REFUSED = new Error(
    '$.mcp.call(claude.ai Atlassian, searchJiraIssuesUsingJql) refused: The server-side auto mode classifier gave no verdict for mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql',
  )

  test('a call the permission check refused says to allow the tool, not to log in', () => {
    const line = retryLineOf(REFUSED, 80_000)
    expect(line.startsWith('auto mode refused: allow the tool in /permissions (/pelyar setup), retrying in 80s')).toBe(true)
    expect(line).not.toContain('/mcp to log in')
    expect(ticketErrorOf(REFUSED)).toBe('auto mode refused: allow the tool in /permissions (/pelyar setup)')
  })

  test('any other failure still points at /mcp', () => {
    expect(retryLineOf(new Error('401 unauthorized'), 5000)).toBe('retrying in 5s, /mcp to log in: 401 unauthorized')
    expect(ticketErrorOf(new Error('403 app not installed'))).toBe('403 app not installed')
  })

  test('a tool no server has says to connect one, not to log in', () => {
    expect(retryLineOf(new MissingTool('no connected MCP server has list_recent_emails'), 5000)).toBe(
      'not connected: no connected MCP server has list_recent_emails (/pelyar setup)',
    )
  })
})
