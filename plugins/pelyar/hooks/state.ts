// The pane and the element the focus ring rests on (the status badge in the header).
export const PANE = 'pelyar'
export const FOCUS_HOME = 'focus-home'

// A "press again to confirm" stays armed this long, and the second press must come at least this
// long after the first: a double click is one gesture, not a confirmation.
export const CONFIRM_MS = 4000
export const CONFIRM_MIN_MS = 500
// How long a started command blocks a second start (the turn it starts takes over after that).
export const STARTING_MS = 3000

// The sections a press on their title folds: the whole dashboard and each of its parts (the context
// row and the pomodoro row do not fold), model and effort, Work with the todo list inside it, and Team; the
// choice is kept in the plugin store.
export const FOLDS = [
  'dashboard',
  'spotify',
  'mail',
  'prs',
  'review',
  'issues',
  'sessions',
  'model',
  'work',
  'todo',
  'team',
] as const
export type Fold = (typeof FOLDS)[number]
export const isFold = (value: unknown): value is Fold => typeof value === 'string' && (FOLDS as readonly string[]).includes(value)
// At the start everything but Model and Work is folded: the dashboard shows one summary row per part.
export const FOLDED_BY_DEFAULT: readonly Fold[] = ['spotify', 'mail', 'prs', 'review', 'issues', 'sessions', 'team']
// A new key for the new set of folds, so a list stored before the dashboard folded starts from the default.
export const FOLDED_STORE_KEY = 'folded-v2'

// The commands pinned under Work, in the plugin store, so every session shows them.
export const PINNED_STORE_KEY = 'pinned-commands'
// How many search results the ＋ shows at once; typing more narrows them.
export const PIN_RESULTS = 8

// The pomodoro round lives in the plugin store, so it survives /exit and every window shows the same.
export const POMODORO_STORE_KEY = 'pomodoro'
export const POMODORO_TICK_MS = 1000

// The last team git config named, kept in the plugin store: a repository without user.team in its
// own config still shows the team.
export const TEAM_STORE_KEY = 'team'
// How far setting Pelyar up got: 'offered' (Claude offered /pelyar:setup once), 'done' (it ran) or
// 'dismissed' (the ✕ on the panel's setup row). Unset after a fresh install.
export const SETUP_STORE_KEY = 'setup'

// The context meter's two nudges: a word at 70%, a louder one at 85% (auto-compact is close).
export const NUDGE_PERCENT = 70
export const URGENT_PERCENT = 85

// PRs, tickets and mail are read every five minutes; Spotify and the other sessions every five
// seconds while the panel is open. A failed read retries soon and backs off up to the slow poll.
// What is older than a minute is read again as the panel opens.
export const FEED_POLL_MS = 5 * 60_000
export const FAST_POLL_MS = 5000
export const FIRST_RETRY_MS = 5000
export const STALE_MS = 60_000
export const MINUTE_MS = 60_000
export const SPOTIFY_TICK_MS = 1000
// Spotify can still report the previous track right after next/prev, so it is read again.
export const SPOTIFY_SETTLE_MS = 1000

// How far ahead the calendar is read for meetings.
export const CALENDAR_DAYS = 2
