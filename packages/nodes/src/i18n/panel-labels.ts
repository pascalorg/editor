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
  actions: () => pn('common.sections.actions', '操作'),
  attachment: () => pn('common.sections.attachment', '附着'),
  dimensions: () => pn('common.sections.dimensions', '尺寸'),
  elevation: () => pn('common.sections.elevation', '标高'),
  facing: () => pn('common.sections.facing', '朝向'),
  fold: () => pn('common.sections.fold', '折叠'),
  frame: () => pn('common.sections.frame', '框架'),
  garage: () => pn('common.sections.garage', '车库'),
  geometry: () => pn('common.sections.geometry', '几何'),
  grid: () => pn('common.sections.grid', '网格'),
  handle: () => pn('common.sections.handle', '把手'),
  hardware: () => pn('common.sections.hardware', '五金'),
  height: () => pn('common.sections.height', '高度'),
  heights: () => pn('common.sections.heights', '高度'),
  holes: () => pn('common.sections.holes', '洞口'),
  info: () => pn('common.sections.info', '信息'),
  opening: () => pn('common.sections.opening', '开口'),
  openingShape: () => pn('common.sections.openingShape', '开口形状'),
  position: () => pn('common.sections.position', '位置'),
  preset: () => pn('common.sections.preset', '预设'),
  rotation: () => pn('common.sections.rotation', '旋转'),
  scale: () => pn('common.sections.scale', '缩放'),
  segments: () => pn('common.sections.segments', '分段'),
  shape: () => pn('common.sections.shape', '形状'),
  sill: () => pn('common.sections.sill', '窗台'),
  slide: () => pn('common.sections.slide', '滑动'),
  structure: () => pn('common.sections.structure', '结构'),
  swing: () => pn('common.sections.swing', '摆动'),
  threshold: () => pn('common.sections.threshold', '门槛'),
  topShape: () => pn('common.sections.topShape', '顶部形状'),
  transform: () => pn('common.sections.transform', '变换'),
  type: () => pn('common.sections.type', '类型'),
  collections: () => pn('common.sections.collections', '集合'),
  contentPadding: () => pn('common.sections.contentPadding', '内容边距'),
  footprint: () => pn('common.sections.footprint', '轮廓'),
  roofType: () => pn('common.sections.roofType', '屋顶类型'),
  railing: () => pn('common.sections.railing', '栏杆'),
  shaft: () => pn('common.sections.shaft', '井道'),
  ends: () => pn('common.sections.ends', '端部'),
  service: () => pn('common.sections.service', '服务'),
  cab: () => pn('common.sections.cab', '轿厢'),
  doors: () => pn('common.sections.doors', '门'),
  access: () => pn('common.sections.access', '出入口'),
  destination: () => pn('common.sections.destination', '目标'),
  motion: () => pn('common.sections.motion', '运动'),
  windowType: () => pn('common.sections.windowType', '窗户类型'),
}

export const L = {
  move: () => pn('common.labels.move', '移动'),
  duplicate: () => pn('common.labels.duplicate', '复制'),
  delete: () => pn('common.labels.delete', '删除'),
  curve: () => pn('common.labels.curve', '曲线'),
  width: () => pn('common.labels.width', '宽度'),
  height: () => pn('common.labels.height', '高度'),
  length: () => pn('common.labels.length', '长度'),
  thickness: () => pn('common.labels.thickness', '厚度'),
  depth: () => pn('common.labels.depth', '深度'),
  yaw: () => pn('common.labels.yaw', '偏航'),
  rotation: () => pn('common.labels.rotation', '旋转'),
  x: () => pn('common.labels.x', 'X'),
  y: () => pn('common.labels.y', 'Y'),
  z: () => pn('common.labels.z', 'Z'),
  area: () => pn('common.labels.area', '面积'),
  open: () => pn('common.labels.open', '打开'),
  done: () => pn('common.labels.done', '完成'),
  auto: () => pn('common.labels.auto', '自动'),
  manual: () => pn('common.labels.manual', '手动'),
  addHole: () => pn('common.labels.addHole', '添加洞口'),
  noHoles: () => pn('common.labels.noHoles', '无洞口'),
  flipSide: () => pn('common.labels.flipSide', '翻转侧面'),
  cornerRadius: () => pn('common.labels.cornerRadius', '圆角半径'),
  revealRadius: () => pn('common.labels.revealRadius', '洞口圆角'),
  archHeight: () => pn('common.labels.archHeight', '拱高'),
  horizontal: () => pn('common.labels.horizontal', '水平'),
  vertical: () => pn('common.labels.vertical', '垂直'),
  columns: () => pn('common.labels.columns', '列'),
  rows: () => pn('common.labels.rows', '行'),
  divider: () => pn('common.labels.divider', '分隔'),
  inset: () => pn('common.labels.inset', '内缩'),
  panels: () => pn('common.labels.panels', '面板'),
  steps: () => pn('common.labels.steps', '台阶数'),
  rise: () => pn('common.labels.rise', '升高'),
  sweep: () => pn('common.labels.sweep', '扫掠角'),
  speed: () => pn('common.labels.speed', '速度'),
  presets: () => pn('common.labels.presets', '预设'),
  dimensions: () => pn('common.labels.dimensions', '尺寸'),
  uniformScale: () => pn('common.labels.uniformScale', '等比缩放'),
  manageCollections: () => pn('common.labels.manageCollections', '管理集合…'),
  addSegment: () => pn('common.labels.addSegment', '添加分段'),
  addFlight: () => pn('common.labels.addFlight', '添加梯段'),
  addLanding: () => pn('common.labels.addLanding', '添加平台'),
  rotateMinus45: () => pn('common.labels.rotateMinus45', '-45°'),
  rotatePlus45: () => pn('common.labels.rotatePlus45', '+45°'),
  enableThreshold: () => pn('common.labels.enableThreshold', '启用门槛'),
  enableHandle: () => pn('common.labels.enableHandle', '启用把手'),
  enableSill: () => pn('common.labels.enableSill', '启用窗台'),
  doorCloser: () => pn('common.labels.doorCloser', '闭门器'),
  panicBar: () => pn('common.labels.panicBar', '逃生推杆'),
  barHeight: () => pn('common.labels.barHeight', '推杆高度'),
  addSegmentBtn: () => pn('common.labels.addSegmentBtn', '添加分段'),
  removeSegment: () => pn('common.labels.removeSegment', '删除'),
  autoCutout: () => pn('common.labels.autoCutout', '自动开洞'),
  openingOffset: () => pn('common.labels.openingOffset', '开洞偏移'),
  fitToFloor: () => pn('common.labels.fitToFloor', '贴合楼层'),
  innerRadius: () => pn('common.labels.innerRadius', '内半径'),
  topLanding: () => pn('common.labels.topLanding', '顶部平台'),
  centerColumn: () => pn('common.labels.centerColumn', '中心柱'),
  stepSupports: () => pn('common.labels.stepSupports', '踏步支撑'),
  cabHeight: () => pn('common.labels.cabHeight', '轿厢高度'),
  shaftWidth: () => pn('common.labels.shaftWidth', '井道宽度'),
  shaftDepth: () => pn('common.labels.shaftDepth', '井道深度'),
  wallThickness: () => pn('common.labels.wallThickness', '墙厚'),
  doorWidth: () => pn('common.labels.doorWidth', '门宽'),
  doorHeight: () => pn('common.labels.doorHeight', '门高'),
  doorTime: () => pn('common.labels.doorTime', '开门时间'),
  dwell: () => pn('common.labels.dwell', '停留'),
  wall: () => pn('common.labels.wall', '墙'),
  roof: () => pn('common.labels.roof', '屋顶'),
  wallThick: () => pn('common.labels.wallThick', '墙厚'),
  deckThick: () => pn('common.labels.deckThick', '结构板厚'),
  overhang: () => pn('common.labels.overhang', '出檐'),
  shingleThick: () => pn('common.labels.shingleThick', '瓦片厚度'),
  editing: () => pn('common.labels.editing', '(编辑中)'),
  fillToFloor: () => pn('common.labels.fillToFloorLabel', '填充到地面'),
  fromLevel: () => pn('common.labels.fromLevel', '起始楼层'),
  toLevel: () => pn('common.labels.toLevel', '目标楼层'),
  none: () => pn('common.labels.none', '无'),
  left: () => pn('common.labels.left', '左侧'),
  right: () => pn('common.labels.right', '右侧'),
  both: () => pn('common.labels.both', '两侧'),
  front: () => pn('common.labels.front', '前侧'),
  integrated: () => pn('common.labels.integrated', '集成'),
  destination: () => pn('common.labels.destination', '目标'),
  up: () => pn('common.labels.up', '向上'),
  down: () => pn('common.labels.down', '向下'),
  single: () => pn('common.labels.single', '单扇'),
  french: () => pn('common.labels.french', '法式'),
  pocket: () => pn('common.labels.pocket', '口袋门'),
  rail: () => pn('common.labels.rail', '导轨'),
  panel: () => pn('common.labels.panel', '面板'),
  openingKind: () => pn('common.labels.opening', '开口'),
  levelFallback: (level: number) =>
    pn('common.labels.levelFallback', '\u7b2c {level} \u5c42', { level: level + 1 }),
  segmentNamed: (index: number) =>
    pn('common.labels.segmentNamed', '\u5206\u6bb5 {index}', { index }),
  holeNamed: (index: number) => pn('common.labels.holeNamed', '\u6d1e\u53e3 {index}', { index }),
  holeMeta: (area: string, points: number, source: string) =>
    pn('common.labels.holeMeta', '{area} m\u00b2 \u00b7 {points} \u70b9 \u00b7 {source}', {
      area,
      points,
      source,
    }),
}

export const N = {
  wall: () => pn('common.nodes.wall', '墙'),
  door: () => pn('common.nodes.door', '门'),
  window: () => pn('common.nodes.window', '窗'),
  slab: () => pn('common.nodes.slab', '楼板'),
  ceiling: () => pn('common.nodes.ceiling', '天花'),
  column: () => pn('common.nodes.column', '柱'),
  stair: () => pn('common.nodes.stair', '楼梯'),
  stairSegment: () => pn('common.nodes.stairSegment', '楼梯段'),
  roof: () => pn('common.nodes.roof', '屋顶'),
  roofSegment: () => pn('common.nodes.roofSegment', '屋顶段'),
  spawn: () => pn('common.nodes.spawn', '出生点'),
  elevator: () => pn('common.nodes.elevator', '电梯'),
  fence: () => pn('common.nodes.fence', '围栏'),
}

export const slabL = {
  sunken: () => pn('slab.sunken', '下沉（-15cm）'),
  ground: () => pn('slab.ground', '地面（0m）'),
  raised: () => pn('slab.raised', '抬高（+5cm）'),
  step: () => pn('slab.step', '台阶（+15cm）'),
  autoElevatorCutout: () => pn('slab.autoElevatorCutout', '自动电梯开洞'),
  autoStairCutout: () => pn('slab.autoStairCutout', '自动楼梯开洞'),
}

export const ceilingL = {
  low: () => pn('ceiling.low', '低（2.4m）'),
  standard: () => pn('ceiling.standard', '标准（2.5m）'),
  high: () => pn('ceiling.high', '高（3.0m）'),
}

export function roofTypeLabel(type: string): string {
  const key = `roofSegment.types.${type}`
  const fallbacks: Record<string, string> = {
    hip: '\u56db\u5761',
    gable: '\u53cc\u5761',
    shed: '\u5355\u5761',
    flat: '\u5e73\u5c4b\u9876',
    gambrel: '\u590d\u6298',
    dutch: '\u8377\u5170\u5f0f',
    mansard: '\u66fc\u8428\u5fb7',
  }
  return pn(key, fallbacks[type] ?? type)
}

export function getRoofTypeOptions<T extends string>(values: T[]): { label: string; value: T }[] {
  return values.map((value) => ({ label: roofTypeLabel(value), value }))
}

export function stairTypeLabel(type: string): string {
  const fallbacks: Record<string, string> = {
    straight: '\u76f4\u68af',
    curved: '\u5f27\u5f62\u68af',
    spiral: '\u65cb\u68af',
  }
  return pn(`stair.types.${type}`, fallbacks[type] ?? type)
}

export function getStairTypeOptions<T extends string>(values: T[]): { label: string; value: T }[] {
  return values.map((value) => ({ label: stairTypeLabel(value), value }))
}

export function stairSegmentTypeLabel(type: string): string {
  const fallbacks: Record<string, string> = {
    stair: '\u68af\u6bb5',
    landing: '\u5e73\u53f0',
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
  const fallbacks: Record<string, string> = {
    door: '门',
    opening: '开口',
    garage: '车库门',
    hinged: '合页门',
    double: '双开门',
    french: '法式门',
    folding: '折叠门',
    pocket: '口袋门',
    barn: '谷仓门',
    sliding: '滑动门',
    'garage-sectional': '分段车库门',
    'garage-rollup': '卷帘车库门',
    'garage-tiltup': '翻板车库门',
  }
  return pn(`door.types.${value}`, fallbacks[value] ?? fallback)
}

export function windowTypeLabel(value: string, fallback: string): string {
  const fallbacks: Record<string, string> = {
    window: '窗户',
    opening: '开口',
    fixed: '固定窗',
    sliding: '滑动窗',
    casement: '平开窗',
    awning: '上悬窗',
    'single-hung': '单提拉窗',
    'double-hung': '双提拉窗',
    bay: '飘窗',
    bow: '弓形窗',
    louvered: '百叶窗',
  }
  return pn(`window.types.${value}`, fallbacks[value] ?? fallback)
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
  braceWidth: () => pn('column.braceWidth', '支撑宽度'),
  braceDepth: () => pn('column.braceDepth', '支撑深度'),
  edgeSoftness: () => pn('column.edgeSoftness', '边缘柔和'),
  shaftCornerRadius: () => pn('column.shaftCornerRadius', '柱身圆角'),
  bottomSpread: () => pn('column.bottomSpread', '底部展开'),
  connectorPlates: () => pn('column.connectorPlates', '连接板'),
  bottomWidth: () => pn('column.bottomWidth', '底部宽度'),
  topWidth: () => pn('column.topWidth', '顶部宽度'),
  taper: () => pn('column.taper', '收分'),
  endWidth: () => pn('column.endWidth', '端部宽度'),
  bulge: () => pn('column.bulge', '鼓出'),
  waist: () => pn('column.waist', '腰部'),
  segmentTwist: () => pn('column.segmentTwist', '分段扭转'),
  twistSegments: () => pn('column.twistSegments', '扭转分段'),
  ringPairs: () => pn('column.ringPairs', '环带组数'),
  ringThickness: () => pn('column.ringThickness', '环带厚度'),
  ringSpread: () => pn('column.ringSpread', '环带间距'),
  topHeight: () => pn('column.topHeight', '顶部高度'),
  topDepth: () => pn('column.topDepth', '顶部深度'),
  topTiers: () => pn('column.topTiers', '顶部层数'),
  topStepSpread: () => pn('column.topStepSpread', '顶部台阶展开'),
  bottomHeight: () => pn('column.bottomHeight', '底部高度'),
  bottomDepth: () => pn('column.bottomDepth', '底部深度'),
  plinthThickness: () => pn('column.plinthThickness', '基座厚度'),
  roundBandWidth: () => pn('column.roundBandWidth', '圆环宽度'),
  neckWidth: () => pn('column.neckWidth', '颈部宽度'),
  bottomTiers: () => pn('column.bottomTiers', '底部层数'),
  bottomStepSpread: () => pn('column.bottomStepSpread', '底部台阶展开'),
  forkSpread: () => pn('column.forkSpread', '叉形展开'),
  topSpread: () => pn('column.topSpread', '顶部展开'),
  applyPreset: () => pn('column.applyPreset', '应用预设…'),
  applyProportion: () => pn('column.applyProportion', '应用比例…'),
  round: () => pn('column.crossSection.round', '圆形'),
  square: () => pn('column.crossSection.square', '方形'),
  rectangular: () => pn('column.crossSection.rectangular', '矩形'),
  shaftWidth: () => pn('column.shaftWidth', '柱身宽度'),
}

export const elevatorL = {
  from: () => pn('elevator.from', '起始'),
  to: () => pn('elevator.to', '目标'),
  defaultFloor: () => pn('elevator.defaultFloor', '默认楼层'),
  send: () => pn('elevator.send', '发送'),
  enabled: () => pn('elevator.enabled', '启用'),
  serviceOnly: () => pn('elevator.serviceOnly', '仅服务'),
  disabled: () => pn('elevator.disabled', '禁用'),
  doorStyle: () => pn('elevator.doorStyle', '门样式'),
  doorPanelStyle: () => pn('elevator.doorPanelStyle', '门板样式'),
  shaftStyle: () => pn('elevator.shaftStyle', '井道样式'),
  frontDoors: () => pn('elevator.frontDoors', '前门'),
  rearDoors: () => pn('elevator.rearDoors', '后门'),
  requestStop: () => pn('elevator.requestStop', '请求停靠'),
  openingStyle: () => pn('elevator.openingStyle', '开口样式'),
  doorType: () => pn('elevator.doorType', '门类型'),
  service: () => pn('elevator.service', '服务'),
}

export const PL = {
  process: () => pn('pipe.process', '工艺'),
  appearance: () => pn('pipe.appearance', '外观'),
  rotate: () => pn('pipe.rotate', '旋转'),
  mediumSteam: () => pn('pipe.mediumSteam', '蒸汽'),
  mediumCondensate: () => pn('pipe.mediumCondensate', '冷凝水'),
  mediumWater: () => pn('pipe.mediumWater', '水'),
  pipe: () => pn('common.nodes.pipe', '管道'),
}
