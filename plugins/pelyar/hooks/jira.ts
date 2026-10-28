// Plain code, no engine calls.
import type { McpToolResult } from 'claude-code'

import type { Issue } from '../types'
import { field, stringAt, textOf } from './util'

// searchJiraIssuesUsingJql answers one text block of `{ issues: { nodes: [...] } }`, each node
// with `key`, `webUrl` and the requested `fields`.
export function parseJiraIssues(result: McpToolResult): Issue[] {
  const text = textOf(result)
  if (result.isError) throw new Error(text || 'Jira answered with an error')
  const nodes = field(JSON.parse(text), 'issues', 'nodes')
  if (!Array.isArray(nodes)) throw new Error('unexpected Jira answer: no issues.nodes')
  return nodes
    .map(node => ({
      source: 'jira' as const,
      key: stringAt(node, 'key'),
      summary: stringAt(node, 'fields', 'summary'),
      status: stringAt(node, 'fields', 'status', 'name'),
      category: stringAt(node, 'fields', 'status', 'statusCategory', 'key'),
      url: stringAt(node, 'webUrl'),
    }))
    .filter(issue => issue.key !== '')
}

// The Atlassian site the Jira calls go to, from getAccessibleAtlassianResources: a list of
// `{ id, url, name }`, the first one taken. Its host (`example.atlassian.net`) serves as the cloud id
// and as the host of ticket links.
export function siteOf(result: McpToolResult): string {
  const text = textOf(result)
  if (result.isError) throw new Error(text || 'Atlassian answered with an error')
  let url = ''
  try {
    const parsed: unknown = JSON.parse(text)
    const list = Array.isArray(parsed) ? parsed : field(parsed, 'resources')
    url = Array.isArray(list) ? stringAt(list[0], 'url') : ''
  } catch {
    // Not JSON: the first site link in the text, below.
  }
  if (url === '') url = /https:\/\/[\w.-]+\.atlassian\.net/.exec(text)?.[0] ?? ''
  const host = url.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (host === '') throw new Error('no Atlassian site: set the Jira site in the settings')
  return host
}
