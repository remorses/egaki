// Cross-platform browser opener for URLs used by CLI flows.
// Never throws: missing OS commands are handled gracefully.
import { spawnSync } from 'node:child_process'

type OpenCommand = {
  command: string
  args: string[]
}

function getOpenCommands(url: string): OpenCommand[] {
  if (process.platform === 'darwin') {
    return [{ command: 'open', args: [url] }]
  }

  if (process.platform === 'win32') {
    // `start` is a cmd builtin, so invoke through cmd.exe.
    return [{ command: 'cmd', args: ['/c', 'start', '', url] }]
  }

  return [
    { command: 'xdg-open', args: [url] },
    { command: 'gio', args: ['open', url] },
  ]
}

export function openUrlInBrowser(url: string): boolean {
  for (const candidate of getOpenCommands(url)) {
    try {
      const result = spawnSync(candidate.command, candidate.args, {
        stdio: 'ignore',
        windowsHide: true,
      })

      if (!result.error && result.status === 0) {
        return true
      }
    } catch {
      // Keep trying fallback commands. This helper must never crash the CLI.
    }
  }

  return false
}
