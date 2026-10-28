// Plain code, no engine calls. The tickets of every tracker in one shape (`Issue`), and the ticket a
// branch name points to.
import type { McpToolResult } from 'claude-code'

import type { Issue } from '../types'
import { field, stringAt, textOf } from './util'

// The colours of Jira's own board, which every tracker is mapped onto: under way yellow, done green.
export type IssueStatusColor = 'yellow' | 'green' | undefined
export function statusColorOf(issue: Pick<Issue, 'category'>): IssueStatusColor {
  if (issue.category === 'indeterminate') return 'yellow'
  if (issue.category === 'done') return 'green'
  return undefined
}

export function newlyAssignedOf(before: Issue[], after: Issue[]): Issue[] {
  const seen = new Set(before.map(issue => `${issue.source}:${issue.key}`))
  return after.filter(issue => !seen.has(`${issue.source}:${issue.key}`))
}

// ---- GitHub issues, through `gh api graphql`: the open ones assigned to me.

export const GITHUB_ISSUES_QUERY = `query($q: String!) {
  search(query: $q, type: ISSUE, first: 50) { nodes { ... on Issue { number title url repository { nameWithOwner } } } }
}`

export function githubIssuesArgv(host: string): string[] {
  return ['gh', 'api', 'graphql', ...(host === '' ? [] : ['--hostname', host]), '-f', `query=${GITHUB_ISSUES_QUERY}`, '-f', 'q=is:issue is:open assignee:@me archived:false']
}

export function parseGithubIssues(stdout: string): Issue[] {
  const parsed: unknown = JSON.parse(stdout)
  const errors = field(parsed, 'errors')
  if (Array.isArray(errors) && errors.length > 0) throw new Error(stringAt(errors[0], 'message') || 'GitHub answered with an error')
  const nodes = field(parsed, 'data', 'search', 'nodes')
  return (Array.isArray(nodes) ? nodes : [])
    .filter(node => typeof field(node, 'number') === 'number')
    .map(node => ({
      source: 'github' as const,
      key: `${stringAt(node, 'repository', 'nameWithOwner')}#${String(field(node, 'number'))}`,
      summary: stringAt(node, 'title'),
      status: 'open',
      category: 'new',
      url: stringAt(node, 'url'),
    }))
}

// ---- GitLab issues, through `glab api`: the open ones assigned to me.

export const GITLAB_ISSUES = 'issues?scope=assigned_to_me&state=opened&per_page=50'

export function parseGitlabIssues(stdout: string): Issue[] {
  const parsed: unknown = JSON.parse(stdout)
  if (!Array.isArray(parsed)) throw new Error(stringAt(parsed, 'message') || 'unexpected GitLab answer: no list')
  return parsed
    .filter(item => typeof field(item, 'iid') === 'number')
    .map(item => ({
      source: 'gitlab' as const,
      // `group/project#12`.
      key: stringAt(item, 'references', 'full') || `#${String(field(item, 'iid'))}`,
      summary: stringAt(item, 'title'),
      status: 'open',
      category: 'new',
      url: stringAt(item, 'web_url'),
    }))
}

// ---- Linear, through its MCP server: `list_issues` with `assignee: "me"`. The server does not
// document the shape of its answer, so this reads what it finds: a list at the top, or under
// `issues` or `nodes`; per issue `identifier`, `title`, `url` and a status as a name or an object.

export const LINEAR_LIST_TOOL = 'list_issues'
export const LINEAR_GET_TOOL = 'get_issue'
export const LINEAR_LIST_ARGS = { assignee: 'me', limit: 50 }

// Linear's status types in Jira's categories; completed and canceled are done.
const LINEAR_CATEGORY: Record<string, string> = { started: 'indeterminate', completed: 'done', canceled: 'done' }

function linearIssueOf(node: unknown): Issue | null {
  const key = stringAt(node, 'identifier') || stringAt(node, 'id')
  if (key === '') return null
  const status = stringAt(node, 'status') || stringAt(node, 'status', 'name') || stringAt(node, 'state', 'name') || stringAt(node, 'state')
  const type = (stringAt(node, 'statusType') || stringAt(node, 'status', 'type') || stringAt(node, 'state', 'type')).toLowerCase()
  return { source: 'linear', key, summary: stringAt(node, 'title'), status, category: LINEAR_CATEGORY[type] ?? 'new', url: stringAt(node, 'url') }
}

function jsonOfLinear(result: McpToolResult): unknown {
  const text = textOf(result)
  if (result.isError) throw new Error(text || 'Linear answered with an error')
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Linear answered in a shape Pelyar does not read: ${text.slice(0, 60)}`)
  }
}

export function parseLinearIssues(result: McpToolResult): Issue[] {
  const parsed = jsonOfLinear(result)
  const list = Array.isArray(parsed) ? parsed : (field(parsed, 'issues') ?? field(parsed, 'nodes') ?? field(parsed, 'data'))
  if (!Array.isArray(list)) throw new Error('unexpected Linear answer: no list of issues')
  // The server lists done and canceled issues too; the list shows what is still open.
  return list.map(linearIssueOf).filter((issue): issue is Issue => issue !== null && issue.category !== 'done')
}

export function parseLinearIssue(result: McpToolResult): Omit<Issue, 'source' | 'key'> | null {
  const parsed = jsonOfLinear(result)
  const issue = linearIssueOf(field(parsed, 'issue') ?? parsed)
  return issue === null ? null : { summary: issue.summary, status: issue.status, category: issue.category, url: issue.url }
}

// ---- The ticket a branch name points to.

// A key (`PROJ-12`, Jira or Linear) as `ticketKeyOf` in ticket.ts finds it, or an issue number at the
// start of a segment, followed by a word (`feature/123-fix-login`, `42-typo`, `issue-7-crash`), which
// GitHub and GitLab create branches as. `release/2026-10` has no word after the number: no issue.
export function issueNumberOf(branch: string): number | null {
  const match = /(?:^|\/)(?:issue-|gh-)?(\d+)-[a-z]/i.exec(branch)
  return match === null ? null : Number(match[1])
}

// Which forge the checkout's origin is on, from its URL (`git@github.com:acme/web.git`,
// `https://gitlab.example.com/group/web`): GitHub or GitLab by host, the configured hosts included.
export function forgeOf(remoteUrl: string, hosts: { github: string; gitlab: string }): 'github' | 'gitlab' | null {
  const host = (/^[\w.+-]+:\/\/(?:[^@/]+@)?([^/:]+)/.exec(remoteUrl)?.[1] ?? /^(?:[^@]+@)?([^:/]+):/.exec(remoteUrl)?.[1] ?? '').toLowerCase()
  if (host === '') return null
  if (host === 'github.com' || (hosts.github !== '' && host === hosts.github.toLowerCase())) return 'github'
  if (host === 'gitlab.com' || (hosts.gitlab !== '' && host === hosts.gitlab.toLowerCase()) || host.includes('gitlab')) return 'gitlab'
  return null
}

// `gh api repos/{owner}/{repo}/issues/<n>` (gh fills in the checkout's repository) and
// `glab api projects/:id/issues/<n>` (glab does the same with :id).
export const githubIssueArgv = (number: number) => ['gh', 'api', `repos/{owner}/{repo}/issues/${number}`]
export const gitlabIssueEndpoint = (number: number) => `projects/:id/issues/${number}`

// A single issue as either answers it: GitHub `{ title, state: open|closed, html_url }`, GitLab
// `{ title, state: opened|closed, web_url }`.
export function parseForgeIssue(stdout: string): { summary: string; status: string; category: string; url: string } {
  const parsed: unknown = JSON.parse(stdout)
  const state = stringAt(parsed, 'state')
  const isClosed = state === 'closed'
  return {
    summary: stringAt(parsed, 'title'),
    status: isClosed ? 'closed' : 'open',
    category: isClosed ? 'done' : 'new',
    url: stringAt(parsed, 'html_url') || stringAt(parsed, 'web_url'),
  }
}
