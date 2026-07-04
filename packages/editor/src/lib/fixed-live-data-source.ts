import {
  type LiveDataPath,
  type LiveDataSnapshot,
  type LiveDataValue,
  useLiveData,
} from '@pascal-app/core'

export const FIXED_FACTORY_LIVE_DATA_SOURCE_ID = 'fixed:factory-demo'

export const FIXED_FACTORY_LIVE_DATA_MESSAGE = {
  machine: {
    status: 1,
    temperature: 28,
  },
  fan: {
    speed: 75,
  },
  door: {
    open: 1,
  },
  device: {
    id: 'A-001',
  },
  alarm: {
    count: 2,
  },
  factory: {
    pipe: {
      flow: 180,
    },
    machine: {
      temperature: 64,
    },
    fan: {
      speed: 42,
    },
    conveyor: {
      speed: 0.7,
    },
  },
  refinery: {
    crude: {
      flowRate: 1280,
      pressure: 1.8,
    },
    tank: {
      level: 62,
    },
  },
} as const

const KNOWN_FIELD_META: Record<string, Pick<LiveDataPath, 'label' | 'unit' | 'category'>> = {
  'machine.status': { label: 'Machine status', category: 'machine' },
  'machine.temperature': { label: 'Machine temperature', unit: '°C', category: 'machine' },
  'fan.speed': { label: 'Fan speed', unit: '%', category: 'fan' },
  'door.open': { label: 'Door open', category: 'door' },
  'device.id': { label: 'Device ID', category: 'device' },
  'alarm.count': { label: 'Alarm count', category: 'alarm' },
  'factory.pipe.flow': { label: '管道流量', unit: 'm³/h', category: 'factory' },
  'factory.machine.temperature': {
    label: '设备温度',
    unit: '°C',
    category: 'factory',
  },
  'factory.fan.speed': { label: '风机转速', unit: '%', category: 'factory' },
  'factory.conveyor.speed': { label: 'Conveyor speed', unit: 'm/s', category: 'factory' },
  'refinery.crude.flowRate': { label: 'Crude flow rate', unit: 'm3/h', category: 'refinery' },
  'refinery.crude.pressure': { label: 'Crude pressure', unit: 'MPa', category: 'refinery' },
  'refinery.tank.level': { label: 'Tank level', unit: '%', category: 'refinery' },
}

function isLiveDataValue(value: unknown): value is LiveDataValue {
  return ['boolean', 'number', 'string'].includes(typeof value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function titleFromPath(path: string) {
  return path
    .split('.')
    .map((segment) =>
      segment.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (char) => char.toUpperCase()),
    )
    .join(' / ')
}

export function flattenLiveDataMessage(
  message: Record<string, unknown>,
  prefix = '',
): Record<string, LiveDataValue> {
  const values: Record<string, LiveDataValue> = {}
  for (const [key, value] of Object.entries(message)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isLiveDataValue(value)) {
      values[path] = value
    } else if (isPlainObject(value)) {
      Object.assign(values, flattenLiveDataMessage(value, path))
    }
  }
  return values
}

export function inferFixedLiveDataPaths(values: Record<string, LiveDataValue>): LiveDataPath[] {
  return Object.entries(values).map(([path, value]) => {
    const meta = KNOWN_FIELD_META[path]
    return {
      path,
      label: meta?.label ?? titleFromPath(path),
      unit: meta?.unit,
      category: meta?.category ?? path.split('.')[0],
      valueType:
        typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'string',
    }
  })
}

export function buildFixedFactoryLiveDataSnapshot(timestamp = Date.now()): LiveDataSnapshot {
  return {
    values: flattenLiveDataMessage(FIXED_FACTORY_LIVE_DATA_MESSAGE),
    seq: 1,
    timestamp,
  }
}

export const FIXED_FACTORY_LIVE_DATA_VALUES = flattenLiveDataMessage(
  FIXED_FACTORY_LIVE_DATA_MESSAGE,
)

export const FIXED_FACTORY_LIVE_DATA_PATHS = inferFixedLiveDataPaths(FIXED_FACTORY_LIVE_DATA_VALUES)

export function seedFixedFactoryLiveDataSource(timestamp = Date.now()) {
  const liveData = useLiveData.getState()
  liveData.setEndpoint(FIXED_FACTORY_LIVE_DATA_SOURCE_ID)
  liveData.setPaths(FIXED_FACTORY_LIVE_DATA_PATHS)
  liveData.setSnapshot(buildFixedFactoryLiveDataSnapshot(timestamp))
}
