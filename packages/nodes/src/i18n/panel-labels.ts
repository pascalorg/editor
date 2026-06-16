import { t } from '@pascal-app/editor'

export function pn(
  key: string,
  fallback: string,
  params?: Record<string, string | number>,
): string {
  if (params) {
    return t(`nodes.${key}`, { fallback, params })
  }
  return t(`nodes.${key}`, fallback)
}

export const S = {
  actions: () => pn('common.sections.actions', '\u64cd\u4f5c'),
  attachment: () => pn('common.sections.attachment', 'Attachment'),
  dimensions: () => pn('common.sections.dimensions', '\u5c3a\u5bf8'),
  elevation: () => pn('common.sections.elevation', 'Elevation'),
  facing: () => pn('common.sections.facing', 'Facing'),
  fold: () => pn('common.sections.fold', 'Fold'),
  frame: () => pn('common.sections.frame', 'Frame'),
  garage: () => pn('common.sections.garage', 'Garage'),
  geometry: () => pn('common.sections.geometry', 'Geometry'),
  grid: () => pn('common.sections.grid', 'Grid'),
  handle: () => pn('common.sections.handle', 'Handle'),
  hardware: () => pn('common.sections.hardware', 'Hardware'),
  height: () => pn('common.sections.height', 'Height'),
  heights: () => pn('common.sections.heights', 'Heights'),
  holes: () => pn('common.sections.holes', 'Holes'),
  info: () => pn('common.sections.info', '\u4fe1\u606f'),
  opening: () => pn('common.sections.opening', 'Opening'),
  openingShape: () => pn('common.sections.openingShape', 'Opening Shape'),
  position: () => pn('common.sections.position', '\u4f4d\u7f6e'),
  preset: () => pn('common.sections.preset', 'Preset'),
  rotation: () => pn('common.sections.rotation', '\u65cb\u8f6c'),
  scale: () => pn('common.sections.scale', '\u7f29\u653e'),
  segments: () => pn('common.sections.segments', 'Segments'),
  shape: () => pn('common.sections.shape', 'Shape'),
  sill: () => pn('common.sections.sill', 'Sill'),
  slide: () => pn('common.sections.slide', 'Slide'),
  structure: () => pn('common.sections.structure', 'Structure'),
  swing: () => pn('common.sections.swing', 'Swing'),
  threshold: () => pn('common.sections.threshold', 'Threshold'),
  topShape: () => pn('common.sections.topShape', 'Top Shape'),
  transform: () => pn('common.sections.transform', 'Transform'),
  type: () => pn('common.sections.type', 'Type'),
  collections: () => pn('common.sections.collections', '\u96c6\u5408'),
  contentPadding: () => pn('common.sections.contentPadding', 'Content Padding'),
  footprint: () => pn('common.sections.footprint', 'Footprint'),
  roofType: () => pn('common.sections.roofType', 'Roof Type'),
  railing: () => pn('common.sections.railing', 'Railing'),
  shaft: () => pn('common.sections.shaft', 'Shaft'),
  ends: () => pn('common.sections.ends', 'Ends'),
  service: () => pn('common.sections.service', 'Service'),
  cab: () => pn('common.sections.cab', 'Cab'),
  doors: () => pn('common.sections.doors', 'Doors'),
  access: () => pn('common.sections.access', 'Access'),
  destination: () => pn('common.sections.destination', 'Destination'),
  motion: () => pn('common.sections.motion', 'Motion'),
  windowType: () => pn('common.sections.windowType', 'Window Type'),
}

export const L = {
  move: () => pn('common.labels.move', '\u79fb\u52a8'),
  duplicate: () => pn('common.labels.duplicate', '\u590d\u5236'),
  delete: () => pn('common.labels.delete', '\u5220\u9664'),
  curve: () => pn('common.labels.curve', 'Curve'),
  width: () => pn('common.labels.width', 'Width'),
  height: () => pn('common.labels.height', 'Height'),
  length: () => pn('common.labels.length', 'Length'),
  thickness: () => pn('common.labels.thickness', 'Thickness'),
  depth: () => pn('common.labels.depth', 'Depth'),
  yaw: () => pn('common.labels.yaw', 'Yaw'),
  rotation: () => pn('common.labels.rotation', 'Rotation'),
  x: () => pn('common.labels.x', 'X'),
  y: () => pn('common.labels.y', 'Y'),
  z: () => pn('common.labels.z', 'Z'),
  area: () => pn('common.labels.area', 'Area'),
  open: () => pn('common.labels.open', 'Open'),
  done: () => pn('common.labels.done', 'Done'),
  auto: () => pn('common.labels.auto', 'Auto'),
  manual: () => pn('common.labels.manual', 'Manual'),
  addHole: () => pn('common.labels.addHole', 'Add Hole'),
  noHoles: () => pn('common.labels.noHoles', 'No holes'),
  flipSide: () => pn('common.labels.flipSide', 'Flip Side'),
  cornerRadius: () => pn('common.labels.cornerRadius', 'Corner Radius'),
  revealRadius: () => pn('common.labels.revealRadius', 'Reveal Radius'),
  archHeight: () => pn('common.labels.archHeight', 'Arch Height'),
  horizontal: () => pn('common.labels.horizontal', 'Horizontal'),
  vertical: () => pn('common.labels.vertical', 'Vertical'),
  columns: () => pn('common.labels.columns', 'Columns'),
  rows: () => pn('common.labels.rows', 'Rows'),
  divider: () => pn('common.labels.divider', 'Divider'),
  inset: () => pn('common.labels.inset', 'Inset'),
  panels: () => pn('common.labels.panels', 'Panels'),
  steps: () => pn('common.labels.steps', 'Steps'),
  rise: () => pn('common.labels.rise', 'Rise'),
  sweep: () => pn('common.labels.sweep', 'Sweep'),
  speed: () => pn('common.labels.speed', 'Speed'),
  presets: () => pn('common.labels.presets', 'Presets'),
  dimensions: () => pn('common.labels.dimensions', '\u5c3a\u5bf8'),
  uniformScale: () => pn('common.labels.uniformScale', '\u7b49\u6bd4\u7f29\u653e'),
  manageCollections: () => pn('common.labels.manageCollections', '\u7ba1\u7406\u96c6\u5408\u2026'),
  addSegment: () => pn('common.labels.addSegment', 'Add Segment'),
  addFlight: () => pn('common.labels.addFlight', 'Add flight'),
  addLanding: () => pn('common.labels.addLanding', 'Add landing'),
  rotateMinus45: () => pn('common.labels.rotateMinus45', '-45°'),
  rotatePlus45: () => pn('common.labels.rotatePlus45', '+45°'),
  enableThreshold: () => pn('common.labels.enableThreshold', 'Enable Threshold'),
  enableHandle: () => pn('common.labels.enableHandle', 'Enable Handle'),
  enableSill: () => pn('common.labels.enableSill', 'Enable Sill'),
  doorCloser: () => pn('common.labels.doorCloser', 'Door Closer'),
  panicBar: () => pn('common.labels.panicBar', 'Panic Bar'),
  barHeight: () => pn('common.labels.barHeight', 'Bar Height'),
  addSegmentBtn: () => pn('common.labels.addSegmentBtn', '+ Add Segment'),
  removeSegment: () => pn('common.labels.removeSegment', '- Remove'),
  autoCutout: () => pn('common.labels.autoCutout', 'Auto Cutout'),
  openingOffset: () => pn('common.labels.openingOffset', 'Opening Offset'),
  fitToFloor: () => pn('common.labels.fitToFloor', 'Fit To Floor'),
  innerRadius: () => pn('common.labels.innerRadius', 'Inner Radius'),
  topLanding: () => pn('common.labels.topLanding', 'Top Landing'),
  centerColumn: () => pn('common.labels.centerColumn', 'Center Column'),
  stepSupports: () => pn('common.labels.stepSupports', 'Step Supports'),
  cabHeight: () => pn('common.labels.cabHeight', 'Cab Height'),
  shaftWidth: () => pn('common.labels.shaftWidth', 'Shaft Width'),
  shaftDepth: () => pn('common.labels.shaftDepth', 'Shaft Depth'),
  wallThickness: () => pn('common.labels.wallThickness', 'Wall Thickness'),
  doorWidth: () => pn('common.labels.doorWidth', 'Door Width'),
  doorHeight: () => pn('common.labels.doorHeight', 'Door Height'),
  doorTime: () => pn('common.labels.doorTime', 'Door Time'),
  dwell: () => pn('common.labels.dwell', 'Dwell'),
  wall: () => pn('common.labels.wall', 'Wall'),
  roof: () => pn('common.labels.roof', 'Roof'),
  wallThick: () => pn('common.labels.wallThick', 'Wall Thick.'),
  deckThick: () => pn('common.labels.deckThick', 'Deck Thick.'),
  overhang: () => pn('common.labels.overhang', 'Overhang'),
  shingleThick: () => pn('common.labels.shingleThick', 'Shingle Thick.'),
  editing: () => pn('common.labels.editing', '(Editing)'),
  fillToFloor: () => pn('common.labels.fillToFloorLabel', 'Fill to floor'),
  fromLevel: () => pn('common.labels.fromLevel', 'From Level'),
  toLevel: () => pn('common.labels.toLevel', 'To Level'),
  none: () => pn('common.labels.none', 'None'),
  left: () => pn('common.labels.left', 'Left'),
  right: () => pn('common.labels.right', 'Right'),
  both: () => pn('common.labels.both', 'Both'),
  front: () => pn('common.labels.front', 'Front'),
  integrated: () => pn('common.labels.integrated', 'Integrated'),
  destination: () => pn('common.labels.destination', 'Destination'),
  up: () => pn('common.labels.up', 'Up'),
  down: () => pn('common.labels.down', 'Down'),
  single: () => pn('common.labels.single', 'Single'),
  french: () => pn('common.labels.french', 'French'),
  pocket: () => pn('common.labels.pocket', 'Pocket'),
  rail: () => pn('common.labels.rail', 'Rail'),
  panel: () => pn('common.labels.panel', 'Panel'),
  openingKind: () => pn('common.labels.opening', 'Opening'),
  levelFallback: (level: number) =>
    pn('common.labels.levelFallback', 'Level {level}', { level: level + 1 }),
  segmentNamed: (index: number) => pn('common.labels.segmentNamed', 'Segment {index}', { index }),
  holeNamed: (index: number) => pn('common.labels.holeNamed', 'Hole {index}', { index }),
  holeMeta: (area: string, points: number, source: string) =>
    pn('common.labels.holeMeta', '{area} m² · {points} pts · {source}', { area, points, source }),
}

export const N = {
  wall: () => pn('common.nodes.wall', 'Wall'),
  door: () => pn('common.nodes.door', 'Door'),
  window: () => pn('common.nodes.window', 'Window'),
  slab: () => pn('common.nodes.slab', 'Slab'),
  ceiling: () => pn('common.nodes.ceiling', 'Ceiling'),
  column: () => pn('common.nodes.column', 'Column'),
  stair: () => pn('common.nodes.stair', 'Staircase'),
  stairSegment: () => pn('common.nodes.stairSegment', 'Stair Segment'),
  roof: () => pn('common.nodes.roof', 'Roof'),
  roofSegment: () => pn('common.nodes.roofSegment', 'Roof Segment'),
  spawn: () => pn('common.nodes.spawn', 'Spawn Point'),
  elevator: () => pn('common.nodes.elevator', 'Elevator'),
  fence: () => pn('common.nodes.fence', 'Fence'),
}

export const slabL = {
  sunken: () => pn('slab.sunken', 'Sunken (-15cm)'),
  ground: () => pn('slab.ground', 'Ground (0m)'),
  raised: () => pn('slab.raised', 'Raised (+5cm)'),
  step: () => pn('slab.step', 'Step (+15cm)'),
  autoElevatorCutout: () => pn('slab.autoElevatorCutout', 'Auto elevator cutout'),
  autoStairCutout: () => pn('slab.autoStairCutout', 'Auto stair cutout'),
}

export const ceilingL = {
  low: () => pn('ceiling.low', 'Low (2.4m)'),
  standard: () => pn('ceiling.standard', 'Standard (2.5m)'),
  high: () => pn('ceiling.high', 'High (3.0m)'),
}

export function roofTypeLabel(type: string): string {
  const key = `roofSegment.types.${type}`
  const fallbacks: Record<string, string> = {
    hip: 'Hip',
    gable: 'Gable',
    shed: 'Shed',
    flat: 'Flat',
    gambrel: 'Gambrel',
    dutch: 'Dutch',
    mansard: 'Mansard',
  }
  return pn(key, fallbacks[type] ?? type)
}

export function getRoofTypeOptions<T extends string>(values: T[]): { label: string; value: T }[] {
  return values.map((value) => ({ label: roofTypeLabel(value), value }))
}

export function stairTypeLabel(type: string): string {
  const fallbacks: Record<string, string> = {
    straight: 'Straight',
    curved: 'Curved',
    spiral: 'Spiral',
  }
  return pn(`stair.types.${type}`, fallbacks[type] ?? type)
}

export function getStairTypeOptions<T extends string>(values: T[]): { label: string; value: T }[] {
  return values.map((value) => ({ label: stairTypeLabel(value), value }))
}

export function stairSegmentTypeLabel(type: string): string {
  const fallbacks: Record<string, string> = {
    stair: 'Flight',
    landing: 'Landing',
  }
  return pn(`stairSegment.types.${type}`, fallbacks[type] ?? type)
}

export function columnPresetLabel(id: string, fallback: string): string {
  return pn(`column.presets.${id}`, fallback)
}

export function columnSupportStyleLabel(value: string, fallback: string): string {
  return pn(`column.supportStyles.${value}`, fallback)
}

export function doorTypeLabel(value: string, fallback: string): string {
  return pn(`door.types.${value}`, fallback)
}

export function windowTypeLabel(value: string, fallback: string): string {
  return pn(`window.types.${value}`, fallback)
}

export function elevatorDoorStyleLabel(value: string, fallback: string): string {
  return pn(`elevator.doorStyles.${value}`, fallback)
}

export function elevatorDoorPanelStyleLabel(value: string, fallback: string): string {
  return pn(`elevator.doorPanelStyles.${value}`, fallback)
}

export function elevatorShaftStyleLabel(value: string, fallback: string): string {
  return pn(`elevator.shaftStyles.${value}`, fallback)
}

export const columnL = {
  braceWidth: () => pn('column.braceWidth', 'Brace Width'),
  braceDepth: () => pn('column.braceDepth', 'Brace Depth'),
  edgeSoftness: () => pn('column.edgeSoftness', 'Edge Softness'),
  shaftCornerRadius: () => pn('column.shaftCornerRadius', 'Shaft Corner Radius'),
  bottomSpread: () => pn('column.bottomSpread', 'Bottom Spread'),
  connectorPlates: () => pn('column.connectorPlates', 'Connector Plates'),
  bottomWidth: () => pn('column.bottomWidth', 'Bottom Width'),
  topWidth: () => pn('column.topWidth', 'Top Width'),
  taper: () => pn('column.taper', 'Taper'),
  endWidth: () => pn('column.endWidth', 'End Width'),
  bulge: () => pn('column.bulge', 'Bulge'),
  waist: () => pn('column.waist', 'Waist'),
  segmentTwist: () => pn('column.segmentTwist', 'Segment Twist'),
  twistSegments: () => pn('column.twistSegments', 'Twist Segments'),
  ringPairs: () => pn('column.ringPairs', 'Ring Pairs'),
  ringThickness: () => pn('column.ringThickness', 'Ring Thickness'),
  ringSpread: () => pn('column.ringSpread', 'Ring Spread'),
  topHeight: () => pn('column.topHeight', 'Top Height'),
  topDepth: () => pn('column.topDepth', 'Top Depth'),
  topTiers: () => pn('column.topTiers', 'Top Tiers'),
  topStepSpread: () => pn('column.topStepSpread', 'Top Step Spread'),
  bottomHeight: () => pn('column.bottomHeight', 'Bottom Height'),
  bottomDepth: () => pn('column.bottomDepth', 'Bottom Depth'),
  plinthThickness: () => pn('column.plinthThickness', 'Plinth Thickness'),
  roundBandWidth: () => pn('column.roundBandWidth', 'Round Band Width'),
  neckWidth: () => pn('column.neckWidth', 'Neck Width'),
  bottomTiers: () => pn('column.bottomTiers', 'Bottom Tiers'),
  bottomStepSpread: () => pn('column.bottomStepSpread', 'Bottom Step Spread'),
  forkSpread: () => pn('column.forkSpread', 'Fork Spread'),
  topSpread: () => pn('column.topSpread', 'Top Spread'),
  applyPreset: () => pn('column.applyPreset', 'Apply preset...'),
  applyProportion: () => pn('column.applyProportion', 'Apply proportion...'),
  round: () => pn('column.crossSection.round', 'Round'),
  square: () => pn('column.crossSection.square', 'Square'),
  rectangular: () => pn('column.crossSection.rectangular', 'Rectangular'),
  shaftWidth: () => pn('column.shaftWidth', 'Shaft Width'),
}

export const elevatorL = {
  from: () => pn('elevator.from', 'From'),
  to: () => pn('elevator.to', 'To'),
  defaultFloor: () => pn('elevator.defaultFloor', 'Default Floor'),
  send: () => pn('elevator.send', 'Send'),
  enabled: () => pn('elevator.enabled', 'Enabled'),
  serviceOnly: () => pn('elevator.serviceOnly', 'Service only'),
  disabled: () => pn('elevator.disabled', 'Disabled'),
  doorStyle: () => pn('elevator.doorStyle', 'Door Style'),
  doorPanelStyle: () => pn('elevator.doorPanelStyle', 'Door Panel Style'),
  shaftStyle: () => pn('elevator.shaftStyle', 'Shaft Style'),
  frontDoors: () => pn('elevator.frontDoors', 'Front Doors'),
  rearDoors: () => pn('elevator.rearDoors', 'Rear Doors'),
  requestStop: () => pn('elevator.requestStop', 'Request Stop'),
  openingStyle: () => pn('elevator.openingStyle', 'Opening Style'),
  doorType: () => pn('elevator.doorType', 'Door Type'),
  service: () => pn('elevator.service', 'Service'),
}

export const PL = {
  process: () => pn('pipe.process', 'Process'),
  appearance: () => pn('pipe.appearance', 'Appearance'),
  rotate: () => pn('pipe.rotate', 'Rotate'),
  mediumSteam: () => pn('pipe.mediumSteam', 'Steam'),
  mediumCondensate: () => pn('pipe.mediumCondensate', 'Condensate'),
  mediumWater: () => pn('pipe.mediumWater', 'Water'),
  pipe: () => pn('common.nodes.pipe', 'Pipe'),
}
