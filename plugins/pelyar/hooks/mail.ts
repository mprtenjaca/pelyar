// Plain code, no engine calls.
import type { McpToolResult } from 'claude-code'

import type { Meeting, UnreadMail } from '../types'
import { field, stringAt, textOf } from './util'

// Mail and calendar from any MCP server that has two tools of these names and answers in these shapes
// (README, Mail). Not a standard: switched off unless the person turns it on.
export const MAIL_TOOL = 'list_recent_emails'
export const CALENDAR_TOOL = 'list_calendar_events'

function jsonOf(result: McpToolResult): unknown {
  const text = textOf(result)
  if (result.isError) throw new Error(text || 'the mail server answered with an error')
  return JSON.parse(text)
}

function listOf(value: unknown, key: string): unknown[] {
  const found = field(value, key)
  return Array.isArray(found) ? found : []
}

// list_recent_emails with unread_only answers `{ result: [...] }`, newest first.
export function parseUnread(result: McpToolResult): UnreadMail[] {
  return listOf(jsonOf(result), 'result').map(mail => ({
    id: stringAt(mail, 'id'),
    from: stringAt(mail, 'from_name') || stringAt(mail, 'from'),
    subject: stringAt(mail, 'subject'),
  }))
}

// list_calendar_events answers `{ events: [...] }` with local times and no offset, which `new Date()`
// reads as local time, the machine's own zone. All-day entries and "free" markers are left out, and so
// is anything already over.
export function parseMeetings(result: McpToolResult, now: number): Meeting[] {
  return listOf(jsonOf(result), 'events')
    .filter(event => field(event, 'is_all_day') !== true && stringAt(event, 'show_as') !== 'free')
    .map(event => ({
      subject: stringAt(event, 'subject'),
      start: new Date(stringAt(event, 'start')).getTime(),
      end: new Date(stringAt(event, 'end')).getTime(),
      isUnanswered: stringAt(event, 'response') === 'notResponded',
    }))
    .filter(meeting => Number.isFinite(meeting.start) && meeting.end > now)
    .sort((a, b) => a.start - b.start)
}

export function newMailOf(before: UnreadMail[], after: UnreadMail[]): UnreadMail[] {
  const seen = new Set(before.map(mail => mail.id))
  return after.filter(mail => !seen.has(mail.id))
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function dayStart(ms: number): number {
  const date = new Date(ms)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

// "now" while it runs, "in 25m" within the hour, else "10:00" today, "Tmrw 10:00", "Mon 10:00".
export function whenOf(meeting: Meeting, now: number): string {
  if (meeting.start <= now) return 'now'
  const minutes = Math.ceil((meeting.start - now) / 60_000)
  if (minutes <= 60) return `in ${minutes}m`
  const date = new Date(meeting.start)
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  const days = Math.round((dayStart(meeting.start) - dayStart(now)) / 86_400_000)
  if (days === 0) return time
  if (days === 1) return `Tmrw ${time}`
  return `${WEEKDAYS[date.getDay()]} ${time}`
}
