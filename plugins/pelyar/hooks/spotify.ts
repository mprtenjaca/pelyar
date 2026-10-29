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

// Windows has no osascript: Spotify is read and controlled through the system media controls
// (GlobalSystemMediaTransportControlsSessionManager, the media flyout's own source), from Windows
// PowerShell, which every Windows has. Apple Music has no Windows app, so only Spotify is asked. The
// script answers the same JSON as nowPlayingScript, and holds no double quote so it passes as one
// argument. Statements are joined with '; ' rather than newlines for the same reason.
const WINDOWS_POWERSHELL = ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']

const WINDOWS_SESSION = [
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
  "$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1",
  'function Await($op, [Type]$type) { $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); [void]$task.Wait(5000); $task.Result }',
  '$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]',
  '$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])',
  "$session = $manager.GetSessions() | Where-Object { $_.SourceAppUserModelId -like '*Spotify*' } | Select-Object -First 1",
]

// The timeline's position is as of its last update, so a playing track's time since then is added.
// Spotify leaves the artist out of the media controls; its window title reads "Artist - Title"
// while it plays.
const WINDOWS_NOW_PLAYING = [
  ...WINDOWS_SESSION,
  "if ($null -eq $session) { 'null'; exit }",
  '$status = $session.GetPlaybackInfo().PlaybackStatus.ToString()',
  "$state = if ($status -eq 'Playing') { 'playing' } elseif ($status -eq 'Paused') { 'paused' } else { 'stopped' }",
  '$media = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])',
  '$timeline = $session.GetTimelineProperties()',
  '$position = $timeline.Position.TotalSeconds',
  "if ($state -eq 'playing') { $position += ([DateTimeOffset]::Now - $timeline.LastUpdatedTime).TotalSeconds }",
  '$artist = $media.Artist',
  "if ([string]::IsNullOrEmpty($artist)) { $window = (Get-Process Spotify -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle.EndsWith(' - ' + $media.Title) } | Select-Object -First 1).MainWindowTitle; if ($window) { $artist = $window.Substring(0, $window.Length - $media.Title.Length - 3) } }",
  "[pscustomobject]@{ app = 'Spotify'; state = $state; title = $media.Title; artist = $artist; album = $media.AlbumTitle; durationMs = [math]::Round($timeline.EndTime.TotalMilliseconds); positionS = $position } | ConvertTo-Json -Compress",
].join('; ')

export const windowsNowPlayingArgv = (apps: readonly PlayerApp[]): readonly string[] =>
  [...WINDOWS_POWERSHELL, apps.includes('Spotify') ? WINDOWS_NOW_PLAYING : "'null'"]

const WINDOWS_ACTIONS: Record<Action, string> = {
  '': 'TryTogglePlayPauseAsync',
  play: 'TryPlayAsync',
  pause: 'TryPauseAsync',
  next: 'TrySkipNextAsync',
  prev: 'TrySkipPreviousAsync',
}

// Like actionArgv, it does nothing while Spotify is closed.
export const windowsActionArgv = (action: Action): readonly string[] => [
  ...WINDOWS_POWERSHELL,
  [...WINDOWS_SESSION, 'if ($null -eq $session) { exit }', `$null = Await ($session.${WINDOWS_ACTIONS[action]}()) ([bool])`].join('; '),
]

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
