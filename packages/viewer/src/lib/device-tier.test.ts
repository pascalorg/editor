// @ts-expect-error — Bun types are not part of the viewer's production declaration build.
import { describe, expect, test } from 'bun:test'
import { classifyDevice, type DeviceSignals, isSoftwareRenderer } from './device-tier'

const desktop = (gpu: string, extra: Partial<DeviceSignals> = {}): DeviceSignals => ({
  backend: 'webgpu',
  gpu: gpu.toLowerCase(),
  fallbackAdapter: false,
  memoryGb: 8,
  cores: 8,
  touch: false,
  screenShortSide: 1080,
  mac: false,
  ...extra,
})

describe('device quality tier', () => {
  test('Low: no WebGPU, software rendering, little memory, phones, old Intel graphics', () => {
    expect(classifyDevice(desktop('nvidia geforce rtx 4070', { backend: 'webgl' }))).toBe('low')
    expect(classifyDevice(desktop('Google SwiftShader'))).toBe('low')
    expect(classifyDevice(desktop('', { fallbackAdapter: true }))).toBe('low')
    expect(classifyDevice(desktop('intel iris xe', { memoryGb: 4 }))).toBe('low')
    expect(classifyDevice(desktop('apple gpu', { touch: true, screenShortSide: 393 }))).toBe('low')
    expect(
      classifyDevice(desktop('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0)')),
    ).toBe('low')
    expect(classifyDevice(desktop('intel gen-9'))).toBe('low')
  })

  test('High: discrete GPUs and Apple Pro/Max/Ultra', () => {
    expect(classifyDevice(desktop('nvidia ampere ANGLE (NVIDIA GeForce RTX 3070)'))).toBe('high')
    expect(classifyDevice(desktop('ANGLE (AMD, AMD Radeon RX 7800 XT)'))).toBe('high')
    expect(classifyDevice(desktop('intel Intel(R) Arc(TM) A770 Graphics'))).toBe('high')
    expect(
      classifyDevice(desktop('apple metal-3 ANGLE Metal Renderer: Apple M2 Pro', { mac: true })),
    ).toBe('high')
    // Safari hides the model: a 10+ core Mac counts as a Pro/Max chip.
    expect(classifyDevice(desktop('apple gpu', { mac: true, cores: 12 }))).toBe('high')
  })

  test('Medium: tablets, integrated GPUs, base Apple M chips, and the unknown', () => {
    expect(classifyDevice(desktop('apple gpu', { touch: true, screenShortSide: 820 }))).toBe(
      'medium',
    )
    expect(classifyDevice(desktop('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics)'))).toBe('medium')
    expect(classifyDevice(desktop('ANGLE (AMD, AMD Radeon(TM) Graphics)'))).toBe('medium')
    expect(
      classifyDevice(desktop('ANGLE Metal Renderer: Apple M1, Unspecified Version', { mac: true })),
    ).toBe('medium')
    expect(classifyDevice(desktop('apple gpu', { mac: true, cores: 8 }))).toBe('medium')
    expect(classifyDevice(desktop('qualcomm adreno x1-85'))).toBe('medium')
    expect(classifyDevice(desktop(''))).toBe('medium')
  })

  test('software renderers are told apart from GPUs (their frame rate is capped)', () => {
    expect(isSoftwareRenderer(desktop('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))'))).toBe(
      true,
    )
    expect(isSoftwareRenderer(desktop('llvmpipe (LLVM 17.0.6, 256 bits)'))).toBe(true)
    expect(isSoftwareRenderer(desktop('', { fallbackAdapter: true }))).toBe(true)
    expect(isSoftwareRenderer(desktop('ANGLE Metal Renderer: Apple M2 Pro'))).toBe(false)
    expect(isSoftwareRenderer(desktop('NVIDIA GeForce RTX 3070', { backend: 'webgl' }))).toBe(false)
  })
})
