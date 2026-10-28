import type { Effort } from '../types'

export const COMMAND = 'pelyar'

// The models the chips offer. A new model release needs a line here; the label shows in the header.
export const MODELS: readonly { arg: string; label: string; id: string; hotkey: string }[] = [
  { arg: 'haiku', label: 'Haiku 5.5', id: 'claude-haiku-5-5', hotkey: '1' },
  { arg: 'sonnet', label: 'Sonnet 5.5', id: 'claude-sonnet-5-5', hotkey: '2' },
  { arg: 'opus', label: 'Opus 5.5', id: 'claude-opus-5-5', hotkey: '3' },
  { arg: 'claude-fable-5-1', label: 'Fable 5.1', id: 'claude-fable-5-1', hotkey: '4' },
]
export const EFFORTS: readonly { level: Effort; label: string; hotkey: string }[] = [
  { level: 'low', label: 'Low', hotkey: '5' },
  { level: 'medium', label: 'Medium', hotkey: '6' },
  { level: 'high', label: 'High', hotkey: '7' },
  { level: 'xhigh', label: 'XHigh', hotkey: '8' },
  { level: 'max', label: 'Max', hotkey: '9' },
]

// A command the panel can start. A press on its row unfolds it: what it does, a field for the
// arguments, and a run button. `candidates` are short names in order; the first one the session
// has is used, and an entry with none is left out.
export type Entry = {
  key: string
  label: string
  note: string
  candidates: readonly string[]
  argHint: string
  // A test the arguments must pass, with what to say when they do not; set where the command
  // cannot run without them.
  requires?: { test: RegExp; message: string }
}
// For everyone, whatever the team. The built-in review commands; anything else is pinned with the ＋.
export const GENERAL: readonly Entry[] = [
  {
    key: 'review',
    label: 'Review changes',
    note: 'the current diff',
    candidates: ['code-review'],
    argHint: 'empty: the current diff · or a branch, a path, an effort level',
  },
  {
    key: 'review-pr',
    label: 'Review a PR',
    note: 'a pull request by link or number',
    candidates: ['code-review'],
    argHint: 'the PR link, owner/repo#123, group/project!12, or the number',
    requires: {
      // A GitHub, GitLab or Bitbucket link; owner/repo#123, group/sub/project!12 (GitLab nests groups),
      // PROJECT/repo/ID; or a bare number.
      test: /(^https?:\/\/\S*\/(pull-requests|pull|merge_requests)\/\d+)|(^[\w~.-]+(\/[\w.-]+)+(#|!|\/)\d+$)|(^[#!]?\d+$)/,
      message: 'Expected a pull or merge request link, owner/repo#123, group/project!12 or a number',
    },
  },
  {
    key: 'security',
    label: 'Security review',
    note: 'the pending changes',
    candidates: ['security-review'],
    argHint: 'empty: the pending changes on this branch',
  },
]
// Kept apart at the bottom: each starts a long procedure or drops the conversation. Catchup and Wrapup
// run Pelyar's own skills first, then any command of that name; the settings can name another one.
export const OWN_CATCHUP = 'pelyar:catchup'
export const OWN_WRAPUP = 'pelyar:wrapup'
// Finds what this machine has, asks what the person wants and connects the rest (skills/setup).
export const OWN_SETUP = 'pelyar:setup'
export type SessionRow = { key: string; glyph: string; color: string; label: string; note: string; candidates: readonly string[] }
export const SESSION: readonly SessionRow[] = [
  { key: 'catchup', glyph: '▶', color: 'success', label: 'Catchup', note: 'load the context', candidates: [OWN_CATCHUP, 'catchup'] },
  { key: 'wrapup', glyph: '■', color: 'claude', label: 'Wrapup', note: 'save the session', candidates: [OWN_WRAPUP, 'wrapup'] },
  { key: 'clear', glyph: '⌫', color: 'error', label: 'Clear', note: 'drop the conversation', candidates: ['clear'] },
]
