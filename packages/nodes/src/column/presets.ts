import { COLUMN_PRESETS, ColumnNode, type ColumnPresetId } from '@pascal-app/core'

export function columnPresetUpdates(id: ColumnPresetId): Partial<ColumnNode> {
  const { label: _label, ...preset } = COLUMN_PRESETS[id]
  return { supportStyle: 'vertical', ...preset }
}

const resetFields = {
  Shape: [
    'style',
    'crossSection',
    'edgeSoftness',
    'shaftCornerRadius',
    'supportStyle',
    'bracePlateEnabled',
  ],
  Size: [
    'height',
    'width',
    'depth',
    'radius',
    'braceWidth',
    'braceDepth',
    'braceBottomSpread',
    'braceTopSpread',
  ],
  Profile: [
    'shaftProfile',
    'shaftTaper',
    'shaftBulge',
    'shaftStartScale',
    'shaftEndScale',
    'shaftSegmentCount',
    'shaftTwistStep',
  ],
  Base: [
    'baseStyle',
    'baseHeight',
    'baseWidthScale',
    'baseDepthScale',
    'baseTierCount',
    'baseStepSpread',
    'basePlinthHeightRatio',
    'baseRoundBandScale',
    'baseNeckScale',
    'baseRoundBandCount',
    'baseRibCount',
    'baseCarvingLevel',
    'basePanelInset',
  ],
  Capital: [
    'capitalStyle',
    'capitalHeight',
    'capitalWidthScale',
    'capitalDepthScale',
    'capitalTierCount',
    'capitalStepSpread',
    'capitalBandCount',
    'voluteSize',
    'voluteCount',
    'leafCount',
    'leafRows',
    'bracketDepth',
    'bracketTierCount',
    'pendantCount',
    'capitalCarvingLevel',
  ],
  'Surface Details': [
    'shaftDetail',
    'fluteCount',
    'fluteDepth',
    'fluteWidth',
    'spiralTwist',
    'spiralRibCount',
    'panelCount',
    'panelInsetDepth',
    'panelShape',
    'latheRingCount',
    'latheRingSpacing',
    'ringCount',
    'ringPlacement',
    'ringThickness',
    'ringSpread',
    'carvingLevel',
    'carvingPlacement',
    'lowerBandEnabled',
    'lowerBandHeight',
    'lowerBandCarvingLevel',
    'dentilCount',
    'beadCount',
  ],
  Materials: ['material', 'materialPreset', 'slots'],
  Transform: ['rotation'],
} as const satisfies Record<string, readonly (keyof ColumnNode)[]>

export type ColumnResetSection = keyof typeof resetFields
export function columnSectionReset(section: ColumnResetSection): Partial<ColumnNode> {
  const defaults = ColumnNode.parse({})
  return Object.fromEntries(resetFields[section].map((key) => [key, defaults[key]]))
}
