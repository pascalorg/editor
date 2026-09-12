import { spawn } from 'node:child_process'

export function openBrowser(
  url: string,
  environment: NodeJS.ProcessEnv = process.env,
  spawnProcess: typeof spawn = spawn,
): void {
  if (environment.PASCAL_NO_OPEN === '1') return
  const { PASCAL_API_KEY: _pascalApiKey, ...browserEnvironment } = environment
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  const child = spawnProcess(command, args, {
    detached: true,
    env: browserEnvironment,
    stdio: 'ignore',
  })
  child.once('error', () => {})
  child.unref()
}
