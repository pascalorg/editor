import { expect, test } from 'bun:test'
import { authorSceneTool } from './author-scene'

// An answer stops at its output limit, and the limit counts the thinking and the call's arguments
// together. Answers that planned and wrote a whole house as one payload have stopped there before
// the payload was complete, and a payload that names only part of the house does not add to the
// scene: a revision removes what its payload leaves out. The description says both, as facts.
test("author_scene's description states what one answer holds and that a payload is the whole design", () => {
  const { description } = authorSceneTool
  expect(description).toContain('output limit')
  expect(description).toContain("thinking and the call's arguments together")
  expect(description).toContain('stopped there before the payload was complete')
  expect(description).toContain('the payload holds the whole design')
  expect(description).toContain('removes what its payload leaves out')
  expect(description).toContain('conversion_exists')
  expect(description).not.toContain('in one call')
})

test("author_scene's description names the native tools that add to the scene a call at a time", () => {
  for (const tool of ['create_room', 'add_wall', 'add_door', 'add_window', 'create_stair'])
    expect(authorSceneTool.description).toContain(tool)
})

// The module and the adapter are what a conversion stores, when it succeeds; a later call with
// replace: true and edits changes parts of them (each find text occurring once) and the adapter runs
// on the whole edited module (`packages/mcp/src/tools/author-scene.ts`). The description says so, as facts.
test("author_scene's description states what a conversion stores and what a later call changes of it", () => {
  const { description } = authorSceneTool
  expect(description).toContain(
    'A conversion stores one module and one adapter, and only when it succeeds',
  )
  expect(description).toContain('a later call with replace: true and edits')
  expect(description).toContain('each find text occurring exactly once')
  expect(description).toContain('the adapter runs on the whole edited module')
})
