import type { McpToolResult } from 'claude-code'

import { parseJiraIssues } from './jira'

// The ticket key a branch name carries (`feature/PROJ-1234-tab-jump`): a segment that starts with
// PROJECT-NUMBER. At least two digits, so `UTF-8` is no key; with `projects` given, only those
// projects count, so `JDK-17` is none either.
export function ticketKeyOf(branch: string, projects: readonly string[]): string | null {
  for (const match of branch.matchAll(/(?:^|[/_-])([A-Z][A-Z0-9]+)-(\d{2,})(?=$|[-_/.])/g)) {
    const project = match[1] ?? ''
    if (projects.length === 0 || projects.includes(project)) return `${project}-${match[2] ?? ''}`
  }
  return null
}

// The one issue a `key = PROJ-12` search finds, or null when it finds none.
export function issueOf(result: McpToolResult): { summary: string; status: string; category: string; url: string } | null {
  const issue = parseJiraIssues(result)[0]
  return issue === undefined ? null : { summary: issue.summary, status: issue.status, category: issue.category, url: issue.url }
}
