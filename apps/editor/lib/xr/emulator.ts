'use client'

import { getImmersiveVRSupport } from '@pascal-app/viewer'
import type { XRDevice } from 'iwer'

export type XRRuntimeSource = 'native' | 'emulated' | 'unsupported'

const setupKey = '__pascalEditorIwerSetup'
const deviceKey = '__pascalEditorIwerDevice'

type EmulatedXRDevice = {
  canvasContainer: HTMLDivElement
  devui?: {
    devUICanvas: HTMLCanvasElement
    devUIContainer: HTMLDivElement
  }
}

export function getEmulatedXRDevice(): XRDevice | undefined {
  return (globalThis as GlobalWithIwerSetup)[deviceKey] as XRDevice | undefined
}

type GlobalWithIwerSetup = typeof globalThis & {
  [deviceKey]?: EmulatedXRDevice
  [setupKey]?: Promise<XRRuntimeSource>
}

export function prepareXRPlatform(): Promise<XRRuntimeSource> {
  const runtimeGlobal = globalThis as GlobalWithIwerSetup
  runtimeGlobal[setupKey] ??= setupXRPlatform().catch((error: unknown) => {
    delete runtimeGlobal[setupKey]
    throw error
  })
  return runtimeGlobal[setupKey]
}

async function setupXRPlatform(): Promise<XRRuntimeSource> {
  if ((await getImmersiveVRSupport()) === 'supported') return 'native'
  if (process.env.NODE_ENV !== 'development') return 'unsupported'

  const [{ XRDevice, metaQuest3 }, { DevUI }] = await Promise.all([
    import('iwer'),
    import('@iwer/devui'),
  ])
  const device = new XRDevice(metaQuest3)
  device.installRuntime({ forceInstall: true })
  device.installDevUI(DevUI)
  ;(globalThis as GlobalWithIwerSetup)[deviceKey] = device

  return (await getImmersiveVRSupport()) === 'supported' ? 'emulated' : 'unsupported'
}

export function mountEmulatorControls(): () => void {
  const device = (globalThis as GlobalWithIwerSetup)[deviceKey]
  const devui = device?.devui
  if (!(device && devui)) return () => undefined

  const host = device.canvasContainer
  const mountedHost = !host.isConnected
  const mountedCanvas = !devui.devUICanvas.isConnected
  const mountedControls = !devui.devUIContainer.isConnected

  if (mountedCanvas) host.appendChild(devui.devUICanvas)
  if (mountedControls) host.appendChild(devui.devUIContainer)
  if (mountedHost) document.body.appendChild(host)

  return () => {
    if (mountedCanvas && devui.devUICanvas.parentElement === host) devui.devUICanvas.remove()
    if (mountedControls && devui.devUIContainer.parentElement === host) {
      devui.devUIContainer.remove()
    }
    if (mountedHost && host.isConnected && host.childElementCount === 0) host.remove()
  }
}
