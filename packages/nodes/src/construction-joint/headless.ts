/**
 * The joints a pour split implies, without the inspector that edits them.
 *
 * `buildSolverJointNodes` is pure — it reads an element and returns nodes — but
 * `index.ts` also exports the node definition, and a definition carries the parametric
 * editors, which are React. Reaching the pure function through the barrel therefore
 * drags `'use client'` components into whatever imports it, and in a Next Route Handler
 * that is a build failure rather than dead weight: the handler is a Server Component,
 * so a `useEffect` anywhere in its import graph fails the compile.
 *
 * Narrow for the same reason `formwork-assembly/headless.ts` is, and asserted the same
 * way by `headless.test.ts` — one function, one chain, the engine and the schemas.
 */

export { buildSolverJointNodes } from './attach'
