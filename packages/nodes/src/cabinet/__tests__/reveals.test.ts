import { expect, test } from 'bun:test'
import { CabinetModuleNode, CabinetNode } from '@pascal-app/core'
import { CABINET_REVEAL_GAPS, cabinetRevealGapById, cabinetRevealGapId } from '../reveals'

test('standard reveal presets use millimetre values', () => {
  expect(CABINET_REVEAL_GAPS.map((gap) => gap.value)).toEqual([0.002, 0.003, 0.004, 0.006])
  expect(cabinetRevealGapById('3')).toMatchObject({ label: '3 mm', value: 0.003 })
})

test('custom reveal values stay visible as custom', () => {
  expect(cabinetRevealGapId(0.003)).toBe('3')
  expect(cabinetRevealGapId(0.005)).toBe('custom')
})

test('cabinet defaults keep the architectural 3 mm reveal', () => {
  expect(CabinetNode.parse({}).frontGap).toBe(0.003)
  expect(CabinetModuleNode.parse({}).frontGap).toBe(0.003)
})
