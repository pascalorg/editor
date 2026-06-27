export type DynamicType =
  | 'visible'
  | 'move'
  | 'blink'
  | 'fill'
  | 'scale'
  | 'color'
  | 'rotate'
  | 'flow'
  | 'conveyorFlow'
  | 'level'
  | 'speed'
  | 'openClose'
  | 'running'
  | 'brightness'
  | 'valueDisplay'

export type DynamicAxis = 'x' | 'y' | 'z'
export type DynamicMotionMode = 'follow' | 'smooth'
export type DynamicMoveStyle = 'translate' | 'roll'
export type DynamicColorMode = 'condition' | 'gradient'
export type DynamicScaleEffect = 'fixed' | 'pulse' | 'alarmPulse'
export type DynamicFlowMedium = 'steam' | 'liquid'
export type DynamicConveyorEndpointBehavior = 'loop' | 'disappear' | 'continue' | 'accumulate'
export type DynamicJointMotionKind = 'rotation' | 'translation'

export type DynamicJointChannel = {
  id: string
  label: string
  targetNodeId: string
  axis: DynamicAxis
  motion: DynamicJointMotionKind
  pivot?: [number, number, number]
  inputRange?: [number, number]
  outputRange?: [number, number]
  unit?: string
  source?: string
}

export type DynamicJointBinding = {
  id: string
  channelId: string
  path: string
  inputRange?: [number, number]
  outputRange?: [number, number]
  enabled?: boolean
}

export type DynamicBinding = {
  id: string
  type: DynamicType
  path: string
  axis?: DynamicAxis
  motionMode?: DynamicMotionMode
  moveStyle?: DynamicMoveStyle
  color?: string
  arrowColor?: string
  endColor?: string
  colorMode?: DynamicColorMode
  scaleEffect?: DynamicScaleEffect
  flowMedium?: DynamicFlowMedium
  condition?: 'truthy' | 'equals' | 'greaterThan' | 'lessThan'
  value?: string | number | boolean
  inputRange?: [number, number]
  outputRange?: [number, number]
  speedRange?: [number, number]
  distance?: number
  spacing?: number
  cadenceSeconds?: number
  maxItems?: number
  endpointBehavior?: DynamicConveyorEndpointBehavior
  itemTemplateNodeId?: string
  direction?: DynamicAxis | 'forward' | 'backward'
  loop?: boolean
}

export type DynamicCapabilityMetadata = {
  semanticType?: string
  supportedTypes?: DynamicType[]
  recommendedTypes?: DynamicType[]
  source?: string
}

export type DynamicMetadata = {
  semanticType?: string
  dynamicBindings?: DynamicBinding[]
  dynamicCapabilities?: DynamicCapabilityMetadata
  jointChannels?: DynamicJointChannel[]
  jointBindings?: DynamicJointBinding[]
}

export const DYNAMIC_TYPE_LABELS: Record<DynamicType, string> = {
  visible: '可见',
  move: '移动',
  blink: '闪烁',
  fill: '装载量',
  scale: '缩放',
  color: '颜色',
  rotate: '转动',
  flow: '流量',
  conveyorFlow: '输送流动',
  level: '液位',
  speed: '速度',
  openClose: '开关',
  running: '运行',
  brightness: '亮度',
  valueDisplay: '数值显示',
}


export const SEMANTIC_TYPE_LABELS: Record<string, string> = {
  generic: '普通物体',
  pipe: '管道',
  conveyor: '输送带',
  tank: '储罐',
  container: '容器/箱体',
  cabinet: '柜体',
  silo: '料仓',
  battery: '电池',
  fan: '风机',
  motor: '电机',
  roller: '滚筒',
  valve: '阀门',
  pump: '泵',
  light: '灯',
  display: '仪表/数显',
}
