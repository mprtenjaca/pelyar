import { DEFAULT_LENGTHS, LENGTHS as POMODORO_LENGTHS, type Lengths } from './pomodoro'
import { PLAYER_APPS, type PlayerApp } from './spotify'
import type { PrSource, TicketSource } from '../types'
import { DEFAULT_TEAM_PREFIX } from './team'

// Everything a person may need to change, read once from `/plugin configure pelyar@pelyar`.

// Where the PR and ticket lists come from: `auto` reads every source this machine has (gh or glab
// logged in, an MCP server connected), or only the one named.
export type PrSources = readonly PrSource[]
const PR_SOURCES: Record<string, PrSources> = {
  auto: ['github', 'gitlab', 'bitbucket'],
  github: ['github'],
  gitlab: ['gitlab'],
  bitbucket: ['bitbucket'],
}
export type TicketSources = readonly TicketSource[]
const TICKET_SOURCES: Record<string, TicketSources> = {
  auto: ['jira', 'linear', 'github', 'gitlab'],
  jira: ['jira'],
  linear: ['linear'],
  github: ['github'],
  gitlab: ['gitlab'],
}

export type Settings = {
  // The panel's own title; null: "Pelyar".
  title: string | null
  // A fill for the whole panel, one of the palettes below in its dark and light shade;
  // undefined keeps the engine's look.
  background: { dark: string; light: string } | undefined
  // The ticket row under the header.
  showTicket: boolean
  // The dashboard parts; each off leaves its rows out and asks nothing for them.
  showContext: boolean
  showPomodoro: boolean
  // The pomodoro's round lengths, and whether a round's end is heard (the sound and the terminal bell).
  pomodoroLengths: Lengths
  pomodoroSound: boolean
  showSpotify: boolean
  // Which music apps the player row reads: Spotify, Apple Music, or both (the one playing wins).
  musicApps: readonly PlayerApp[]
  showMail: boolean
  showPrs: boolean
  showReviewPrs: boolean
  prSources: PrSources
  // The hosts gh and glab ask; empty for github.com and gitlab.com (or the one glab is logged in to).
  githubHost: string
  gitlabHost: string
  showTickets: boolean
  ticketSources: TicketSources
  // The Atlassian site (`example.atlassian.net`); null: the first site the Atlassian server can reach.
  jiraSite: string | null
  jiraQuery: string
  showSessions: boolean
  // The tools under the dashboard, and the session buttons; each off leaves its rows out.
  showSessionCommands: boolean
  // The commands Catchup and Wrapup run; null: Pelyar's own skills. Whether Pelyar's wrapup commits.
  catchupCommand: string | null
  wrapupCommand: string | null
  wrapupCommit: boolean
  showModel: boolean
  showTodos: boolean
  showCommands: boolean
  showTeam: boolean
  // The team plugin is `<teamPrefix><team>`; the marketplace is only named in the install hint.
  teamPrefix: string
  teamMarketplace: string | null
}

// Each palette is a pair of shades: one off a dark background, one off white.
const PANEL_BACKGROUNDS: Record<string, { dark: string; light: string }> = {
  slate: { dark: '#262c36', light: '#eceff4' },
  graphite: { dark: '#2a2a2a', light: '#efefef' },
  midnight: { dark: '#1c2233', light: '#e8ecf7' },
  espresso: { dark: '#2d2723', light: '#f3eee9' },
  moss: { dark: '#232c26', light: '#ebf2ec' },
}

// Whether the person's theme is a light one (light, light-daltonized, light-ansi).
export const isLightThemeName = (value: unknown) => typeof value === 'string' && value.startsWith('light')

// Not settings: the server of each feed is the one the session has its tool on (see `callMcp`); these
// usual names are only tried after it, for a session whose tool list cannot be read.
export const USUAL_JIRA_SERVERS: readonly string[] = ['claude.ai Atlassian', 'claude.ai Atlassian Rovo', 'atlassian']
export const USUAL_MAIL_SERVERS: readonly string[] = []
export const USUAL_BITBUCKET_SERVERS: readonly string[] = ['bitbucket-dc', 'bitbucket']
export const USUAL_LINEAR_SERVERS: readonly string[] = ['claude.ai Linear', 'linear']
// The todo list, in a file other mods may share (relative to the home directory), and the tickets the
// Jira query finds by default: yours, not done.
export const TODO_FILE = '.claude/todos.md'
export const JIRA_QUERY = 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC'

// My PRs and Other PRs come from one read of each source; it runs while either is shown.
const hostOf = (value: string) => value.replace(/^https?:\/\//, '').replace(/\/+$/, '')
export const readsPrs = (settings: Settings) => settings.showPrs || settings.showReviewPrs

export function settingsOf(options: unknown): Settings {
  const get = (key: string): unknown => (typeof options === 'object' && options !== null ? Reflect.get(options, key) : undefined)
  const text = (key: string) => {
    const value = get(key)
    return typeof value === 'string' ? value.trim() : ''
  }
  const on = (key: string) => get(key) !== false
  // Off unless switched on: the parts that need a server most people do not have.
  const optIn = (key: string) => get(key) === true
  const background = text('background')
  return {
    title: text('title') === '' ? null : text('title'),
    background: PANEL_BACKGROUNDS[background],
    showTicket: on('showTicket'),
    showContext: on('showContext'),
    showPomodoro: on('showPomodoro'),
    pomodoroLengths: POMODORO_LENGTHS[text('pomodoroLength')] ?? DEFAULT_LENGTHS,
    pomodoroSound: on('pomodoroSound'),
    showSpotify: on('showSpotify'),
    musicApps: PLAYER_APPS[text('musicPlayer')] ?? PLAYER_APPS.auto ?? [],
    showMail: optIn('showMail'),
    showPrs: on('showPrs'),
    showReviewPrs: on('showReviewPrs'),
    prSources: PR_SOURCES[text('prSource')] ?? PR_SOURCES.auto ?? [],
    githubHost: hostOf(text('githubHost')),
    gitlabHost: hostOf(text('gitlabHost')),
    showTickets: on('showTickets'),
    ticketSources: TICKET_SOURCES[text('ticketSource')] ?? TICKET_SOURCES.auto ?? [],
    jiraSite: text('jiraSite') === '' ? null : hostOf(text('jiraSite')),
    jiraQuery: text('jiraQuery') === '' ? JIRA_QUERY : text('jiraQuery'),
    showSessions: on('showSessions'),
    showSessionCommands: on('showSessionCommands'),
    catchupCommand: text('catchupCommand') === '' ? null : text('catchupCommand').replace(/^\//, ''),
    wrapupCommand: text('wrapupCommand') === '' ? null : text('wrapupCommand').replace(/^\//, ''),
    wrapupCommit: on('wrapupCommit'),
    showModel: on('showModel'),
    showTodos: on('showTodos'),
    showCommands: on('showCommands'),
    showTeam: optIn('showTeam'),
    teamPrefix: text('teamPrefix') === '' ? DEFAULT_TEAM_PREFIX : text('teamPrefix'),
    teamMarketplace: text('teamMarketplace') === '' ? null : text('teamMarketplace'),
  }
}
