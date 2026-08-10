import { spawn } from 'node:child_process'

const INSTALL_TIMEOUT_MS = 2 * 60_000

export function isNpxInvocation(environment: NodeJS.ProcessEnv = process.env): boolean {
  return (
    environment.npm_lifecycle_event === 'npx' ||
    (environment.npm_command === 'exec' &&
      (environment.PATH ?? '').split(':').some((entry) => entry.includes('/_npx/')))
  )
}

export async function installGlobalPascalCommand(
  packageVersion: string,
  runInstaller: Installer = runNpmInstaller,
): Promise<boolean> {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  return (
    (await runInstaller(npm, [
      'install',
      '--global',
      '--ignore-scripts',
      `@pascal-app/cli@${packageVersion}`,
    ])) === 0
  )
}

export type Installer = (command: string, args: string[]) => Promise<number>

async function runNpmInstaller(command: string, args: string[]): Promise<number> {
  return new Promise<number>((resolve) => {
    const child = spawn(command, args, { stdio: 'ignore' })
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      resolve(1)
    }, INSTALL_TIMEOUT_MS)
    child.once('error', () => {
      clearTimeout(timeout)
      resolve(1)
    })
    child.once('exit', (code) => {
      clearTimeout(timeout)
      resolve(code ?? 1)
    })
  })
}
