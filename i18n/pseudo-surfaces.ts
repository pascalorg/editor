import type { Page } from 'playwright-core'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { template as twoBedroom } from '../packages/mcp/src/templates/two-bedroom'
import { pseudoLocalize } from '../scripts/i18n'
import {
  RoofNode,
  RoofSegmentNode,
  StairNode,
  StairSegmentNode,
} from '../packages/core/src/schema'

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

/** The two-bedroom template with a gable roof and a straight stair, so every inspector has a row. */
function furnishedScene() {
  const graph = structuredClone(twoBedroom) as unknown as {
    nodes: Record<string, { children?: string[] }>
  }
  const nodes = [
    RoofSegmentNode.parse({ id: 'rseg_audit', parentId: 'roof_audit', roofType: 'gable', width: 4, depth: 6 }),
    RoofNode.parse({ id: 'roof_audit', parentId: 'level_0', children: ['rseg_audit'] }),
    StairSegmentNode.parse({ id: 'sseg_audit', parentId: 'stair_audit', segmentType: 'stair', width: 1, length: 3 }),
    StairNode.parse({ id: 'stair_audit', parentId: 'level_0', children: ['sseg_audit'] }),
  ]
  for (const node of nodes) graph.nodes[node.id] = node
  graph.nodes.level_0?.children?.push('roof_audit', 'stair_audit')
  return graph as unknown as SceneGraph
}

export const furnishedPath = async (base: string) =>
  `/project/${await auditScene(base, 'furnished', furnishedScene())}`
const furnishedData = ['Project #1', 'Living / Kitchen', 'Bedroom 1', 'Bedroom 2', 'Bath']

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The rail and layer names stay English until the left-panel migration lands. */
const englishOrPseudo = (english: string) =>
  new RegExp(`^(${escapeRegExp(english)}|${escapeRegExp(pseudo(english))})$`)

/** Opens the Scene panel; the tab state persists across audit pages, and clicking the active tab collapses it. */
async function openScenePanel(page: Page): Promise<void> {
  await openEditor(page)
  const sceneTab = page.getByRole('button', { name: englishOrPseudo('Scene') }).first()
  if ((await sceneTab.getAttribute('aria-pressed')) !== 'true') await sceneTab.click()
  await page.waitForTimeout(500)
}

/** Opens the Scene panel, expands every row and selects the first row named `english`. */
async function openLayer(
  page: Page,
  english: string | RegExp,
  options: { exact?: boolean } = {},
) {
  await expandLayers(page)
  const name =
    typeof english !== 'string' || options.exact === false ? english : englishOrPseudo(english)
  await page.getByText(name, { exact: true }).first().click()
  await page.waitForTimeout(1200)
  await expandInspector(page)
}

/** Opens the Scene panel and expands every row. */
async function expandLayers(page: Page) {
  await openScenePanel(page)
  // Expand every row: the tree's chevrons are the small square buttons beside each name.
  for (let pass = 0; pass < 3; pass++) {
    for (const toggle of await page.$$('button.z-10.h-4.w-4:has(svg.lucide-chevron-right)')) {
      const open = await toggle.evaluate((b) => {
        const transform = b.querySelector('div')?.style.transform ?? 'none'
        return transform !== 'none' && !/rotate\(0/.test(transform)
      })
      if (!open) await toggle.click().catch(() => undefined)
    }
    await page.waitForTimeout(700)
  }
}

/** The inspector opens collapsed to its header on small viewports. */
async function expandInspector(page: Page): Promise<void> {
  const expand = page.getByRole('button', { name: pseudo('Expand panel'), exact: true })
  if (await expand.count()) {
    await expand.first().click()
    await page.waitForTimeout(800)
  }
}

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
    name: 'room-panel',
    path: furnishedPath,
    steps: (page) => openLayer(page, 'Living / Kitchen', { exact: false }),
    scope: '[data-editor-inspector]',
    data: furnishedData,
  },
  {
    name: 'floor-foundation-panel',
    path: furnishedPath,
    steps: async (page) => {
      await openLayer(page, 'Living / Kitchen', { exact: false })
      // The template's rooms have no floor yet: build one, then open what it sits on.
      await page.locator('[data-room-construction] [role="switch"]').first().click()
      await page.locator('[data-sits-on]').first().waitFor()
      await page.locator('[data-sits-on]').first().click()
      await page.waitForTimeout(1200)
      await expandInspector(page)
    },
    scope: '[data-editor-inspector]',
    data: furnishedData,
  },
  {
    name: 'wall-panel',
    path: furnishedPath,
    steps: (page) => openLayer(page, 'Wall'),
    scope: '[data-editor-inspector]',
    // An inspector extension registered by the external @pascal-app/plugin-landscape.
    data: [...furnishedData, 'Retaining wall'],
  },
  {
    name: 'door-panel',
    path: furnishedPath,
    steps: (page) => openLayer(page, 'Door'),
    scope: '[data-editor-inspector]',
    data: furnishedData,
  },
  {
    name: 'window-panel',
    path: furnishedPath,
    steps: (page) => openLayer(page, 'Window'),
    scope: '[data-editor-inspector]',
    data: furnishedData,
  },
  {
    name: 'roof-panel',
    path: furnishedPath,
    steps: (page) => openLayer(page, /^(Roof \(1 segment\)|\[Ŕööƒ \(1 šéĝɱéñţ\) ~+\])$/),
    scope: '[data-editor-inspector]',
    data: furnishedData,
  },
  {
    name: 'roof-segment-panel',
    path: furnishedPath,
    steps: (page) => openLayer(page, /\(4\.0[x×]6\.0/),
    scope: '[data-editor-inspector]',
    data: furnishedData,
  },
  {
    name: 'stair-panel',
    path: furnishedPath,
    steps: (page) => openLayer(page, /^(Staircase \(1 segment\)|\[Šţáîŕçášé \(1 šéĝɱéñţ\) ~+\])$/),
    scope: '[data-editor-inspector]',
    data: furnishedData,
  },
  {
    name: 'stair-segment-panel',
    path: furnishedPath,
    steps: (page) => openLayer(page, /\(1\.0[x×]3\.0/),
    scope: '[data-editor-inspector]',
    data: furnishedData,
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
    steps: openScenePanel,
    scope: '[data-surface="site-panel"]',
    data: apartmentData,
  },
  {
    name: 'layer-room-rename',
    path: apartmentPath,
    steps: async (page) => {
      await expandLayers(page)
      // The template's "Bedroom 1" shows, and edits, as the catalog name in the UI language.
      const row = page.getByText(`${pseudo('Bedroom')} 1`, { exact: true }).first()
      await row.hover()
      await row
        .locator('xpath=..')
        .getByRole('button', { name: pseudo('Rename'), exact: true })
        .click()
      await page.locator('[data-surface="site-panel"] input[type="text"]').first().waitFor()
      await page.waitForTimeout(500)
    },
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
