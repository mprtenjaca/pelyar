// Plain code, no engine calls. Made-up data the panel shows with PELYAR_DEMO=1 instead of reading any
// source: for screenshots, and to see the panel before anything is connected. Nothing here is real.
import type { ClaudeSession, IssueFeed, MailFeed, NowPlaying, PullRequest, PullRequestFeed, Ticket } from '../types'

export const isDemoValue = (value: string | undefined) => value !== undefined && value !== '' && value !== '0' && value !== 'false'

const MINUTE = 60_000

function pr(id: number, repo: string, title: string, author: string, fields: Partial<PullRequest> = {}): PullRequest {
  return {
    key: `github:${repo}#${id}`,
    source: 'github',
    id,
    repo,
    title,
    url: `https://github.com/${repo}/pull/${id}`,
    author,
    authorSlug: author.toLowerCase().split(' ')[0] ?? '',
    latestCommit: `c${id}`,
    reviews: [],
    approvals: 0,
    reviewers: 2,
    isNeedsWork: false,
    isConflicted: false,
    isDraft: false,
    isMergeable: false,
    openTasks: 0,
    qualityGate: '',
    ...fields,
  }
}

export function demoPrs(now: number): PullRequestFeed {
  return {
    mine: [
      pr(128, 'acme/web', '[PROJ-128] Dark mode for the settings page', 'Sam Lee', { approvals: 2, reviewers: 2 }),
      pr(131, 'acme/api', '[PROJ-131] Rate limit the export endpoint', 'Sam Lee', { approvals: 1, qualityGate: 'FAILED' }),
      pr(133, 'acme/web', '[PROJ-133] Keyboard shortcuts', 'Sam Lee', { isDraft: true }),
    ],
    reviewing: [
      pr(127, 'acme/api', '[PROJ-127] Cache the price list', 'Alex Kim', { reviews: [{ slug: 'sam', status: 'UNAPPROVED', lastReviewedCommit: '' }] }),
      pr(42, 'acme/docs', 'Getting started guide', 'Robin Diaz', { reviews: [{ slug: 'sam', status: 'APPROVED', lastReviewedCommit: 'c42' }] }),
    ],
    me: { github: 'sam' },
    sources: ['github'],
    fetchedAt: now,
  }
}

export function demoIssues(now: number): IssueFeed {
  const issue = (key: string, summary: string, status: string, category: string) => ({
    source: 'jira' as const,
    key,
    summary,
    status,
    category,
    url: `https://example.atlassian.net/browse/${key}`,
  })
  return {
    issues: [
      issue('PROJ-128', 'Dark mode for the settings page', 'In Review', 'indeterminate'),
      issue('PROJ-131', 'Rate limit the export endpoint', 'In Progress', 'indeterminate'),
      issue('PROJ-140', 'Onboarding checklist', 'To Do', 'new'),
    ],
    sources: ['jira'],
    fetchedAt: now,
  }
}

export function demoMail(now: number): MailFeed {
  return {
    unread: [
      { id: 'm1', from: 'Alex Kim', subject: 'Re: price list cache' },
      { id: 'm2', from: 'Robin Diaz', subject: 'Docs review on Thursday?' },
    ],
    meetings: [
      { subject: 'Daily stand-up', start: now + 12 * MINUTE, end: now + 27 * MINUTE, isUnanswered: false },
      { subject: 'Sprint review', start: now + 26 * 60 * MINUTE, end: now + 27 * 60 * MINUTE, isUnanswered: true },
    ],
    fetchedAt: now,
  }
}

export function demoPlayer(now: number): NowPlaying {
  return { state: 'playing', app: 'Spotify', title: 'Adriatic Morning', artist: 'The Harbour Pilots', positionMs: 83_000, durationMs: 214_000, fetchedAt: now }
}

export function demoSessions(now: number): ClaudeSession[] {
  const session = (pid: number, name: string, status: string, sinceMinutes: number) => ({
    pid,
    sessionId: `demo-${pid}`,
    name,
    cwd: `/work/${name}`,
    kind: 'interactive',
    status,
    statusSince: now - sinceMinutes * MINUTE,
    startedAt: now - 90 * MINUTE,
    procStart: '',
  })
  return [session(4101, 'api', 'busy', 3), session(4102, 'docs', 'idle', 25)]
}

export const DEMO_TICKET: Ticket = {
  branch: 'feature/PROJ-128-dark-mode',
  repo: 'web',
  key: 'PROJ-128',
  summary: 'Dark mode for the settings page',
  status: 'In Review',
  category: 'indeterminate',
  url: 'https://example.atlassian.net/browse/PROJ-128',
  error: null,
}

export const DEMO_TODOS = ['- [ ] Answer Alex on the cache PR', '- [ ] Write the release notes', '- [x] Book the sprint review room']
