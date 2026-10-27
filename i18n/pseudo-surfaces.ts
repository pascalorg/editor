import type { Page } from 'playwright-core'

/**
 * The surface manifest for `bun run i18n:pseudo-audit`. Each migration PR adds
 * the surfaces it localized, with the steps that open them, so the audit keeps
 * proving them afterwards. `data` lists exact authored or generated values the
 * surface shows (project names, numbers with units) that are not UI copy.
 */
export type PseudoSurface = {
  name: string
  /** A route, or a function that prepares state and returns one. */
  path: string | ((base: string) => Promise<string>)
  steps?: (page: Page) => Promise<void>
  /** CSS selector limiting the audit and the screenshot; defaults to the page. */
  scope?: string
  viewport?: { width: number; height: number }
  data?: string[]
}

let projectId: Promise<string> | undefined

/** One empty project per audit run, named like the app's own default. */
export function auditProject(base: string): Promise<string> {
  projectId ??= fetch(new URL('/api/scenes', base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Project #1', graph: { nodes: {}, rootNodeIds: [] } }),
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Could not create the audit project (${response.status})`)
    return ((await response.json()) as { id: string }).id
  })
  return projectId
}

export const editorPath = async (base: string) => `/project/${await auditProject(base)}`

/** Waits for the editor chrome and the 3D canvas to settle. */
export async function openEditor(page: Page): Promise<void> {
  await page.locator('canvas').first().waitFor({ timeout: 120_000 })
  await page.waitForTimeout(1500)
}

export const surfaces: PseudoSurface[] = [
  { name: 'home', path: '/', data: ['Project #1'] },
  { name: 'settings', path: '/settings' },
  { name: 'editor', path: editorPath, steps: openEditor, data: ['Project #1'] },
]
