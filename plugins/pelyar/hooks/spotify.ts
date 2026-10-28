// Plain code, no engine calls.
import type { ProcessRunResult } from 'claude-code'

import type { NowPlaying } from '../types'

// The music apps the panel reads: Spotify and Apple Music (the app is called Music). Both answer the
// same scripting calls; only the track length differs, milliseconds in Spotify, seconds in Music.
export type PlayerApp = 'Spotify' | 'Music'
export const PLAYER_APPS: Record<string, readonly PlayerApp[]> = {
  auto: ['Spotify', 'Music'],
  spotify: ['Spotify'],
  music: ['Music'],
}
export const appLabelOf = (app: string) => (app === 'Music' ? 'Apple Music' : app === 'Spotify' ? 'Spotify' : 'Music')

// JavaScript for Automation rather than AppleScript: it answers JSON (AppleScript prints the
// position with the locale's decimal comma), and `running()` checks without starting an app. Of the
// apps asked, the one playing wins, then a paused one, then any that runs; an app that is not
// installed counts as not running.
const nowPlayingScript = (apps: readonly PlayerApp[]) => `
function read(name) {
  let app
  try {
    app = Application(name)
    if (!app.running()) return null
  } catch (error) {
    return null
  }
  const state = app.playerState()
  if (state !== 'playing' && state !== 'paused') return { app: name, state: 'stopped' }
  const track = app.currentTrack
  const field = get => { try { return get() } catch (error) { return null } }
  const length = field(() => track.duration())
  return {
    app: name,
    state,
    title: field(() => track.name()),
    artist: field(() => track.artist()),
    album: field(() => track.album()),
    durationMs: length === null ? 0 : name === 'Music' ? length * 1000 : length,
    positionS: field(() => app.playerPosition()),
  }
}
const found = ${JSON.stringify(apps)}.map(read).filter(item => item !== null)
JSON.stringify(found.find(item => item.state === 'playing') ?? found.find(item => item.state === 'paused') ?? found[0] ?? null)`

export const nowPlayingArgv = (apps: readonly PlayerApp[]): readonly string[] => ['osascript', '-l', 'JavaScript', '-e', nowPlayingScript(apps)]

export const ACTIONS = {
  '': 'playpause',
  play: 'play',
  pause: 'pause',
  next: 'nextTrack',
  prev: 'previousTrack',
} as const

export type Action = keyof typeof ACTIONS

// A control goes to the app the track was read from, and never starts it; it does nothing while the
// app is closed.
export function actionArgv(action: Action, app: string): readonly string[] {
  const name = app === 'Music' ? 'Music' : 'Spotify'
  return ['osascript', '-l', 'JavaScript', '-e', `const app = Application('${name}'); if (app.running()) app.${ACTIONS[action]}()`]
}

const NOT_AUTHORIZED = '-1743'

export function errorOf(result: ProcessRunResult): Error {
  const text = result.stderr.trim()
  if (text.includes(NOT_AUTHORIZED)) {
    return new Error('macOS blocks control of the music app: allow it in System Settings > Privacy & Security > Automation')
  }
  return new Error(text.replace(/^execution error: (Error: )*/, '') || `osascript exited with ${result.exitCode}`)
}

function numberOf(value: unknown, key: string): number {
  const found = Reflect.get(Object(value), key)
  return typeof found === 'number' && Number.isFinite(found) ? found : 0
}

function stringOf(value: unknown, key: string): string {
  const found = Reflect.get(Object(value), key)
  return typeof found === 'string' ? found : ''
}

// A podcast episode has no artist; its show is the album.
export function parseNowPlaying(result: ProcessRunResult, fetchedAt: number): NowPlaying {
  if (result.exitCode !== 0) throw errorOf(result)
  const value: unknown = JSON.parse(result.stdout)
  const idle = { title: '', artist: '', positionMs: 0, durationMs: 0, fetchedAt }
  if (value === null) return { state: 'off', app: '', ...idle }
  const app = stringOf(value, 'app') || 'Spotify'
  const state = stringOf(value, 'state')
  if (state !== 'playing' && state !== 'paused') return { state: 'stopped', app, ...idle }
  return {
    state,
    app,
    title: stringOf(value, 'title'),
    artist: stringOf(value, 'artist') || stringOf(value, 'album'),
    positionMs: Math.round(numberOf(value, 'positionS') * 1000),
    durationMs: numberOf(value, 'durationMs'),
    fetchedAt,
  }
}

export function isLoaded(player: NowPlaying): boolean {
  return player.state === 'playing' || player.state === 'paused'
}

// Spotify is read every few seconds; in between, a playing track's position runs on the clock.
export function positionAt(player: NowPlaying, now: number): number {
  if (player.state !== 'playing') return player.positionMs
  const position = player.positionMs + Math.max(0, now - player.fetchedAt)
  return player.durationMs > 0 ? Math.min(position, player.durationMs) : position
}

// 3:07 under an hour, 1:26:55 from an hour on.
export function timeOf(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = String(seconds % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}

export function progressOf(player: NowPlaying, now: number): string {
  return `${timeOf(positionAt(player, now))}/${timeOf(player.durationMs)}`
}

export function trackOf(player: NowPlaying): string {
  return player.artist === '' ? player.title : `${player.title} · ${player.artist}`
}
