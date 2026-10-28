import type { McpToolResult } from 'claude-code'

const DESCRIPTION_MAX = 180

// A command by its short name: `catchup` matches `catchup` and `<plugin>:catchup`.
export const resolveCommand = (names: readonly string[], short: string) =>
  names.find(name => name === short) ?? names.find(name => name.endsWith(`:${short}`))
export const shortNameOf = (command: string) => command.split(':').pop() ?? command

// `review-inbox` reads as "Review inbox".
export const labelOf = (name: string) => {
  const words = shortNameOf(name).replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

// A skill description can run to a thousand characters; the panel shows its first sentence or two.
export const shortDescriptionOf = (text: string) => {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= DESCRIPTION_MAX) return clean
  const cut = clean.slice(0, DESCRIPTION_MAX)
  const end = cut.lastIndexOf('. ')
  return end > 60 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`
}

// A value at a path in parsed JSON, without trusting its shape; `stringAt` gives '' for anything not a string.
export function field(value: unknown, ...path: (string | number)[]): unknown {
  let current = value
  for (const step of path) {
    if (typeof current !== 'object' || current === null) return undefined
    current = Reflect.get(current, step)
  }
  return current
}

export function stringAt(value: unknown, ...path: (string | number)[]): string {
  const found = field(value, ...path)
  return typeof found === 'string' ? found : ''
}

// The text blocks of an MCP answer, joined.
export const textOf = (result: McpToolResult) => result.content.map(block => (block.type === 'text' && typeof block.text === 'string' ? block.text : '')).join('')

export const fit = (text: string, width: number) => (text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`)
export const titleCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
export const errorTextOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

// The engine's permission check refuses a server call it cannot judge: in auto mode a call no prompt
// asked for (every dashboard read) gets no verdict unless an allow rule names its tool. Not a login
// problem, so it gets its own words; /pelyar setup adds the rules.
export const isPermissionRefusal = (text: string) => /\) refused: /.test(text) || /auto mode/i.test(text)
export const PERMISSION_HINT = 'auto mode refused: allow the tool in /permissions (/pelyar setup)'

// No server the session has offers the tool: nothing to log in to, a server to connect (/pelyar setup).
export class MissingTool extends Error {}
export const missingToolText = (tool: string) => `no connected MCP server has ${tool}`

// A feed that failed: a connector that is not logged in offers only its login tools, so every fetch
// through it fails; a refused call needs an allow rule instead; a tool no server has needs a server.
// The line names the fix before the error text, which a narrow row cuts off.
export function retryLineOf(error: unknown, delayMs: number): string {
  const text = errorTextOf(error)
  const retry = `retrying in ${Math.round(delayMs / 1000)}s`
  if (error instanceof MissingTool) return `not connected: ${text} (/pelyar setup)`
  return isPermissionRefusal(text) ? `${PERMISSION_HINT}, ${retry}: ${text}` : `${retry}, /mcp to log in: ${text}`
}

// The reason beside the branch's ticket key, which has room for a few words only.
export function ticketErrorOf(error: unknown): string {
  const text = errorTextOf(error)
  return isPermissionRefusal(text) ? PERMISSION_HINT : text.slice(0, 60)
}
