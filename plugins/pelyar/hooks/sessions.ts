// Plain code, no engine calls.
import type { ProcessRunResult } from 'claude-code'

import type { ClaudeSession } from '../types'

// Claude Code keeps one `<pid>.json` per running session in its config dir's `sessions` folder,
// with the session's name, working directory and whether it is busy or idle. The `<pid>.*.key`
// files beside them hold secrets and are never read.
export const SESSION_FILE = /^\d+\.json$/

// `procStart` is written as `ps -o lstart=` spells it in UTC and the C locale, so asking the same
// way gives a string to compare: a live pid with another start time is a new process that took
// over a crashed session's pid.
export const PS_ENV = { TZ: 'UTC', LC_ALL: 'C' } as const

export function psArgv(pids: readonly number[]): readonly string[] {
  return ['ps', '-o', 'pid=,lstart=', '-p', pids.join(',')]
}

export type SessionState = { label: string; color: 'green' | 'yellow' | undefined }

function numberOf(value: unknown, key: string): number {
  const found = Reflect.get(Object(value), key)
  return typeof found === 'number' && Number.isFinite(found) ? found : 0
}

function stringOf(value: unknown, key: string): string {
  const found = Reflect.get(Object(value), key)
  return typeof found === 'string' ? found : ''
}

function spacedOf(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

// A file caught mid-write, or of another shape, is skipped rather than shown.
export function parseSessionFile(text: string): ClaudeSession | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  const pid = numberOf(value, 'pid')
  const sessionId = stringOf(value, 'sessionId')
  if (pid <= 0 || sessionId === '') return null
  const cwd = stringOf(value, 'cwd')
  const startedAt = numberOf(value, 'startedAt')
  return {
    pid,
    sessionId,
    name: stringOf(value, 'name') || cwd.split('/').at(-1) || String(pid),
    cwd,
    kind: stringOf(value, 'kind'),
    status: stringOf(value, 'status'),
    statusSince: numberOf(value, 'statusUpdatedAt') || numberOf(value, 'updatedAt') || startedAt,
    startedAt,
    procStart: spacedOf(stringOf(value, 'procStart')),
  }
}

// `ps` exits 1 with no output when none of the pids runs.
export function startsOf(result: ProcessRunResult): Map<number, string> {
  if (result.exitCode !== 0 && result.stderr.trim() !== '') throw new Error(result.stderr.trim())
  const starts = new Map<number, string>()
  for (const line of result.stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line)
    if (match !== null) starts.set(Number(match[1]), spacedOf(match[2] ?? ''))
  }
  return starts
}

export function isWorking(session: ClaudeSession): boolean {
  return session.status === 'busy'
}

// The sessions still running, this one left out; working ones first, each group in start order.
export function liveSessions(sessions: readonly ClaudeSession[], starts: ReadonlyMap<number, string>, selfId: string): ClaudeSession[] {
  return sessions
    .filter(session => session.sessionId !== selfId && starts.has(session.pid))
    .filter(session => session.procStart === '' || starts.get(session.pid) === session.procStart)
    .sort((a, b) => Number(isWorking(b)) - Number(isWorking(a)) || a.startedAt - b.startedAt)
}

export function stateOf(session: ClaudeSession): SessionState {
  if (isWorking(session)) return { label: 'working', color: 'green' }
  if (session.status === 'idle') return { label: 'idle', color: undefined }
  return { label: session.status || 'unknown', color: 'yellow' }
}

// A toast for each session that was working at the last read and no longer is, with how long the
// work took; a session that exited is not reported. A turn that starts and ends between two reads
// is not seen.
export function finishedBetween(before: readonly ClaudeSession[], after: readonly ClaudeSession[]): string[] {
  const beforeByPid = new Map(before.map(session => [session.pid, session]))
  const finished: string[] = []
  for (const session of after) {
    const old = beforeByPid.get(session.pid)
    if (old === undefined || !isWorking(old) || isWorking(session)) continue
    const took = ageOf(session.statusSince - old.statusSince)
    finished.push(
      session.status === 'idle' ? `${session.name} finished working (${took})` : `${session.name} stopped working: ${stateOf(session).label}`,
    )
  }
  return finished
}

// How long a session has been in its state: <1m, 12m, 3h, 2d.
export function ageOf(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}
