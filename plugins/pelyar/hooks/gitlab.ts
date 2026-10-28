// Plain code, no engine calls. GitLab through `glab api` (REST v4): the merge requests I opened, the
// ones I review, and who approved them, which the lists do not say by themselves.
import type { PullRequest, Review } from '../types'
import { field, stringAt } from './util'

// `glab api <endpoint>`, on another host when one is set (else the one glab is logged in to).
export function glabArgv(host: string, endpoint: string): string[] {
  return ['glab', 'api', ...(host === '' ? [] : ['--hostname', host]), endpoint]
}

// The most merge requests a list holds: a list this long may have left some out.
export const GITLAB_PAGE = 25
const OPEN = `state=opened&per_page=${GITLAB_PAGE}`
export const GITLAB_USER = 'user'
export const GITLAB_MINE = `merge_requests?scope=created_by_me&${OPEN}`
export const GITLAB_REVIEWING = `merge_requests?scope=reviews_for_me&${OPEN}`
// Who approved one merge request, asked for each: the lists leave approvals out, and the filter by
// approver (`approved_by_usernames`) is a paid feature that GitLab Free ignores.
export const gitlabApprovals = (projectId: number, iid: number) => `projects/${projectId}/merge_requests/${iid}/approvals`

// The approvals answer: `{ approved_by: [{ user: { username } }] }`.
export function approversOf(stdout: string): Set<string> {
  const list = field(JSON.parse(stdout), 'approved_by')
  return new Set((Array.isArray(list) ? list : []).map(item => stringAt(item, 'user', 'username')).filter(name => name !== ''))
}

// Who approved which merge request, by its global id. A merge request missing here has no approvals known.
export type Approvals = ReadonlyMap<number, ReadonlySet<string>>

// glab says so when nobody is logged in (or the token is gone): "not set up here", not a failure.
export const isGlabLoggedOut = (stderr: string) => /auth login|401|unauthorized|no token|not authenticated|not logged in/i.test(stderr)

export function usernameOf(stdout: string): string | null {
  const name = stringAt(JSON.parse(stdout), 'username')
  return name === '' ? null : name
}

// detailed_merge_status values that mean the pipeline or the status checks stand in the way.
const CHECKS_FAILED = new Set(['ci_must_pass', 'status_checks_must_pass', 'security_policy_pipeline_check'])

function mergeRequestOf(value: unknown, approvals: Approvals): PullRequest | null {
  const iid = field(value, 'iid')
  const globalId = field(value, 'id')
  if (typeof iid !== 'number') return null
  const approvers = typeof globalId === 'number' ? (approvals.get(globalId) ?? new Set<string>()) : new Set<string>()
  const repo = repoOf(value)
  const sha = stringAt(value, 'sha')
  const status = stringAt(value, 'detailed_merge_status')
  const reviewers = field(value, 'reviewers')
  const reviews: Review[] = (Array.isArray(reviewers) ? reviewers : []).map(reviewer => {
    const slug = stringAt(reviewer, 'username')
    // An approval read now is on the merge request's current commit, so it is not stale.
    const isApproved = slug !== '' && approvers.has(slug)
    return { slug, status: isApproved ? 'APPROVED' : 'UNAPPROVED', lastReviewedCommit: isApproved ? sha : '' }
  })
  return {
    key: keyOf(repo, iid),
    source: 'gitlab',
    id: iid,
    repo,
    title: stringAt(value, 'title'),
    url: stringAt(value, 'web_url'),
    author: stringAt(value, 'author', 'name') || stringAt(value, 'author', 'username'),
    authorSlug: stringAt(value, 'author', 'username'),
    latestCommit: sha,
    reviews,
    // Anyone eligible may approve, a reviewer or not.
    approvals: approvers.size,
    reviewers: reviews.length,
    isNeedsWork: status === 'requested_changes',
    isConflicted: field(value, 'has_conflicts') === true || status === 'conflict',
    isDraft: field(value, 'draft') === true,
    isMergeable: status === 'mergeable',
    openTasks: 0,
    qualityGate: CHECKS_FAILED.has(status) ? 'FAILED' : '',
  }
}

export function parseMergeRequests(stdout: string, approvals: Approvals = new Map()): PullRequest[] {
  return listOf(stdout).map(item => mergeRequestOf(item, approvals)).filter((pr): pr is PullRequest => pr !== null)
}

function listOf(stdout: string): unknown[] {
  const parsed: unknown = JSON.parse(stdout)
  if (!Array.isArray(parsed)) throw new Error(stringAt(parsed, 'message') || stringAt(parsed, 'error') || 'unexpected GitLab answer: no list')
  return parsed
}

// `group/project!12` names the project the merge request lives in.
const repoOf = (value: unknown) => stringAt(value, 'references', 'full').replace(/!\d+$/, '')
const keyOf = (repo: string, iid: number) => `gitlab:${repo}#${iid}`

// Where each merge request of a list lives, to ask for its approvals: its key as the panel has it,
// global id, project id, iid.
export function approvalTargetsOf(stdout: string): { key: string; id: number; projectId: number; iid: number }[] {
  return listOf(stdout).flatMap(item => {
    const [id, projectId, iid] = [field(item, 'id'), field(item, 'project_id'), field(item, 'iid')]
    return typeof id === 'number' && typeof projectId === 'number' && typeof iid === 'number' ? [{ key: keyOf(repoOf(item), iid), id, projectId, iid }] : []
  })
}

export const countOf = (stdout: string) => listOf(stdout).length

