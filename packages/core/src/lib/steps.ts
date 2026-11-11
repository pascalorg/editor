/**
 * Work in steps: each resume runs the next piece, and the last returns the result. A long
 * computation written this way can be resumed one piece at a time by a caller that lets other work
 * run in between; `inOneGo` runs it through.
 */
export type Steps<Result> = Generator<void, Result, void>

export function inOneGo<Result>(steps: Steps<Result>): Result {
  for (;;) {
    const step = steps.next()
    if (step.done) return step.value
  }
}
