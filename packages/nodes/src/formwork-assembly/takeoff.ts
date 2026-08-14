'use client'

import { type AnyNode, getLevelDisplayName, type LevelNode, useScene } from '@pascal-app/core'
import { bomCsv, bomCsvFilename, type FormworkSavings } from '@pascal-app/core/formwork'
import { useMemo } from 'react'
import { formworkSavings } from './apply-saving'
import { type ProjectFormwork, projectFormworkCaveats, solveProjectFormwork } from './solve-project'
import { type FormworkValueEngineering, formworkValueOptions } from './value-engineer'

/**
 * The store read and the file, either side of `solveProjectFormwork`.
 *
 * Separate from the panel so the download is not a closure inside a component:
 * the panel offers the whole project or one level, the element inspector offers
 * one wall, and both have to produce a byte-identical file for the same scope or
 * the two buttons are two exports.
 */

/** A level, for the scope selector. */
export interface TakeoffLevel {
  id: string
  label: string
}

export interface TakeoffScope {
  /** A level's id, or `undefined` for the whole project. */
  levelId?: string
}

/**
 * Every level in the scene, in the order they are stacked.
 *
 * Sorted on `level` rather than on insertion, because a basement added after the
 * roof is still below it and a scope list that says otherwise is a list a user
 * mistrusts.
 */
export function useTakeoffLevels(): TakeoffLevel[] {
  const nodes = useScene((s) => s.nodes)
  return useMemo(() => {
    const levels = (Object.values(nodes) as AnyNode[]).filter(
      (node): node is LevelNode => node.type === 'level',
    )
    return levels
      .sort((a, b) => a.level - b.level)
      .map((level) => ({ id: level.id as string, label: getLevelDisplayName(level) }))
  }, [nodes])
}

/**
 * The project's formwork, solved.
 *
 * Memoised on the node map and the level id — a primitive, not the scope object,
 * which a caller rebuilds every render. `useHostShutters` takes the same care and
 * for the same reason: this solves every shutter in the scene, so a dependency
 * that changes identity per render re-solves the whole job on every keystroke
 * elsewhere in the inspector while looking as though it does not.
 */
export function useProjectFormwork(scope: TakeoffScope = {}): ProjectFormwork {
  const nodes = useScene((s) => s.nodes)
  const levelId = scope.levelId
  return useMemo(
    () => solveProjectFormwork(nodes as Record<string, AnyNode>, { parentId: levelId }),
    [nodes, levelId],
  )
}

/**
 * The same scope in the other catalog systems — on request, not on read.
 *
 * `asked` is a parameter rather than a call site, because every option is the whole scope solved
 * again: a takeoff that carried its alternatives would pay for one extra solve per shipped system
 * every time anybody opened the panel to read a quantity. And nobody reads this to place an
 * order — it is read once, before the system is chosen, by somebody willing to change it.
 */
export function useValueOptions(
  solution: ProjectFormwork,
  scope: TakeoffScope,
  asked: boolean,
): FormworkValueEngineering | undefined {
  const nodes = useScene((s) => s.nodes)
  const levelId = scope.levelId
  return useMemo(
    () =>
      asked
        ? formworkValueOptions(nodes as Record<string, AnyNode>, { parentId: levelId }, solution)
        : undefined,
    [asked, nodes, levelId, solution],
  )
}

/**
 * The savings this scope admits — on request, not on read, for the same reason as
 * `useValueOptions`: a substitution is the whole scope re-solved in every other system,
 * and a takeoff that carried its savings would pay for that solve on every read.
 */
export function useSavings(
  solution: ProjectFormwork,
  scope: TakeoffScope,
  asked: boolean,
): FormworkSavings | undefined {
  const nodes = useScene((s) => s.nodes)
  const levelId = scope.levelId
  return useMemo(
    () =>
      asked
        ? formworkSavings(nodes as Record<string, AnyNode>, { parentId: levelId }, solution)
        : undefined,
    [asked, nodes, levelId, solution],
  )
}

/**
 * The bill as a file, with its caveats inside it.
 *
 * `projectFormworkCaveats` rather than a phrasing of its own, so the warning in
 * the file is word for word the warning on screen — a user comparing the two
 * should not have to work out whether they are the same problem.
 */
export function takeoffCsv(
  solution: ProjectFormwork,
  subject: string,
): { filename: string; text: string } {
  const isoDate = new Date().toISOString().slice(0, 10)
  return {
    filename: bomCsvFilename(subject, isoDate),
    text: bomCsv(solution.bom, {
      subject,
      elementCount: solution.elements.length,
      shutterCount: solution.shutterCount,
      caveats: projectFormworkCaveats(solution),
      ...(solution.supply ? { supply: solution.supply } : {}),
      hire: solution.hire,
      ...(solution.cost ? { cost: solution.cost } : {}),
      ...(solution.labour ? { labour: solution.labour } : {}),
      ...(solution.schedule ? { schedule: solution.schedule } : {}),
      ...(solution.sets ? { sets: solution.sets } : {}),
      ...(solution.acquisition ? { acquisition: solution.acquisition } : {}),
      ...(solution.sequence ? { sequence: solution.sequence } : {}),
      ...(solution.resequence ? { resequence: solution.resequence } : {}),
      ...(solution.commitments ? { commitments: solution.commitments } : {}),
      ...(solution.lifts ? { lifts: solution.lifts } : {}),
      ...(solution.logistics ? { logistics: solution.logistics } : {}),
      ...(solution.cutList ? { cutList: solution.cutList } : {}),
    }),
  }
}
