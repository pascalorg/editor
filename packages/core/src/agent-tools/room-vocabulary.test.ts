import { expect, test } from 'bun:test'
import { createRoomTool } from './create-room'
import { deleteZoneTool, divideZoneTool, mergeZonesTool } from './room-structure'

// An agent names a room boundary with no wall the way the editor labels it, so what it says is what
// the person finds in the Scene panel. "Divider" is the door and window panels' word for the bars
// between panes.
test("room tools call a boundary with no wall a separator, the editor's Separator", () => {
  for (const description of [
    divideZoneTool.description,
    mergeZonesTool.description,
    deleteZoneTool.description,
    createRoomTool.input.outdoor.description,
  ]) {
    expect(description).toContain("the editor's Separator: a room boundary with no wall")
    expect(description).not.toMatch(/divider/i)
  }
})
