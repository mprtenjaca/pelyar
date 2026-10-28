import type { CommandInfo } from 'claude-code'

import { shortNameOf } from './util'

// Where a team's skills come from: the plugin `<prefix><team>` (the Team plugin prefix setting, `team-`
// by default), installed from any marketplace. Skills linked into ~/.claude/skills by hand are not read:
// they are personal, or a team repo's working copy of what the plugin ships.
export const DEFAULT_TEAM_PREFIX = 'team-'
export const INSTALLED_PLUGINS = '.claude/plugins/installed_plugins.json'

// "Platform Tools" is the plugin `team-platform-tools`.
export const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

export const teamPluginOf = (teamName: string, prefix: string) => `${prefix}${slugOf(teamName)}`

// The other way round, for a name nothing else gives: `team-platform-tools` reads "Platform Tools".
// Approximate where the real name has punctuation ("Design & Research").
export const teamNameOfPlugin = (plugin: string, prefix: string) =>
  plugin
    .slice(prefix.length)
    .split('-')
    .filter(word => word !== '')
    .map(word => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ')

// The team plugins installed, from whatever marketplace, each with the folder it was installed into
// and the marketplace, read from installed_plugins.json
// (`{ version: 2, plugins: { "<plugin>@<marketplace>": [{ installPath }] } }`).
export type InstalledPlugin = { path: string; marketplace: string }
export function installedTeamPluginsOf(json: string, prefix: string): Map<string, InstalledPlugin> {
  const found = new Map<string, InstalledPlugin>()
  try {
    const plugins: unknown = Reflect.get(Object(JSON.parse(json)), 'plugins')
    for (const [key, records] of Object.entries(Object(plugins) as Record<string, unknown>)) {
      const [plugin, from] = key.split('@')
      if (plugin === undefined || from === undefined || !plugin.startsWith(prefix)) continue
      const path: unknown = Array.isArray(records) ? Reflect.get(Object(records[0]), 'installPath') : undefined
      if (typeof path === 'string' && path !== '') found.set(plugin, { path, marketplace: from })
    }
  } catch {
    // An unreadable file leaves the plugins to the session's command list alone.
  }
  return found
}

export type TeamCommand = { info: CommandInfo; plugin: string }

// The plugin a command belongs to: the engine says so, or the name carries it (`<plugin>:<skill>`).
const pluginOfCommand = (command: CommandInfo): string | null =>
  command.plugin?.split('@')[0] ?? (command.source === 'plugin' && command.name.includes(':') ? (command.name.split(':')[0] ?? null) : null)

// The team plugins the session's commands come from (`<prefix><team>`), whatever marketplace.
export const teamPluginsOf = (commands: readonly CommandInfo[], prefix: string): string[] => [
  ...new Set(commands.map(pluginOfCommand).filter((plugin): plugin is string => plugin !== null && plugin.startsWith(prefix))),
]

export function teamCommandsOf(commands: readonly CommandInfo[], taken: ReadonlySet<string>, teamName: string | null, prefix: string): TeamCommand[] {
  // With a team set, only that team's plugin; without one, any team plugin.
  const wanted = teamName === null ? null : teamPluginOf(teamName, prefix)
  return commands
    .flatMap(info => {
      const plugin = pluginOfCommand(info)
      if (plugin === null || !(wanted === null ? plugin.startsWith(prefix) : plugin === wanted)) return []
      return [{ info, plugin }]
    })
    .filter(command => !taken.has(command.info.name))
    .sort((a, b) => shortNameOf(a.info.name).localeCompare(shortNameOf(b.info.name)))
}
