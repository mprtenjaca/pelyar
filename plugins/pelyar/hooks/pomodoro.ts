// Plain code, no engine calls.
import type { Pomodoro } from '../types'

// A round's lengths: focus, the short break, and the long break after every fourth focus round.
export type Lengths = { focusMs: number; breakMs: number; longBreakMs: number }
const minutes = (focus: number, rest: number, longRest: number): Lengths => ({
  focusMs: focus * 60_000,
  breakMs: rest * 60_000,
  longBreakMs: longRest * 60_000,
})
// The lengths a person can pick, by the name the setting shows.
export const LENGTHS: Record<string, Lengths> = {
  '25/5': minutes(25, 5, 15),
  '45/15': minutes(45, 15, 30),
  '50/10': minutes(50, 10, 30),
}
export const DEFAULT_LENGTHS = minutes(25, 5, 15)
export const FOCUS_ROUNDS_PER_LONG_BREAK = 4

export const IDLE: Pomodoro = { phase: 'idle', endsAt: null, pausedRemainingMs: null, completed: 0, day: '' }

export type Step = { pomodoro: Pomodoro; message: string | null }

// A macOS notification for a round's end, so it is seen outside the terminal too. The sound is
// played on its own (afplay): a notification's sound is muted whenever macOS holds the banner back
// (Focus, the app's notification settings), and the round's end should always be heard.
export const NOTIFICATION_SOUND = 'Glass'
export const soundArgv = (): string[] => ['afplay', `/System/Library/Sounds/${NOTIFICATION_SOUND}.aiff`]

// The text goes in as a JSON string literal, so no quote in it can break the script.
export function notificationArgv(message: string): string[] {
  const script =
    'const app = Application.currentApplication(); app.includeStandardAdditions = true; ' +
    `app.displayNotification(${JSON.stringify(message)}, { withTitle: 'Pomodoro' })`
  return ['osascript', '-l', 'JavaScript', '-e', script]
}

export function dayOf(now: number): string {
  const date = new Date(now)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// The store holds an earlier version's shape, or nothing; anything unreadable starts idle.
export function pomodoroFrom(value: unknown): Pomodoro {
  if (typeof value !== 'object' || value === null) return IDLE
  const phase = Reflect.get(value, 'phase')
  const endsAt = Reflect.get(value, 'endsAt')
  const pausedRemainingMs = Reflect.get(value, 'pausedRemainingMs')
  const completed = Reflect.get(value, 'completed')
  const day = Reflect.get(value, 'day')
  if (phase !== 'idle' && phase !== 'focus' && phase !== 'break') return IDLE
  return {
    phase,
    endsAt: typeof endsAt === 'number' ? endsAt : null,
    pausedRemainingMs: typeof pausedRemainingMs === 'number' ? pausedRemainingMs : null,
    completed: typeof completed === 'number' ? completed : 0,
    day: typeof day === 'string' ? day : '',
  }
}

export function isPaused(pomodoro: Pomodoro): boolean {
  return pomodoro.phase !== 'idle' && pomodoro.pausedRemainingMs !== null
}

export function remainingOf(pomodoro: Pomodoro, now: number): number {
  if (pomodoro.pausedRemainingMs !== null) return pomodoro.pausedRemainingMs
  if (pomodoro.endsAt === null) return 0
  return Math.max(0, pomodoro.endsAt - now)
}

function isLongBreak(completed: number): boolean {
  return completed > 0 && completed % FOCUS_ROUNDS_PER_LONG_BREAK === 0
}

function todayCount(pomodoro: Pomodoro, now: number): number {
  return pomodoro.day === dayOf(now) ? pomodoro.completed : 0
}

export function start(pomodoro: Pomodoro, now: number, lengths: Lengths = DEFAULT_LENGTHS): Pomodoro {
  return { phase: 'focus', endsAt: now + lengths.focusMs, pausedRemainingMs: null, completed: todayCount(pomodoro, now), day: dayOf(now) }
}

export function pause(pomodoro: Pomodoro, now: number): Pomodoro {
  if (pomodoro.phase === 'idle' || isPaused(pomodoro)) return pomodoro
  return { ...pomodoro, endsAt: null, pausedRemainingMs: remainingOf(pomodoro, now) }
}

export function resume(pomodoro: Pomodoro, now: number): Pomodoro {
  if (!isPaused(pomodoro)) return pomodoro
  return { ...pomodoro, endsAt: now + (pomodoro.pausedRemainingMs ?? 0), pausedRemainingMs: null }
}

export function stop(pomodoro: Pomodoro): Pomodoro {
  return { ...pomodoro, phase: 'idle', endsAt: null, pausedRemainingMs: null }
}

// Focus ends into a break on its own; a break ends idle, so the next focus round waits for you.
function next(pomodoro: Pomodoro, now: number, isFinished: boolean, lengths: Lengths): Step {
  if (pomodoro.phase === 'focus') {
    const completed = isFinished ? todayCount(pomodoro, now) + 1 : todayCount(pomodoro, now)
    const breakMs = isLongBreak(completed) ? lengths.longBreakMs : lengths.breakMs
    return {
      pomodoro: { phase: 'break', endsAt: now + breakMs, pausedRemainingMs: null, completed, day: dayOf(now) },
      message: isFinished ? `Focus round ${completed} done: take a ${breakMs / 60_000}-minute break` : null,
    }
  }
  if (pomodoro.phase === 'break') {
    return { pomodoro: stop(pomodoro), message: isFinished ? 'Break over: start the next focus round when ready' : null }
  }
  return { pomodoro, message: null }
}

export function skip(pomodoro: Pomodoro, now: number, lengths: Lengths = DEFAULT_LENGTHS): Pomodoro {
  return next(pomodoro, now, false, lengths).pomodoro
}

export function advance(pomodoro: Pomodoro, now: number, lengths: Lengths = DEFAULT_LENGTHS): Step {
  if (pomodoro.endsAt === null || now < pomodoro.endsAt) return { pomodoro, message: null }
  return next(pomodoro, pomodoro.endsAt, true, lengths)
}

export function clockOf(ms: number): string {
  const seconds = Math.ceil(ms / 1000)
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
