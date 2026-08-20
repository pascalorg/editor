import { type AnyNode, getLevelDisplayName, type LevelNode } from '@pascal-app/core'
import { type Zippable, zipSync } from 'fflate'
import * as THREE from 'three'
import {
  exportSceneToPrintStl,
  mergePrintExportDiagnostics,
  type PrintExportDiagnostic,
  type PrintExportReport,
} from './print-export'
import { compileSemanticPrintShell } from './print-shell-compiler'

const ZIP_MTIME = new Date(2000, 0, 1, 0, 0, 0)
const MILLIMETERS_PER_METER = 1000

export type PrintBaseMode = 'none' | 'plinth'

export type PrintPlinthOptions = {
  marginMm: number
  thicknessMm: number
}

export type PrintLevelPartReport = {
  kind: 'level' | 'plinth'
  levelId: string
  label: string
  filename: string
  report: PrintExportReport
}

export type PrintLevelBundleReport = {
  kind: 'print-level-stl-report'
  version: 1
  scale: number
  units: 'millimeter'
  orientation: 'z-up'
  status: 'pass' | 'warning' | 'blocked'
  partCount: number
  parts: PrintLevelPartReport[]
  excludedNodeIds: string[]
  diagnostics: PrintExportDiagnostic[]
}

export type PrintLevelStlBundle = {
  archive: Uint8Array<ArrayBuffer>
  report: PrintLevelBundleReport
}

export type PrintLevelExportOptions = {
  scale: number
  plinth?: PrintPlinthOptions
  compileShells?: boolean
}

function exportedIdentityIds(root: THREE.Object3D): Set<string> {
  const ids = new Set<string>()
  root.traverse((object) => {
    const id = object.userData.pascalId
    if (typeof id === 'string') ids.add(id)
  })
  return ids
}

function owningLevelId(
  id: string,
  nodes: Record<string, AnyNode>,
  memo: Map<string, string | null>,
  path = new Set<string>(),
): string | null {
  if (memo.has(id)) return memo.get(id) ?? null
  const node = nodes[id]
  if (!node || path.has(id)) return null
  if (node.type === 'level') {
    memo.set(id, id)
    return id
  }
  if (!node.parentId) {
    memo.set(id, null)
    return null
  }

  path.add(id)
  const levelId = owningLevelId(node.parentId, nodes, memo, path)
  path.delete(id)
  memo.set(id, levelId)
  return levelId
}

function levelAncestors(levelId: string, nodes: Record<string, AnyNode>): Set<string> {
  const ancestors = new Set<string>()
  const visited = new Set<string>()
  let parentId = nodes[levelId]?.parentId ?? null
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    ancestors.add(parentId)
    parentId = nodes[parentId]?.parentId ?? null
  }
  return ancestors
}

function isSpanningNode(node: AnyNode, ownerLevelId: string | null): boolean {
  if (node.type === 'elevator') return true
  if (node.type !== 'stair') return false

  const fromLevelId = node.fromLevelId ?? ownerLevelId
  const toLevelId = node.toLevelId
  return Boolean(fromLevelId && toLevelId && fromLevelId !== toLevelId)
}

function hasExcludedAncestor(
  id: string,
  excludedIds: ReadonlySet<string>,
  nodes: Record<string, AnyNode>,
): boolean {
  const visited = new Set<string>()
  let parentId = nodes[id]?.parentId ?? null
  while (parentId && !visited.has(parentId)) {
    if (excludedIds.has(parentId)) return true
    visited.add(parentId)
    parentId = nodes[parentId]?.parentId ?? null
  }
  return false
}

function pruneSceneToLevel(
  source: THREE.Object3D,
  levelId: string,
  nodes: Record<string, AnyNode>,
  excludedIds: ReadonlySet<string>,
  ownerByNodeId: Map<string, string | null>,
): THREE.Object3D {
  const scene = source.clone(true)
  const ancestors = levelAncestors(levelId, nodes)
  const removals: THREE.Object3D[] = []

  scene.traverse((object) => {
    const id = object.userData.pascalId
    if (typeof id !== 'string') return
    const belongsToLevel =
      ownerByNodeId.get(id) === levelId &&
      !excludedIds.has(id) &&
      !hasExcludedAncestor(id, excludedIds, nodes)
    if (!belongsToLevel && !ancestors.has(id)) removals.push(object)
  })

  for (const object of removals) object.removeFromParent()
  scene.name = `print-level-${levelId}`
  return scene
}

function safeFilenamePart(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'level'
  )
}

function bundleStatus(
  diagnostics: PrintExportDiagnostic[],
  parts: PrintLevelPartReport[],
): PrintLevelBundleReport['status'] {
  if (
    diagnostics.some((diagnostic) => diagnostic.severity === 'error') ||
    parts.some((part) => part.report.status === 'blocked')
  ) {
    return 'blocked'
  }
  if (
    diagnostics.some((diagnostic) => diagnostic.severity === 'warning') ||
    parts.some((part) => part.report.status === 'warning')
  ) {
    return 'warning'
  }
  return 'pass'
}

export function exportSceneLevelsToPrintStl(
  source: THREE.Object3D,
  nodes: Record<string, AnyNode>,
  options: PrintLevelExportOptions,
): PrintLevelStlBundle {
  const exportedIds = exportedIdentityIds(source)
  const ownerByNodeId = new Map<string, string | null>()
  for (const id of Object.keys(nodes)) owningLevelId(id, nodes, ownerByNodeId)

  const levels = Object.values(nodes)
    .filter((node): node is LevelNode => node.type === 'level' && exportedIds.has(node.id))
    .sort(
      (a, b) =>
        (a.parentId ?? '').localeCompare(b.parentId ?? '') ||
        a.level - b.level ||
        a.id.localeCompare(b.id),
    )

  const excludedIds = new Set<string>()
  const diagnostics: PrintExportDiagnostic[] = []
  for (const id of exportedIds) {
    const node = nodes[id]
    if (!node || !isSpanningNode(node, ownerByNodeId.get(id) ?? null)) continue
    excludedIds.add(id)
    diagnostics.push({
      severity: 'error',
      code: 'unsplit_spanning_node',
      message: `${node.type} ${id} spans levels and was omitted. Hide it or define a deterministic split before downloading level parts.`,
    })
  }

  if (levels.length === 0) {
    diagnostics.push({
      severity: 'error',
      code: 'no_visible_levels',
      message: 'No visible level nodes remain in the print scope.',
    })
  }

  const levelFiles: { filename: string; bytes: Uint8Array<ArrayBuffer> }[] = []
  const levelParts: PrintLevelPartReport[] = []
  for (const [index, level] of levels.entries()) {
    const label = getLevelDisplayName(level)
    const filename = `${String(index + 1).padStart(2, '0')}_${safeFilenamePart(label)}.stl`
    const levelScene = pruneSceneToLevel(source, level.id, nodes, excludedIds, ownerByNodeId)
    const compiled = options.compileShells ? compileSemanticPrintShell(levelScene, nodes) : null
    const printSource = compiled ? (compiled.scene ?? new THREE.Group()) : levelScene
    const output = exportSceneToPrintStl(printSource, {
      scale: options.scale,
      compiled: compiled?.status === 'compiled',
    })
    const report = compiled
      ? mergePrintExportDiagnostics(
          output.report,
          compiled.diagnostics,
          new Set(['compiler_pending']),
        )
      : output.report
    if (compiled) {
      diagnostics.push(
        ...compiled.diagnostics.filter((diagnostic) => diagnostic.severity !== 'info'),
      )
    }
    levelFiles.push({ filename, bytes: new Uint8Array(output.buffer) })
    levelParts.push({ kind: 'level', levelId: level.id, label, filename, report })
  }

  let plinthFile: { filename: string; bytes: Uint8Array<ArrayBuffer> } | null = null
  let plinthPart: PrintLevelPartReport | null = null
  if (options.plinth) {
    const { marginMm, thicknessMm } = options.plinth
    if (
      !Number.isFinite(marginMm) ||
      marginMm < 0 ||
      !Number.isFinite(thicknessMm) ||
      thicknessMm <= 0
    ) {
      diagnostics.push({
        severity: 'error',
        code: 'invalid_plinth_dimensions',
        message: 'Plinth margin must be non-negative and thickness must be positive.',
      })
    } else {
      const buildingIds = new Set(levels.map((level) => level.parentId ?? 'unparented-building'))
      const lowestLevel = levels[0]
      const lowestPart = levelParts[0]
      const bounds = lowestPart?.report.bounds
      if (buildingIds.size > 1) {
        diagnostics.push({
          severity: 'error',
          code: 'multiple_building_plinth',
          message: 'A plinth currently requires the print scope to contain exactly one building.',
        })
      } else if (!lowestLevel || !lowestPart || !bounds) {
        diagnostics.push({
          severity: 'error',
          code: 'plinth_missing_footprint',
          message: 'The lowest visible level has no structural bounds for plinth generation.',
        })
      } else {
        const widthMeters = ((bounds.width + marginMm * 2) * options.scale) / MILLIMETERS_PER_METER
        const depthMeters = ((bounds.depth + marginMm * 2) * options.scale) / MILLIMETERS_PER_METER
        const thicknessMeters = (thicknessMm * options.scale) / MILLIMETERS_PER_METER
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(widthMeters, thicknessMeters, depthMeters),
        )
        const output = exportSceneToPrintStl(mesh, options)
        const filename = '00_plinth.stl'
        plinthFile = { filename, bytes: new Uint8Array(output.buffer) }
        plinthPart = {
          kind: 'plinth',
          levelId: lowestLevel.id,
          label: 'Plinth',
          filename,
          report: output.report,
        }
        diagnostics.push({
          severity: 'info',
          code: 'rectangular_plinth_experimental',
          message:
            'The plinth is a separate rectangular part derived from the lowest level bounds; footprint shaping and connectors are not implemented yet.',
        })
      }
    }
  }

  diagnostics.push({
    severity: 'info',
    code: 'level_parts_experimental',
    message: options.compileShells
      ? 'Level parts use the experimental synchronous semantic shell compiler; worker execution, self-intersection checks, and minimum wall thickness remain pending.'
      : 'Level parts are separated semantically but are not boolean-unioned printable shells yet.',
  })

  const files: Zippable = {}
  const parts: PrintLevelPartReport[] = []
  if (plinthFile && plinthPart) {
    files[plinthFile.filename] = [plinthFile.bytes, { level: 0, mtime: ZIP_MTIME }]
    parts.push(plinthPart)
  }
  for (const [index, file] of levelFiles.entries()) {
    files[file.filename] = [file.bytes, { level: 0, mtime: ZIP_MTIME }]
    const part = levelParts[index]
    if (part) parts.push(part)
  }

  return {
    archive: zipSync(files, { level: 0 }),
    report: {
      kind: 'print-level-stl-report',
      version: 1,
      scale: options.scale,
      units: 'millimeter',
      orientation: 'z-up',
      status: bundleStatus(diagnostics, parts),
      partCount: parts.length,
      parts,
      excludedNodeIds: Array.from(excludedIds).sort(),
      diagnostics,
    },
  }
}

export function isPrintLevelBundleReport(value: unknown): value is PrintLevelBundleReport {
  if (!value || typeof value !== 'object') return false
  const report = value as Partial<PrintLevelBundleReport>
  return report.kind === 'print-level-stl-report' && report.version === 1
}
