import { type AnyNode, getWallThickness } from '@pascal-app/core'
import {
  mergePrintExportDiagnostics,
  type PrintExportDiagnostic,
  type PrintExportReport,
} from './print-export'

const MILLIMETERS_PER_METER = 1000

export type PrintFeatureThickness = {
  nodeId: string
  thicknessMm: number
}

export type PrintFeatureThicknessMeasurement = {
  features: PrintFeatureThickness[]
  unmeasuredNodeIds: string[]
}

const FEATURE_DIAGNOSTIC_CODES = new Set([
  'minimum_feature_thickness',
  'feature_below_target',
  'feature_thickness_incomplete',
])

function semanticThicknessMeters(node: AnyNode): number | null {
  switch (node.type) {
    case 'wall':
      return getWallThickness(node)
    case 'slab':
      return node.thickness
    case 'roof-segment': {
      const structuralThicknesses = [node.wallThickness, node.deckThickness + node.shingleThickness]
      if (node.roofType === 'dutch') structuralThicknesses.push(node.dutchTopRakeThickness)
      return Math.min(...structuralThicknesses)
    }
    default:
      return null
  }
}

function formatThickness(value: number): string {
  return value
    .toFixed(3)
    .replace(/\.000$/, '')
    .replace(/(\.\d*[1-9])0+$/, '$1')
}

export function measureSemanticPrintFeatureThickness(
  nodes: Record<string, AnyNode>,
  sourceNodeIds: Iterable<string>,
  scale: number,
): PrintFeatureThicknessMeasurement {
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new RangeError('Print scale must be a positive finite denominator')
  }

  const features: PrintFeatureThickness[] = []
  const unmeasuredNodeIds: string[] = []
  for (const nodeId of Array.from(new Set(sourceNodeIds)).sort()) {
    const node = nodes[nodeId]
    const thicknessMeters = node ? semanticThicknessMeters(node) : null
    if (thicknessMeters === null || !Number.isFinite(thicknessMeters) || thicknessMeters <= 0) {
      unmeasuredNodeIds.push(nodeId)
      continue
    }
    features.push({
      nodeId,
      thicknessMm: (thicknessMeters * MILLIMETERS_PER_METER) / scale,
    })
  }

  return { features, unmeasuredNodeIds }
}

export function applyPrintFeatureThickness(
  report: PrintExportReport,
  measurement: PrintFeatureThicknessMeasurement,
  minimumFeatureMm?: number,
): PrintExportReport {
  if (
    minimumFeatureMm !== undefined &&
    (!Number.isFinite(minimumFeatureMm) || minimumFeatureMm <= 0)
  ) {
    throw new RangeError('Minimum print feature target must be positive and finite')
  }

  const minimum = measurement.features.reduce<PrintFeatureThickness | null>(
    (current, feature) =>
      !current || feature.thicknessMm < current.thicknessMm ? feature : current,
    null,
  )
  const minimumNodeIds = minimum
    ? measurement.features
        .filter((feature) => Math.abs(feature.thicknessMm - minimum.thicknessMm) <= 1e-9)
        .map((feature) => feature.nodeId)
        .sort()
    : []
  const diagnostics: PrintExportDiagnostic[] = [
    {
      severity: 'info',
      code: 'compiler_limits',
      message:
        'Known semantic or generated feature dimensions were measured; mesh-observed thin features and self-intersections are not checked.',
    },
  ]

  if (minimum) {
    diagnostics.push({
      severity: 'info',
      code: 'minimum_feature_thickness',
      message: `Minimum known feature thickness is ${formatThickness(minimum.thicknessMm)} mm.`,
      nodeIds: minimumNodeIds,
    })
  }

  if (minimumFeatureMm !== undefined) {
    const belowTargetNodeIds = measurement.features
      .filter((feature) => feature.thicknessMm < minimumFeatureMm)
      .map((feature) => feature.nodeId)
      .sort()
    if (belowTargetNodeIds.length > 0) {
      diagnostics.push({
        severity: 'error',
        code: 'feature_below_target',
        message: `${belowTargetNodeIds.length.toLocaleString()} source node${
          belowTargetNodeIds.length === 1 ? '' : 's'
        } fall below the custom ${formatThickness(minimumFeatureMm)} mm feature target; the minimum is ${formatThickness(minimum?.thicknessMm ?? 0)} mm.`,
        nodeIds: belowTargetNodeIds,
      })
    }
  }

  if (measurement.unmeasuredNodeIds.length > 0) {
    diagnostics.push({
      severity: minimumFeatureMm === undefined ? 'warning' : 'error',
      code: 'feature_thickness_incomplete',
      message:
        minimumFeatureMm === undefined
          ? `Known feature thickness was not measured for ${measurement.unmeasuredNodeIds.length.toLocaleString()} source node${measurement.unmeasuredNodeIds.length === 1 ? '' : 's'}; inspect those features in a slicer.`
          : `The custom feature target cannot be verified for ${measurement.unmeasuredNodeIds.length.toLocaleString()} source node${measurement.unmeasuredNodeIds.length === 1 ? '' : 's'} without a supported semantic thickness measurement.`,
      nodeIds: measurement.unmeasuredNodeIds,
    })
  } else if (measurement.features.length === 0) {
    diagnostics.push({
      severity: minimumFeatureMm === undefined ? 'warning' : 'error',
      code: 'feature_thickness_incomplete',
      message:
        minimumFeatureMm === undefined
          ? 'No known source feature thickness was available; inspect the part in a slicer.'
          : 'The custom feature target cannot be verified because no known source feature thickness was available.',
    })
  }

  return {
    ...mergePrintExportDiagnostics(
      report,
      diagnostics,
      new Set(['compiler_limits', 'compiler_pending']),
    ),
    minimumFeatureThicknessMm: minimum?.thicknessMm ?? null,
  }
}

export function applySemanticPrintFeatureThickness(
  report: PrintExportReport,
  nodes: Record<string, AnyNode>,
  sourceNodeIds: Iterable<string>,
  minimumFeatureMm?: number,
): PrintExportReport {
  return applyPrintFeatureThickness(
    report,
    measureSemanticPrintFeatureThickness(nodes, sourceNodeIds, report.scale),
    minimumFeatureMm,
  )
}

export function isPrintFeatureThicknessDiagnostic(diagnostic: PrintExportDiagnostic): boolean {
  return FEATURE_DIAGNOSTIC_CODES.has(diagnostic.code)
}
