import { describe, expect, test } from 'bun:test'
import { PRIMITIVE_STAGE1_ANALYST_PROMPT } from './primitive-system-prompts'

describe('primitive system prompts', () => {
  test('include registry-generated geometry capabilities', () => {
    expect(PRIMITIVE_STAGE1_ANALYST_PROMPT).toContain('===== REGISTRY CAPABILITIES =====')
    expect(PRIMITIVE_STAGE1_ANALYST_PROMPT).toContain('vehicle.wheel_set')
    expect(PRIMITIVE_STAGE1_ANALYST_PROMPT).toContain('desk.desk_top')
    expect(PRIMITIVE_STAGE1_ANALYST_PROMPT).toContain('aircraft.aircraft_engine')
    expect(PRIMITIVE_STAGE1_ANALYST_PROMPT).toContain('generic.generic_body')
    expect(PRIMITIVE_STAGE1_ANALYST_PROMPT).toContain('kiosk.kiosk_body')
    expect(PRIMITIVE_STAGE1_ANALYST_PROMPT).toContain('pump.volute_casing')
    expect(PRIMITIVE_STAGE1_ANALYST_PROMPT).toContain('conveyor.conveyor_frame')
    expect(PRIMITIVE_STAGE1_ANALYST_PROMPT).toContain('electrical.electrical_cabinet')
    expect(PRIMITIVE_STAGE1_ANALYST_PROMPT).toContain('pipe_system.pipe_run')
    expect(PRIMITIVE_STAGE1_ANALYST_PROMPT).toContain('tank.cylindrical_tank')
    expect(PRIMITIVE_STAGE1_ANALYST_PROMPT).toContain('reactor.agitator_tank')
    expect(PRIMITIVE_STAGE1_ANALYST_PROMPT).toContain('compressor.rounded_machine_body')
    expect(PRIMITIVE_STAGE1_ANALYST_PROMPT).toContain('heat_exchanger.heat_exchanger')
    expect(PRIMITIVE_STAGE1_ANALYST_PROMPT).toContain('machine_tool.generic_body')
    expect(PRIMITIVE_STAGE1_ANALYST_PROMPT).toContain('motorLength')
    expect(PRIMITIVE_STAGE1_ANALYST_PROMPT).toContain('beltWidth')
    expect(PRIMITIVE_STAGE1_ANALYST_PROMPT).toContain('doorCount')
    expect(PRIMITIVE_STAGE1_ANALYST_PROMPT).toContain('pipeDiameter')
    expect(PRIMITIVE_STAGE1_ANALYST_PROMPT).toContain('tank/reactor support diameter')
    expect(PRIMITIVE_STAGE1_ANALYST_PROMPT).toContain('heat_exchanger')
    expect(PRIMITIVE_STAGE1_ANALYST_PROMPT).toContain('machine_tool')
    expect(PRIMITIVE_STAGE1_ANALYST_PROMPT).toContain('sourcePartKind')
    expect(PRIMITIVE_STAGE1_ANALYST_PROMPT).toContain('pyramid -> cone')
  })

  test('treats mixer shaft and blade prompts as component-level requests', () => {
    expect(PRIMITIVE_STAGE1_ANALYST_PROMPT).toContain(
      'If the prompt only names shaft/rod/axis plus impeller/blades/paddles',
    )
    expect(PRIMITIVE_STAGE1_ANALYST_PROMPT).toContain('do not match stirred_reactor profiles')
    expect(PRIMITIVE_STAGE1_ANALYST_PROMPT).toContain(
      'do not match stirred_reactor profiles or add vessel shells',
    )
  })
})
