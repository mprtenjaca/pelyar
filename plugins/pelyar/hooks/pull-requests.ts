// Plain code, no engine calls.
import type { McpToolResult } from 'claude-code'

import type { Me, PrSource, PullRequest, Review } from '../types'
import { field, stringAt, textOf } from './util'

export type PullRequestStatus = { label: string; color: 'green' | 'yellow' | 'red' | undefined }

export type MyReview = { label: 'to review' | 're-review' | 'approved' | 'needs work' | 'not listed'; isPending: boolean }

function numberAt(value: unknown, ...path: (string | number)[]): number {
  const found = field(value, ...path)
  return typeof found === 'number' ? found : 0
}

function reviewOf(value: unknown): Review {
  return {
    slug: stringAt(value, 'user', 'slug'),
    status: stringAt(value, 'status'),
    lastReviewedCommit: stringAt(value, 'lastReviewedCommit'),
  }
}

const keyOf = (source: PrSource, repo: string, id: number) => `${source}:${repo}#${id}`

function pullRequestOf(value: unknown): PullRequest | null {
  const id = field(value, 'id')
  if (typeof id !== 'number') return null
  const reviewers = field(value, 'reviewers')
  const reviewerList = Array.isArray(reviewers) ? reviewers : []
  const repo = `${stringAt(value, 'toRef', 'repository', 'project', 'key')}/${stringAt(value, 'toRef', 'repository', 'slug')}`
  return {
    key: keyOf('bitbucket', repo, id),
    source: 'bitbucket',
    id,
    repo,
    title: stringAt(value, 'title'),
    url: stringAt(value, 'links', 'self', 0, 'href'),
    author: stringAt(value, 'author', 'user', 'displayName'),
    authorSlug: stringAt(value, 'author', 'user', 'slug'),
    latestCommit: stringAt(value, 'fromRef', 'latestCommit'),
    reviews: reviewerList.map(reviewOf),
    approvals: reviewerList.filter(reviewer => field(reviewer, 'approved') === true).length,
    reviewers: reviewerList.length,
    isNeedsWork: reviewerList.some(reviewer => field(reviewer, 'status') === 'NEEDS_WORK'),
    isConflicted: stringAt(value, 'properties', 'mergeResult', 'outcome') === 'CONFLICTED',
    isDraft: field(value, 'draft') === true,
    isMergeable: false,
    openTasks: numberAt(value, 'properties', 'openTaskCount'),
    qualityGate: stringAt(value, 'properties', 'qgStatus'),
  }
}

// The Bitbucket DC MCP answers with one text block holding `{ success, data: { values } }`.
export function parsePullRequests(result: McpToolResult): PullRequest[] {
  if (result.isError) throw new Error(textOf(result) || 'Bitbucket answered with an error')
  const text = textOf(result)
  const parsed: unknown = JSON.parse(text)
  if (field(parsed, 'success') === false) throw new Error(stringAt(parsed, 'error') || 'Bitbucket answered success: false')
  const values = field(parsed, 'data', 'values')
  if (!Array.isArray(values)) throw new Error('unexpected Bitbucket answer: no data.values')
  return values.map(pullRequestOf).filter((pr): pr is PullRequest => pr !== null)
}

// ---- GitHub, through `gh api graphql`: one query for my open PRs, the ones I am asked to review and
// the ones I reviewed already (GitHub drops a review request once the review is in).

export const GITHUB_QUERY = `query($mine: String!, $requested: String!, $reviewed: String!) {
  viewer { login }
  mine: search(query: $mine, type: ISSUE, first: 25) { nodes { ...pr } }
  requested: search(query: $requested, type: ISSUE, first: 25) { nodes { ...pr } }
  reviewed: search(query: $reviewed, type: ISSUE, first: 25) { nodes { ...pr } }
}
fragment pr on PullRequest {
  number title url isDraft mergeable reviewDecision headRefOid
  repository { nameWithOwner }
  author { login ... on User { name } }
  reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { login } } } }
  latestReviews(first: 20) { nodes { author { login } state commit { oid } } }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`

const OPEN = 'is:pr is:open archived:false'
export function githubArgv(host: string): string[] {
  return [
    'gh',
    'api',
    'graphql',
    ...(host === '' ? [] : ['--hostname', host]),
    '-f',
    `query=${GITHUB_QUERY}`,
    '-f',
    `mine=${OPEN} author:@me`,
    '-f',
    `requested=${OPEN} review-requested:@me`,
    '-f',
    `reviewed=${OPEN} reviewed-by:@me -author:@me`,
  ]
}

const listAt = (value: unknown, ...path: (string | number)[]): unknown[] => {
  const found = field(value, ...path)
  return Array.isArray(found) ? found : []
}

// GitHub's review states in Bitbucket's words, so one reading of a review serves both.
const REVIEW_STATUS: Record<string, string> = { APPROVED: 'APPROVED', CHANGES_REQUESTED: 'NEEDS_WORK' }

function githubPullRequestOf(value: unknown): PullRequest | null {
  const id = field(value, 'number')
  if (typeof id !== 'number') return null
  const repo = stringAt(value, 'repository', 'nameWithOwner')
  const reviews = new Map<string, Review>()
  for (const review of listAt(value, 'latestReviews', 'nodes')) {
    const slug = stringAt(review, 'author', 'login')
    if (slug !== '') reviews.set(slug, { slug, status: REVIEW_STATUS[stringAt(review, 'state')] ?? 'UNAPPROVED', lastReviewedCommit: stringAt(review, 'commit', 'oid') })
  }
  // Asked (again) to review: the request stands, whatever an earlier review said. The commit of that
  // review stays, so a request after new commits reads as a re-review.
  for (const request of listAt(value, 'reviewRequests', 'nodes')) {
    const slug = stringAt(request, 'requestedReviewer', 'login')
    if (slug !== '') reviews.set(slug, { slug, status: 'UNAPPROVED', lastReviewedCommit: reviews.get(slug)?.lastReviewedCommit ?? '' })
  }
  const all = [...reviews.values()]
  const checks = stringAt(value, 'commits', 'nodes', 0, 'commit', 'statusCheckRollup', 'state')
  return {
    key: keyOf('github', repo, id),
    source: 'github',
    id,
    repo,
    title: stringAt(value, 'title'),
    url: stringAt(value, 'url'),
    author: stringAt(value, 'author', 'name') || stringAt(value, 'author', 'login'),
    authorSlug: stringAt(value, 'author', 'login'),
    latestCommit: stringAt(value, 'headRefOid'),
    reviews: all,
    approvals: all.filter(review => review.status === 'APPROVED').length,
    reviewers: all.length,
    isNeedsWork: stringAt(value, 'reviewDecision') === 'CHANGES_REQUESTED',
    isConflicted: stringAt(value, 'mergeable') === 'CONFLICTING',
    isDraft: field(value, 'isDraft') === true,
    isMergeable: false,
    openTasks: 0,
    qualityGate: checks === 'FAILURE' || checks === 'ERROR' ? 'FAILED' : '',
  }
}

export type GithubPullRequests = { me: string | null; mine: PullRequest[]; reviewing: PullRequest[] }

// What `gh api graphql` printed: `{ data: { viewer, mine, requested, reviewed } }`, or `{ errors }`.
export function parseGithubPullRequests(stdout: string): GithubPullRequests {
  const parsed: unknown = JSON.parse(stdout)
  const errors = listAt(parsed, 'errors')
  if (errors.length > 0) throw new Error(stringAt(errors[0], 'message') || 'GitHub answered with an error')
  const listOf = (name: string) => listAt(parsed, 'data', name, 'nodes').map(githubPullRequestOf).filter((pr): pr is PullRequest => pr !== null)
  // A PR both requested and reviewed shows once.
  const reviewing = new Map<string, PullRequest>()
  for (const pr of [...listOf('requested'), ...listOf('reviewed')]) if (!reviewing.has(pr.key)) reviewing.set(pr.key, pr)
  const login = stringAt(parsed, 'data', 'viewer', 'login')
  return { me: login === '' ? null : login, mine: listOf('mine'), reviewing: [...reviewing.values()] }
}

export function statusOf(pr: PullRequest): PullRequestStatus {
  if (pr.isConflicted) return { label: 'conflict', color: 'red' }
  if (pr.isNeedsWork) return { label: 'needs work', color: 'red' }
  if (pr.qualityGate === 'FAILED') return { label: 'checks failed', color: 'red' }
  if (pr.openTasks > 0) return { label: `${pr.openTasks} task${pr.openTasks === 1 ? '' : 's'}`, color: 'yellow' }
  if (pr.isDraft) return { label: 'draft', color: undefined }
  if (pr.approvals > 0 || pr.isMergeable) return { label: 'ready', color: 'green' }
  return { label: 'waiting', color: undefined }
}

export function changesBetween(before: PullRequest[], after: PullRequest[]): string[] {
  const changes: string[] = []
  const afterByKey = new Map(after.map(pr => [pr.key, pr]))
  for (const old of before) {
    const now = afterByKey.get(old.key)
    const name = `${old.repo}#${old.id}`
    if (now === undefined) {
      changes.push(`${name} is no longer open (merged or declined)`)
      continue
    }
    if (now.approvals > old.approvals) changes.push(`${name} approved (${now.approvals}/${now.reviewers})`)
    if (now.isNeedsWork && !old.isNeedsWork) changes.push(`${name} marked needs work`)
    if (now.isConflicted && !old.isConflicted) changes.push(`${name} has a merge conflict`)
    if (now.qualityGate === 'FAILED' && old.qualityGate !== 'FAILED') changes.push(`${name} checks failed`)
    if (now.openTasks > old.openTasks) changes.push(`${name} has ${now.openTasks} open tasks`)
  }
  return changes
}

// What a PR on the review list asks of me (the name I go by on its source): a review I never gave, or
// one the author's new commits have made stale, is pending; an approval or a needs-work on the latest
// commit is not.
export function myReviewOf(pr: PullRequest, me: Me): MyReview {
  const mine = me[pr.source] ?? null
  const review = pr.reviews.find(one => one.slug === mine)
  if (review === undefined) return { label: 'not listed', isPending: false }
  const isStale = review.lastReviewedCommit !== '' && review.lastReviewedCommit !== pr.latestCommit
  if (review.status === 'NEEDS_WORK' && !isStale) return { label: 'needs work', isPending: false }
  if (review.status === 'APPROVED' && !isStale) return { label: 'approved', isPending: false }
  if (isStale) return { label: 're-review', isPending: true }
  return { label: 'to review', isPending: true }
}

export function sortForReview(prs: PullRequest[], me: Me): PullRequest[] {
  return [...prs].sort((a, b) => Number(myReviewOf(b, me).isPending) - Number(myReviewOf(a, me).isPending))
}

export function reviewChangesBetween(before: PullRequest[], after: PullRequest[], me: Me): string[] {
  const beforeByKey = new Map(before.map(pr => [pr.key, pr]))
  const changes: string[] = []
  for (const now of after) {
    const old = beforeByKey.get(now.key)
    const name = `${now.repo}#${now.id}`
    if (old === undefined) {
      changes.push(`Review requested: ${name} by ${now.author}`)
      continue
    }
    if (myReviewOf(now, me).label === 're-review' && myReviewOf(old, me).label !== 're-review') {
      changes.push(`${name} by ${now.author} changed since your review`)
    }
  }
  return changes
}

// The ticket key a PR is about: a bracketed one at the start of the title (`[PROJ-12] ...`), else the
// first key in the title, else the PR number (`!12` on GitLab, where merge requests are written so).
export function ticketOf(pr: PullRequest): string {
  const key = /\[([A-Z][A-Z0-9]+-\d+)\]/.exec(pr.title)?.[1] ?? /\b([A-Z][A-Z0-9]+-\d+)\b/.exec(pr.title)?.[1]
  return key ?? `${pr.source === 'gitlab' ? '!' : '#'}${pr.id}`
}
