import type { Page } from 'playwright-core'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { template as twoBedroom } from '../packages/mcp/src/templates/two-bedroom'
import { pseudoLocalize } from '../scripts/i18n'

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
  /** CSS selector limiting the audit; the screenshot always shows the whole viewport. */
  scope?: string
  viewport?: { width: number; height: number }
  data?: string[]
}

const projects = new Map<string, Promise<string>>()

/** One project per scene and audit run, named like the app's own default. */
function auditScene(base: string, key: string, graph: SceneGraph): Promise<string> {
  let project = projects.get(key)
  if (!project) {
    project = fetch(new URL('/api/scenes', base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Project #1', graph }),
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Could not create the audit project (${response.status})`)
      return ((await response.json()) as { id: string }).id
    })
    projects.set(key, project)
  }
  return project
}

export const auditProject = (base: string) =>
  auditScene(base, 'empty', { nodes: {}, rootNodeIds: [] } as unknown as SceneGraph)

export const editorPath = async (base: string) => `/project/${await auditProject(base)}`

/** A furnished project, so trees and level lists have rows to show. */
export const apartmentPath = async (base: string) =>
  `/project/${await auditScene(base, 'two-bedroom', twoBedroom)}`
const apartmentData = ['Project #1', 'Living / Kitchen', 'Bedroom 1', 'Bedroom 2', 'Bath']

async function openLevelMenu(page: Page, row = 0): Promise<void> {
  const level = page.locator('[data-surface="level-selector"] .group\\/level').nth(row)
  await level.hover()
  await level.locator('button[aria-haspopup="dialog"]').last().click()
  await page.waitForTimeout(500)
}

async function addLevelAbove(page: Page): Promise<void> {
  await page.getByTitle(pseudo('Add level above'), { exact: true }).click()
  await page.waitForTimeout(800)
}

/** Waits for the editor chrome and the 3D canvas to settle. */
export async function openEditor(page: Page): Promise<void> {
  await page.locator('canvas').first().waitFor({ timeout: 120_000 })
  await page.waitForTimeout(1500)
}

/** The accessible name a control has in en-XA, for locating it by its translated label. */
export const pseudo = (english: string) => pseudoLocalize(english)

export async function openInEditor(page: Page, name: string): Promise<void> {
  await openEditor(page)
  await page.getByRole('button', { name: pseudo(name), exact: true }).first().click()
  await page.waitForTimeout(500)
}

export const surfaces: PseudoSurface[] = [
  { name: 'home', path: '/', data: ['Project #1'] },
  { name: 'settings', path: '/settings' },
  { name: 'editor', path: editorPath, steps: openEditor, data: ['Project #1'] },
  { name: 'navbar', path: editorPath, steps: openEditor, scope: 'nav', data: ['Project #1'] },
  {
    name: 'navbar-mobile',
    path: editorPath,
    steps: openEditor,
    scope: 'nav',
    viewport: { width: 390, height: 844 },
    data: ['Project #1'],
  },
  {
    name: 'share-panel',
    path: editorPath,
    steps: async (page) => {
      await openEditor(page)
      await page.locator('nav button[aria-expanded]').click()
      await page.waitForTimeout(800)
    },
    scope: 'nav [role="dialog"]',
  },
  {
    name: 'display-menu',
    path: editorPath,
    steps: (page) => openInEditor(page, 'Display settings'),
    scope: '[role="menu"]',
  },
  {
    name: 'more-views',
    path: editorPath,
    steps: (page) => openInEditor(page, 'More views'),
    scope: '[role="menu"]',
  },
  { name: 'build-tab', path: editorPath, steps: openEditor, scope: '[data-surface="build-tab"]' },
  {
    name: 'tool-dock',
    path: editorPath,
    steps: openEditor,
    scope: '[data-surface="tool-dock"]',
  },
  {
    name: 'camera-hint',
    path: editorPath,
    steps: openEditor,
    scope: `section[aria-label="${pseudoLocalize('Camera controls hint')}"]`,
  },
  {
    name: 'wall-tool-hud',
    path: editorPath,
    steps: async (page) => {
      await openEditor(page)
      await page.locator('[data-build-tool="room-rectangle"]').click()
      await page.mouse.move(900, 500)
      await page.waitForTimeout(800)
    },
    scope: '[data-hud-card]',
  },
  {
    name: 'door-tool-hud',
    path: editorPath,
    steps: async (page) => {
      await openEditor(page)
      await page.locator('[data-build-tool="door"]').click()
      await page.mouse.move(900, 500)
      await page.waitForTimeout(800)
    },
    scope: '[data-hud-card]',
  },
  {
    name: 'measure-menu',
    path: editorPath,
    steps: (page) => openInEditor(page, 'Measurement options'),
    scope: '[role="menu"], [role="dialog"]',
  },
  {
    name: 'references-menu',
    path: editorPath,
    steps: (page) => openInEditor(page, 'Reference settings'),
    scope: '[role="dialog"]',
  },
  {
    name: 'mep-tools',
    path: editorPath,
    steps: async (page) => {
      await openEditor(page)
      await page.locator('section[data-build-group="advanced"] > button').click()
      await page.locator('[data-build-tool="mep"]').click()
      await page.waitForTimeout(600)
    },
    scope: '[data-surface="build-tab"]',
    // A kind registered by the external @pascal-app/plugin-streetscape, which owns its copy.
    data: ['Road'],
  },
  {
    name: 'icon-rail',
    path: apartmentPath,
    steps: async (page) => {
      await openEditor(page)
      await page.getByRole('button', { name: pseudo('Items'), exact: true }).hover()
      await page.waitForTimeout(500)
    },
    scope: '[data-surface="icon-rail"], [role="tooltip"]',
    // Panels registered by external plugin packages, which own their labels.
    data: ['Nature', 'Environment', 'WebXR', 'Pools', 'Landscape', 'Bath Space', 'Streetscape'],
  },
  {
    name: 'layers-panel',
    path: apartmentPath,
    steps: (page) => openInEditor(page, 'Scene'),
    scope: '[data-surface="site-panel"]',
    data: apartmentData,
  },
  {
    name: 'level-selector',
    path: apartmentPath,
    steps: async (page) => {
      await openEditor(page)
      await addLevelAbove(page)
    },
    scope: '[data-surface="level-selector"]',
  },
  {
    name: 'level-menu',
    path: apartmentPath,
    steps: async (page) => {
      await openEditor(page)
      await openLevelMenu(page)
    },
    scope: '[role="dialog"]',
  },
  {
    name: 'duplicate-level-dialog',
    path: apartmentPath,
    steps: async (page) => {
      await openEditor(page)
      await openLevelMenu(page)
      await page.getByRole('button', { name: pseudo('Duplicate with options...') }).click()
      await page.getByRole('heading', { name: pseudo('Duplicate Level') }).waitFor()
      // Dialogs animate in slowly under software rendering.
      await page.waitForTimeout(2500)
    },
    scope: '[role="dialog"]',
  },
  {
    name: 'delete-level-dialog',
    path: apartmentPath,
    steps: async (page) => {
      await openEditor(page)
      await addLevelAbove(page)
      await openLevelMenu(page, 0)
      await page.getByRole('button', { name: pseudo('Delete level'), exact: true }).click()
      await page.getByRole('heading', { name: pseudo('Delete level') }).waitFor()
      // Dialogs animate in slowly under software rendering.
      await page.waitForTimeout(2500)
    },
    scope: '[role="dialog"]',
  },
]
