import type { BriefAxes, DesignBrief } from '../agent-tools/design-brief'
import type { BriefFinding } from './brief-findings'
import { builtForm } from './design-form'
import type { SessionRecord } from './scene-checkpoint'
import type { SceneNodes } from './types'

/**
 * What a brief leaves unstated while the turn built: a form bounded by words that fix no plan is
 * compared with nothing, and a brief that lists no rooms owes none to a
 * building of many. A finding says so at the end of the turn, never a refusal: the brief is free to
 * bound what the person's words bound, and the person sees what was then built without a statement
 * to hold it to. Read only for a turn that built (the entries `made` since the brief).
 */

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

type Bounded<Axis> = Extract<NonNullable<Axis>, { kind: 'bounded' }>

const boundedWithout = <Axis extends BriefAxes['form']>(
  axis: Axis,
  states: (axis: Bounded<Axis>) => boolean,
): Bounded<Axis> | null =>
  axis?.kind === 'bounded' && !states(axis as Bounded<Axis>) ? (axis as Bounded<Axis>) : null

export function briefGaps(
  session: Pick<SessionRecord, 'designBrief' | 'made' | 'briefMadeAt'>,
  nodes: SceneNodes,
): BriefFinding[] {
  const brief: DesignBrief | undefined = session.designBrief
  if (!brief || session.briefMadeAt === undefined) return []
  const built = session.made.slice(session.briefMadeAt)
  const structure = built.some((entry) => entry.type === 'zone' || entry.type === 'level')
  const rooms = built.filter((entry) => entry.type === 'zone').length
  const found: BriefFinding[] = []
  if (structure) {
    const form = boundedWithout(brief.axes?.form, (axis) => Boolean(axis.massing?.plan))
    const volumes = form ? builtForm(nodes) : null
    if (form && volumes)
      found.push({
        code: 'form_bounded_without_plan',
        message: `The brief bounds the form by "${form.quote}", words that fix no plan; the scene has ${plural(volumes.volumes, 'volume')} (${volumes.shapes.join(', ')}).`,
      })
  }
  if (rooms >= 2 && !brief.rooms?.length)
    found.push({
      code: 'rooms_not_listed',
      message: `The brief lists no rooms; the turn built ${rooms} rooms.`,
    })
  return found
}
