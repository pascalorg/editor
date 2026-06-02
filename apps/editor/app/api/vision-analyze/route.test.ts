import { describe, expect, test } from 'bun:test'
import { normalizeSemanticResponse } from './route'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function validBase() {
  return {
    valid: true,
    confidence: 0.91,
    rooms: [
      { name: '客厅', center: [0.52, 0.55], approxAreaM2: 28, confidence: 0.95 },
    ],
    openings: [
      { type: 'door', location: [0.50, 0.83], facing: 'south', confidence: 0.93 },
    ],
    wallTypes: [
      { location: [0.10, 0.50], type: 'exterior', confidence: 0.92 },
    ],
    warnings: [],
  }
}

// ─── valid=false passthrough ──────────────────────────────────────────────────

describe('normalizeSemanticResponse — valid=false', () => {
  test('passes through reason when model rejects', () => {
    const r = normalizeSemanticResponse({ valid: false, reason: '这是机械图纸' })
    expect(r.valid).toBe(false)
    expect(r.reason).toBe('这是机械图纸')
    expect(r.rooms).toHaveLength(0)
  })

  test('uses fallback reason when reason is missing', () => {
    const r = normalizeSemanticResponse({ valid: false })
    expect(r.valid).toBe(false)
    expect(r.reason).toBeTruthy()
  })
})

// ─── invalid inputs ───────────────────────────────────────────────────────────

describe('normalizeSemanticResponse — invalid inputs', () => {
  test('null returns valid=false', () => {
    expect(normalizeSemanticResponse(null).valid).toBe(false)
  })

  test('array returns valid=false', () => {
    expect(normalizeSemanticResponse([]).valid).toBe(false)
  })

  test('string returns valid=false', () => {
    expect(normalizeSemanticResponse('oops').valid).toBe(false)
  })

  test('number returns valid=false', () => {
    expect(normalizeSemanticResponse(42).valid).toBe(false)
  })

  test('empty object with no confidence returns valid=false (confidence defaults to 0)', () => {
    expect(normalizeSemanticResponse({}).valid).toBe(false)
  })

  test('object with confidence below threshold returns valid=false', () => {
    expect(normalizeSemanticResponse({ valid: true, confidence: 0.4 }).valid).toBe(false)
  })
})

// ─── wallHints alias ──────────────────────────────────────────────────────────

describe('normalizeSemanticResponse — wallHints alias', () => {
  test('wallHints is promoted to wallTypes', () => {
    const input = {
      ...validBase(),
      wallTypes: undefined,
      wallHints: [{ location: [0.1, 0.5], type: 'exterior', confidence: 0.88 }],
    }
    const r = normalizeSemanticResponse(input)
    expect(r.wallTypes).toHaveLength(1)
    expect(r.wallTypes[0]!.type).toBe('exterior')
  })

  test('wallTypes takes precedence over wallHints when both present', () => {
    const input = {
      ...validBase(),
      wallTypes: [{ location: [0.9, 0.5], type: 'interior', confidence: 0.85 }],
      wallHints: [{ location: [0.1, 0.5], type: 'exterior', confidence: 0.88 }],
    }
    const r = normalizeSemanticResponse(input)
    expect(r.wallTypes).toHaveLength(1)
    expect(r.wallTypes[0]!.type).toBe('interior') // wallTypes wins
  })
})

// ─── confidence filtering ─────────────────────────────────────────────────────

describe('normalizeSemanticResponse — confidence filtering', () => {
  test('rooms with confidence < 0.55 are dropped', () => {
    const input = {
      ...validBase(),
      rooms: [
        { name: '客厅', center: [0.5, 0.5], approxAreaM2: 20, confidence: 0.9 },
        { name: '储藏室', center: [0.1, 0.1], approxAreaM2: 3, confidence: 0.4 }, // dropped
      ],
    }
    const r = normalizeSemanticResponse(input)
    expect(r.rooms).toHaveLength(1)
    expect(r.rooms[0]!.name).toBe('客厅')
  })

  test('openings with confidence < 0.55 are dropped', () => {
    const input = {
      ...validBase(),
      openings: [
        { type: 'door', location: [0.5, 0.8], confidence: 0.9 },
        { type: 'window', location: [0.1, 0.5], confidence: 0.5 }, // dropped
      ],
    }
    const r = normalizeSemanticResponse(input)
    expect(r.openings).toHaveLength(1)
  })

  test('wallTypes with confidence < 0.70 are dropped (stricter threshold)', () => {
    const input = {
      ...validBase(),
      wallTypes: [
        { location: [0.1, 0.5], type: 'exterior', confidence: 0.92 },
        { location: [0.5, 0.1], type: 'interior', confidence: 0.65 }, // dropped (< 0.70)
      ],
    }
    const r = normalizeSemanticResponse(input)
    expect(r.wallTypes).toHaveLength(1)
  })

  test('entry without confidence field is kept (treated as acceptable)', () => {
    const input = {
      ...validBase(),
      rooms: [{ name: '客厅', center: [0.5, 0.5], approxAreaM2: 20 }],
    }
    const r = normalizeSemanticResponse(input)
    expect(r.rooms).toHaveLength(1)
  })
})

// ─── type coercion ────────────────────────────────────────────────────────────

describe('normalizeSemanticResponse — type coercion', () => {
  test('unknown opening type is coerced to "opening"', () => {
    const input = {
      ...validBase(),
      openings: [{ type: 'french_window', location: [0.5, 0.5], confidence: 0.8 }],
    }
    const r = normalizeSemanticResponse(input)
    expect(r.openings[0]!.type).toBe('opening')
  })

  test('unknown wall type is coerced to "interior"', () => {
    const input = {
      ...validBase(),
      wallTypes: [{ location: [0.5, 0.5], type: 'structural', confidence: 0.85 }],
    }
    const r = normalizeSemanticResponse(input)
    expect(r.wallTypes[0]!.type).toBe('interior')
  })

  test('unknown facing direction is omitted', () => {
    const input = {
      ...validBase(),
      openings: [{ type: 'window', location: [0.5, 0.5], facing: 'northeast', confidence: 0.85 }],
    }
    const r = normalizeSemanticResponse(input)
    expect(r.openings[0]!.facing).toBeUndefined()
  })

  test('coordinates are clamped to [0, 1]', () => {
    const input = {
      ...validBase(),
      rooms: [{ name: '客厅', center: [1.5, -0.2], approxAreaM2: 20, confidence: 0.9 }],
    }
    const r = normalizeSemanticResponse(input)
    expect(r.rooms[0]!.center[0]).toBe(1)
    expect(r.rooms[0]!.center[1]).toBe(0)
  })

  test('malformed center falls back to [0.5, 0.5]', () => {
    const input = {
      ...validBase(),
      rooms: [{ name: '客厅', center: 'bad', approxAreaM2: 20, confidence: 0.9 }],
    }
    const r = normalizeSemanticResponse(input)
    expect(r.rooms[0]!.center).toEqual([0.5, 0.5])
  })

  test('confidence is rounded to 2 decimal places', () => {
    const r = normalizeSemanticResponse({ ...validBase(), confidence: 0.912345 })
    expect(r.confidence).toBe(0.91)
  })

  test('approxAreaM2 is rounded to integer', () => {
    const input = {
      ...validBase(),
      rooms: [{ name: '客厅', center: [0.5, 0.5], approxAreaM2: 15.7, confidence: 0.9 }],
    }
    const r = normalizeSemanticResponse(input)
    expect(r.rooms[0]!.approxAreaM2).toBe(16)
  })

  test('missing name defaults to "未知房间"', () => {
    const input = {
      ...validBase(),
      rooms: [{ center: [0.5, 0.5], approxAreaM2: 10, confidence: 0.8 }],
    }
    const r = normalizeSemanticResponse(input)
    expect(r.rooms[0]!.name).toBe('未知房间')
  })
})

// ─── valid happy path ─────────────────────────────────────────────────────────

describe('normalizeSemanticResponse — happy path', () => {
  test('passes through a well-formed response unchanged (modulo rounding)', () => {
    const r = normalizeSemanticResponse(validBase())
    expect(r.valid).toBe(true)
    expect(r.confidence).toBe(0.91)
    expect(r.rooms).toHaveLength(1)
    expect(r.rooms[0]!.name).toBe('客厅')
    expect(r.openings).toHaveLength(1)
    expect(r.openings[0]!.type).toBe('door')
    expect(r.openings[0]!.facing).toBe('south')
    expect(r.wallTypes).toHaveLength(1)
    expect(r.wallTypes[0]!.type).toBe('exterior')
    expect(r.warnings).toHaveLength(0)
  })

  test('warnings string array is preserved', () => {
    const input = {
      ...validBase(),
      warnings: ['图纸旋转约 15°', '未发现北向标志'],
    }
    const r = normalizeSemanticResponse(input)
    expect(r.warnings).toEqual(['图纸旋转约 15°', '未发现北向标志'])
  })

  test('non-string warnings are stripped', () => {
    const input = { ...validBase(), warnings: ['ok', 42, null, 'also ok'] }
    const r = normalizeSemanticResponse(input)
    expect(r.warnings).toEqual(['ok', 'also ok'])
  })

  test('missing arrays default to empty', () => {
    const r = normalizeSemanticResponse({ valid: true, confidence: 0.8 })
    expect(r.rooms).toEqual([])
    expect(r.openings).toEqual([])
    expect(r.wallTypes).toEqual([])
    expect(r.warnings).toEqual([])
  })

  test('sliding_door type is preserved', () => {
    const input = {
      ...validBase(),
      openings: [{ type: 'sliding_door', location: [0.5, 0.5], confidence: 0.8 }],
    }
    const r = normalizeSemanticResponse(input)
    expect(r.openings[0]!.type).toBe('sliding_door')
  })

  test('load_bearing wallType is preserved', () => {
    const input = {
      ...validBase(),
      wallTypes: [{ location: [0.3, 0.3], type: 'load_bearing', confidence: 0.88 }],
    }
    const r = normalizeSemanticResponse(input)
    expect(r.wallTypes[0]!.type).toBe('load_bearing')
  })
})
