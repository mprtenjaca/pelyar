// The terminal's own background, so each window gets the panel shade that suits it rather than one
// Theme for every open session. Apple Terminal is asked for the background of this session's tab,
// found by its tty from the process tree; a terminal that sets COLORFGBG says it there; any other
// leaves it to the Theme row of /config. Plain code: the asking itself happens in register.tsx.

// Prints the tty of the nearest parent process that has one (`ttys004`); exits 1 when none does.
export const TTY_SCRIPT =
  'p=$PPID; while [ -n "$p" ] && [ "$p" -gt 1 ]; do t=$(ps -o tty= -p "$p" | tr -d " "); ' +
  'case "$t" in ""|"??") ;; *) echo "$t"; exit 0;; esac; p=$(ps -o ppid= -p "$p" | tr -d " "); done; exit 1'

// The argv that asks Terminal for the background of the tab on `tty` (`/dev/ttys004`): `r,g,b`.
export function backgroundArgv(tty: string): string[] {
  const script = [
    'on run argv',
    'tell application "Terminal"',
    'repeat with w in windows',
    'repeat with t in tabs of w',
    'if tty of t is (item 1 of argv) then',
    'set bg to background color of current settings of t',
    'return ((item 1 of bg) as string) & "," & ((item 2 of bg) as string) & "," & ((item 3 of bg) as string)',
    'end if',
    'end repeat',
    'end repeat',
    'end tell',
    'return ""',
    'end run',
  ]
  return ['osascript', ...script.flatMap(line => ['-e', line]), tty]
}

// `r,g,b` in 0..65535, as Terminal gives it: light when its luminance is past the middle.
export function isLightBackground(rgb: string): boolean | null {
  const parts = rgb.trim().split(',').map(Number)
  if (parts.length !== 3 || parts.some(part => !Number.isFinite(part))) return null
  const [r = 0, g = 0, b = 0] = parts
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 65535 > 0.5
}

// COLORFGBG is `fg;bg` (sometimes `fg;x;bg`) in the 16 ANSI colours: 7 and 15 are the light backgrounds.
export function isLightColorFgBg(value: string | null | undefined): boolean | null {
  const background = Number(value?.split(';').at(-1))
  return value === undefined || value === null || value === '' || !Number.isInteger(background) ? null : background === 7 || background === 15
}
