import { spawn } from 'node:child_process'

export function openBrowser(url: string, environment: NodeJS.ProcessEnv = process.env): void {
  if (environment.PASCAL_NO_OPEN === '1') return
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  const child = spawn(command, args, { detached: true, stdio: 'ignore' })
  child.once('error', () => {})
  child.unref()
}
