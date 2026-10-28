// The TODO list is a file the prompt band shares: `- [ ] text` lines, `- [x]` done. The band re-reads
// it every few seconds, so both show the same list; numbers count the open items in file order.
export const TODO_LINE = /^(\s*[-*]\s+\[)([ xX])(\]\s+)(.*)$/
export const TODO_MAX = 200
export type OpenTodo = { number: number; line: number; text: string }

export function openTodosOf(lines: readonly string[]): OpenTodo[] {
  const open: OpenTodo[] = []
  lines.forEach((line, index) => {
    const match = TODO_LINE.exec(line)
    if (match !== null && match[2] === ' ') open.push({ number: open.length + 1, line: index, text: match[4] ?? '' })
  })
  return open
}

// The line the drawn item stood on, if it still holds that open item; else the first open line
// with the same text (the band or /todos may have changed the file since the card was drawn).
export function locateTodo(lines: readonly string[], todo: Pick<OpenTodo, 'line' | 'text'>): number | null {
  const matches = (index: number) => {
    const match = TODO_LINE.exec(lines[index] ?? '')
    return match !== null && match[2] === ' ' && (match[4] ?? '') === todo.text
  }
  if (matches(todo.line)) return todo.line
  const index = lines.findIndex((_line, i) => matches(i))
  return index === -1 ? null : index
}
