import { type EvaluatedMotion, finitePoseFraction, motionTimeline } from './recipe'

export type MotionCommand = {
  sequence: number
  scope: 'all' | { partId: string }
  target: boolean
}

type Cursor = { time: number; lower: number; upper: number; direction: -1 | 0 | 1 }

export class ProceduralMotionController {
  readonly timeline: ReturnType<typeof motionTimeline>
  private collective: Cursor | null = null
  private parts = new Map<string, Cursor>()
  private spins = new Map<string, { phase: number; speed: number }>()
  private targets: Record<string, boolean> = Object.create(null)
  private sequence = -1

  constructor(
    readonly motions: readonly EvaluatedMotion[],
    initial: Record<string, boolean> = {},
  ) {
    this.timeline = motionTimeline({ motions: [...motions] })
    for (const [partId, { A, B }] of Object.entries(this.timeline.perPart))
      this.parts.set(partId, { time: initial[partId] ? B : A, lower: A, upper: B, direction: 0 })
    for (const motion of motions)
      if (motion.kind === 'spin') this.spins.set(motion.id, { phase: 0, speed: 0 })
    this.targets = { ...initial }
  }

  command(command: MotionCommand): void {
    if (command.sequence <= this.sequence) return
    this.sequence = command.sequence
    if (command.scope === 'all') {
      for (const partId of this.parts.keys()) this.targets[partId] = command.target
      for (const motion of this.motions)
        if (motion.kind === 'spin') this.targets[motion.partId] = command.target
      if (this.collective) {
        this.collective.direction = command.target ? 1 : -1
      } else {
        const entries = [...this.parts.entries()]
        const atStart = entries.every(([, cursor]) => cursor.time === cursor.lower)
        const atEnd = entries.every(([, cursor]) => cursor.time === cursor.upper)
        if (atStart || atEnd) {
          const time = atEnd ? this.timeline.T : 0
          this.collective = {
            time,
            lower: 0,
            upper: this.timeline.T,
            direction: command.target ? 1 : -1,
          }
          this.parts.clear()
        } else {
          for (const [partId, cursor] of this.parts) {
            const { A, B } = this.timeline.perPart[partId]!
            cursor.time = Math.max(A, Math.min(B, cursor.time))
            cursor.lower = A
            cursor.upper = B
            cursor.direction = command.target ? 1 : -1
          }
        }
      }
      return
    }
    const partId = command.scope.partId
    this.targets[partId] = command.target
    if (this.collective) {
      const shared = this.collective
      for (const [id, { A, B }] of Object.entries(this.timeline.perPart))
        this.parts.set(
          id,
          id === partId
            ? {
                time: Math.max(A, Math.min(B, shared.time)),
                lower: A,
                upper: B,
                direction: command.target ? 1 : -1,
              }
            : { time: shared.time, lower: 0, upper: this.timeline.T, direction: shared.direction },
        )
      this.collective = null
    }
    const cursor = this.parts.get(partId)
    if (cursor) {
      const { A, B } = this.timeline.perPart[partId]!
      cursor.time = Math.max(A, Math.min(B, cursor.time))
      cursor.lower = A
      cursor.upper = B
      cursor.direction = command.target ? 1 : -1
    }
  }

  tick(dt: number): {
    times: Record<string, number>
    fractions: Record<string, number>
    spins: Record<string, { phase: number; speed: number }>
    pending: boolean
  } {
    const step = Math.max(0, dt)
    if (this.collective) {
      const cursor = this.collective
      cursor.time = Math.max(
        cursor.lower,
        Math.min(cursor.upper, cursor.time + cursor.direction * step),
      )
      if (cursor.time === (cursor.direction > 0 ? cursor.upper : cursor.lower)) {
        for (const [partId, { A, B }] of Object.entries(this.timeline.perPart))
          this.parts.set(partId, {
            time: cursor.direction > 0 ? B : A,
            lower: A,
            upper: B,
            direction: 0,
          })
        this.collective = null
      }
    }
    if (!this.collective) {
      for (const cursor of this.parts.values()) {
        cursor.time = Math.max(
          cursor.lower,
          Math.min(cursor.upper, cursor.time + cursor.direction * step),
        )
        if (cursor.time === (cursor.direction > 0 ? cursor.upper : cursor.lower))
          cursor.direction = 0
      }
    }
    const times: Record<string, number> = Object.create(null)
    for (const partId of Object.keys(this.timeline.perPart))
      times[partId] = this.collective?.time ?? this.parts.get(partId)?.time ?? 0
    const fractions: Record<string, number> = Object.create(null)
    for (const motion of this.motions)
      if (motion.kind !== 'spin')
        fractions[motion.id] = finitePoseFraction(motion, times[motion.partId] ?? 0)
    let pending =
      Boolean(this.collective) || [...this.parts.values()].some((cursor) => cursor.direction !== 0)
    for (const motion of this.motions) {
      if (motion.kind !== 'spin') continue
      const state = this.spins.get(motion.id)!
      const target = this.targets[motion.partId] ? 1 : 0
      const sign = Math.sign(target - state.speed)
      const rampTime = Math.min(step, Math.abs(target - state.speed) * 0.35)
      const travel =
        state.speed * rampTime + (sign * rampTime * rampTime) / 0.7 + target * (step - rampTime)
      const next = Math.max(0, Math.min(1, state.speed + (sign * rampTime) / 0.35))
      state.phase = (state.phase + motion.amount * travel) % (2 * Math.PI)
      state.speed = next
      if (next !== target || next > 0) pending = true
    }
    return { times, fractions, spins: Object.fromEntries(this.spins), pending }
  }
}
