import {
  type AnyNode,
  type AnyNodeId,
  emitter,
  nodeRegistry,
  pauseSpaceDetection,
  resumeSpaceDetection,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import { Vector3 } from 'three'
import {
  classifyParticipant,
  collectParticipants,
  computeGroupBox,
  expandToComponent,
  levelFrame,
  rotateGroupPatches,
} from '../components/editor/group-transform-shared'
import { steppedRotation } from '../components/tools/item/placement-math'
import { toggleDoorOpenState } from '../lib/door-interaction'
import { guideEmitter } from '../lib/guide-events'
import { runRedo, runUndo } from '../lib/history'
import {
  copySelectedNodesToEditorClipboard,
  pasteEditorClipboardToLevel,
} from '../lib/scene-clipboard'
import { emitDeleteSFX, sfxEmitter } from '../lib/sfx-bus'
import { toggleWindowOpenState } from '../lib/window-interaction'
import useEditor, { getActiveContinuationContext, getActiveSnapContext } from '../store/use-editor'
import useInteractionScope, { getMovingNode } from '../store/use-interaction-scope'

// References (guide/scan) are selected via `useEditor.selectedReferenceId`, not
// the viewer selection, so selection-based key arms (R/T rotate) need this
// separate lookup. Locked guides don't rotate, matching direct manipulation.
function getRotatableSelectedReference() {
  const refId = useEditor.getState().selectedReferenceId
  if (!refId) return null
  const node = useScene.getState().nodes[refId as AnyNodeId]
  if (!node || (node.type !== 'guide' && node.type !== 'scan')) return null
  if (useEditor.getState().guideUi[refId]?.locked === true) return null
  return node
}

// Group rotate: R/T on a multi-selection spins the whole selection rigidly
// ±45° around its bbox center — the keyboard sibling of the 3D group-rotate
// gizmo, sharing its participant snapshot + rigid-rotation math (welded
// wall/fence junctions, connected-component expansion). One batched
// `updateNodes` call = one undo step. Returns false when the selection holds
// no transformable participants so the caller can fall through to the
// single-selection arms.
function rotateGroupSelection(direction: 1 | -1): boolean {
  const { selectedIds, levelId } = useViewer.getState().selection
  if (selectedIds.length <= 1) return false
  const nodes = useScene.getState().nodes
  const participantIds = selectedIds.filter(
    (id) => classifyParticipant(nodes[id as AnyNodeId], levelId, nodes) !== null,
  )
  if (participantIds.length === 0) return false
  const fullIds = expandToComponent(participantIds, nodes, levelId)
  const { starts, links } = collectParticipants(fullIds, nodes, levelId)
  if (starts.length === 0) return false

  // Same pivot as the 3D gizmo: the selection's world bbox center, converted
  // into the level frame before orbiting placements (a rotated building would
  // otherwise displace the centre).
  const box = computeGroupBox(fullIds)
  if (!box) return false
  const worldCenter = new Vector3(
    (box.min.x + box.max.x) / 2,
    box.min.y,
    (box.min.z + box.max.z) / 2,
  )
  const localCenter = worldCenter.applyMatrix4(levelFrame(levelId).inverse)

  // R (+45° yaw) orbits by -45° in the atan2 x→z sense: yaw = rotation - delta
  // (see rotateGroupPatches), so keyboard direction matches the single-node
  // steppedRotation sense.
  const delta = -direction * (Math.PI / 4)
  const patches = rotateGroupPatches(starts, links, { x: localCenter.x, z: localCenter.z }, delta)
  // Space detection stays out: a rigid rotation of existing walls must not
  // re-create the room's auto floors/ceilings at the new bearing.
  pauseSpaceDetection()
  useScene
    .getState()
    .updateNodes(patches.map(([id, data]) => ({ id, data: data as Partial<AnyNode> })))
  resumeSpaceDetection()
  sfxEmitter.emit('sfx:item-rotate')
  return true
}

// Tools call this in their onCancel handler when they have an active mid-action to cancel,
// so that the global Escape handler knows not to also switch to select mode.
let _toolCancelConsumed = false
export const markToolCancelConsumed = () => {
  _toolCancelConsumed = true
}

export const useKeyboard = ({
  isVersionPreviewMode = false,
  disabled = false,
}: {
  isVersionPreviewMode?: boolean
  disabled?: boolean
} = {}) => {
  useEffect(() => {
    if (disabled) {
      return
    }

    // True while a door/window is being placed: either a fresh clone is moving
    // (preset / duplicate path) or a door/window build tool is armed. The
    // placement tool owns R/T then (flip the draft before commit), so the
    // global selection-based R/T handler must stand down to avoid double-firing.
    const isPlacingOpening = () => {
      const ed = useEditor.getState()
      const moving = getMovingNode()
      if (moving?.type === 'door' || moving?.type === 'window') return true
      return ed.mode === 'build' && (ed.tool === 'door' || ed.tool === 'window')
    }

    // Shift cycles the snapping mode (and a clean-tap Ctrl the grid step)
    // whenever there's an active snapping context — i.e. exactly when the HUD
    // shows a snapping chip. That single source covers wall/fence/item drafting,
    // every node move (including wall-hosted items + door/window openings, which
    // now declare `snapProfile`), and endpoint/polygon reshaping, so the keys
    // never silently stop working. Force-place lives on Alt where a tool supports it.
    const isSnappingCycleContext = () => getActiveSnapContext() != null
    // A "clean tap" of Ctrl/Meta (pressed and released with NO other key in
    // between) cycles the grid step — same context as the Shift snapping-mode
    // cycle. `ctrlTapClean` starts true the moment Ctrl/Meta goes down alone
    // and is cleared the instant any other key fires, so chords like Ctrl+Z /
    // Ctrl+C never cycle.
    let ctrlTapClean = false

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') {
        // Only a fresh, modifier-free press starts a clean-tap candidate;
        // ignore key-repeat and presses already part of a combo.
        ctrlTapClean = !e.repeat && !e.shiftKey && !e.altKey
      } else {
        // Any non-modifier key (or a modifier combined with Ctrl/Meta) breaks
        // the clean tap.
        ctrlTapClean = false
      }

      // Don't handle shortcuts if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      if (e.key === 'Shift' && !e.repeat && useEditor.getState().mode === 'material-paint') {
        // In paint mode Shift cycles the application scope (this surface →
        // whole item / all matching / room) — the paint-mode analogue of the
        // snapping-mode cycle below. The scope chip mirrors this key.
        e.preventDefault()
        useEditor.getState().cyclePaintScope()
        sfxEmitter.emit('sfx:grid-snap')
        return
      }

      if (e.key === 'Shift' && !e.repeat && isSnappingCycleContext()) {
        // Cycle the global snapping mode (grid → lines → angles → off).
        // `'off'` is the snap bypass now, so Shift no longer holds-to-bypass.
        e.preventDefault()
        useEditor.getState().cycleSnappingMode()
        sfxEmitter.emit('sfx:grid-snap')
        return
      }

      if (
        (e.key === 't' || e.key === 'T') &&
        !e.repeat &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        !e.altKey
      ) {
        const context = getActiveContinuationContext()
        if (context === 'fence') {
          e.preventDefault()
          const current = useEditor.getState().getContinuation('fence')
          useEditor
            .getState()
            .setContinuation('fence', current === 'curved' ? 'continuous' : 'curved')
          sfxEmitter.emit('sfx:grid-snap')
          return
        }
      }

      if (
        (e.key === 'c' || e.key === 'C') &&
        !e.repeat &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        !e.altKey
      ) {
        const context = getActiveContinuationContext()
        if (context) {
          e.preventDefault()
          if (context === 'fence') {
            const current = useEditor.getState().getContinuation('fence')
            if (current !== 'curved') {
              useEditor
                .getState()
                .setContinuation('fence', current === 'single' ? 'continuous' : 'single')
              sfxEmitter.emit('sfx:grid-snap')
            }
            return
          }
          useEditor.getState().cycleContinuation(context)
          sfxEmitter.emit('sfx:grid-snap')
          return
        }
      }

      if (e.key === 'Escape') {
        e.preventDefault()

        // An in-flight reference-scale measurement swallows Escape whole:
        // cancel the flow but keep the reference selected and its panel open.
        if (useEditor.getState().referenceScaleActiveGuideId) {
          guideEmitter.emit('guide:cancel-reference-scale')
          return
        }

        _toolCancelConsumed = false
        emitter.emit('tool:cancel')

        // Only switch to select mode if no tool had an active mid-action to cancel.
        // (e.g. mid-wall draw or mid-slab polygon should only cancel the action, not exit the tool)
        if (!_toolCancelConsumed) {
          const currentPhase = useEditor.getState().phase
          const currentStructureLayer = useEditor.getState().structureLayer

          useInteractionScope
            .getState()
            .endIf((sc) => sc.kind === 'reshaping' && sc.reshape === 'hole')

          // From zone mode, return to structure select
          if (currentPhase === 'structure' && currentStructureLayer === 'zones') {
            useEditor.getState().setStructureLayer('elements')
            useEditor.getState().setMode('select')
          } else {
            // Return to the default select tool while keeping the active building/level context.
            useEditor.getState().setMode('select')
          }

          useEditor.getState().setFloorplanSelectionTool('click')

          // Clear selections to close UI panels, but KEEP the active building and level context.
          useViewer.getState().setSelection({ selectedIds: [], zoneId: null })
          useEditor.getState().setSelectedReferenceId(null)
        }
      } else if (e.key === '1' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        useEditor.getState().setPhase('site')
        useEditor.getState().setMode('select')
      } else if (e.key === '2' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        useEditor.getState().setPhase('structure')
        useEditor.getState().setMode('select')
      } else if (e.key === '3' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        useEditor.getState().setPhase('furnish')
        useEditor.getState().setMode('select')
      } else if (e.key === 'f' && !e.metaKey && !e.ctrlKey) {
        if (isVersionPreviewMode) return
        e.preventDefault()
        useEditor.getState().setPhase('furnish')
        useEditor.getState().setMode('build')
        // Set the item tool explicitly so the active tool never inherits a
        // stale tool from a prior build session.
        useEditor.getState().setTool('item')
        useEditor.getState().setActiveSidebarPanel('items')
      } else if (e.key === 'z' && !e.metaKey && !e.ctrlKey) {
        if (isVersionPreviewMode) return
        e.preventDefault()
        useEditor.getState().setPhase('structure')
        useEditor.getState().setStructureLayer('zones')
        useEditor.getState().setMode('build')
        // Set the zone tool explicitly so it never inherits a stale tool.
        useEditor.getState().setTool('zone')
      }
      if (e.key === 'v' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        useEditor.getState().setMode('select')
        useEditor.getState().setFloorplanSelectionTool('click')
      } else if (e.key === 'b' && !e.metaKey && !e.ctrlKey) {
        if (isVersionPreviewMode) return
        e.preventDefault()
        useEditor.getState().setPhase('structure')
        useEditor.getState().setStructureLayer('elements')
        useEditor.getState().setMode('build')
        // Set the wall tool explicitly so B never inherits a stale tool
        // (e.g. fence) left over from a prior build session.
        useEditor.getState().setTool('wall')
      } else if (e.key === 'x' && !e.metaKey && !e.ctrlKey) {
        if (isVersionPreviewMode) return
        e.preventDefault()
        useEditor.getState().setMode('delete')
      } else if (e.key === 'p' && !e.metaKey && !e.ctrlKey) {
        if (isVersionPreviewMode) return
        e.preventDefault()
        useEditor.getState().primeMaterialPaintFromSelection()
        useEditor.getState().setPhase('structure')
        useEditor.getState().setStructureLayer('elements')
        useEditor.getState().setMode('material-paint')
      } else if (e.key === 'c' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        if (isVersionPreviewMode) return
        e.preventDefault()
        copySelectedNodesToEditorClipboard()
      } else if (e.key === 'v' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        if (isVersionPreviewMode) return
        e.preventDefault()
        const result = pasteEditorClipboardToLevel()
        if (result?.pastedIds.length) {
          sfxEmitter.emit('sfx:item-place')
        }
      } else if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
        if (isVersionPreviewMode) return
        e.preventDefault()
        runUndo()
      } else if (e.key === 'Z' && e.shiftKey && (e.metaKey || e.ctrlKey)) {
        if (isVersionPreviewMode) return
        e.preventDefault()
        runRedo()
      } else if (e.key === 'ArrowUp' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        const { buildingId, levelId } = useViewer.getState().selection
        if (buildingId) {
          const building = useScene.getState().nodes[buildingId]
          const levels =
            building?.type === 'building'
              ? building.children.filter(
                  (childId) => useScene.getState().nodes[childId as AnyNodeId]?.type === 'level',
                )
              : []
          if (levels.length > 0) {
            const currentIdx = levelId ? levels.indexOf(levelId as any) : -1
            const nextIdx = currentIdx < levels.length - 1 ? currentIdx + 1 : currentIdx
            if (nextIdx !== -1 && nextIdx !== currentIdx) {
              useViewer.getState().setSelection({ levelId: levels[nextIdx] as any })
            } else if (currentIdx === -1) {
              useViewer.getState().setSelection({ levelId: levels[0] as any })
            }
          }
        }
      } else if (e.key === 'ArrowDown' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        const { buildingId, levelId } = useViewer.getState().selection
        if (buildingId) {
          const building = useScene.getState().nodes[buildingId]
          const levels =
            building?.type === 'building'
              ? building.children.filter(
                  (childId) => useScene.getState().nodes[childId as AnyNodeId]?.type === 'level',
                )
              : []
          if (levels.length > 0) {
            const currentIdx = levelId ? levels.indexOf(levelId as any) : -1
            const prevIdx = currentIdx > 0 ? currentIdx - 1 : currentIdx
            if (prevIdx !== -1 && prevIdx !== currentIdx) {
              useViewer.getState().setSelection({ levelId: levels[prevIdx] as any })
            } else if (currentIdx === -1) {
              useViewer.getState().setSelection({ levelId: levels[levels.length - 1] as any })
            }
          }
        }
      } else if (
        (e.key === 'r' || e.key === 'R') &&
        !e.metaKey &&
        !e.ctrlKey &&
        !isVersionPreviewMode &&
        !isPlacingOpening()
      ) {
        // `!metaKey && !ctrlKey` lets Cmd/Ctrl+R reach the browser reload instead
        // of rotating/flipping the selected node.
        // Rotate selected node clockwise if it supports rotation (items, roofs, etc.)
        // Doors use R to flip side (front ↔ back, rotation += π); their
        // open/close toggle lives on E. Windows still use R to toggle
        // their open/closed state.
        //
        // Skipped entirely while a door/window placement is active
        // (`isPlacingOpening`): the placement tool owns R then (flip the draft
        // before commit), and the user can have a node selected at the same
        // time — without this guard both would fire (double flip + sfx).
        //
        // References (guide/scan) live in `selectedReferenceId`, not the viewer
        // selection — check them first, like the Delete arm below.
        //
        // Multi-selection branches to the group rotate before any of the
        // single-selection arms (reference, door/window flip, registry
        // keyboardActions, plain rotate) — those stay single-selection-only.
        if (rotateGroupSelection(1)) {
          e.preventDefault()
          return
        }
        const rotatableReference = getRotatableSelectedReference()
        if (rotatableReference) {
          e.preventDefault()
          useScene.getState().updateNode(rotatableReference.id, {
            rotation: [
              rotatableReference.rotation[0],
              steppedRotation(rotatableReference.rotation[1], 1),
              rotatableReference.rotation[2],
            ],
          })
          sfxEmitter.emit('sfx:item-rotate')
          return
        }
        const selectedNodeIds = useViewer.getState().selection.selectedIds as AnyNodeId[]
        if (selectedNodeIds.length === 1) {
          const node = useScene.getState().nodes[selectedNodeIds[0]!]
          if (node?.type === 'door') {
            e.preventDefault()
            useScene.getState().updateNode(node.id, {
              side: node.side === 'front' ? 'back' : 'front',
              rotation: [node.rotation[0], node.rotation[1] + Math.PI, node.rotation[2]],
            })
            if (node.parentId) {
              useScene.getState().dirtyNodes.add(node.parentId as AnyNodeId)
            }
            sfxEmitter.emit('sfx:item-rotate')
          } else if (node?.type === 'window') {
            // Windows: R flips side (front ↔ back, rotation += π). Open/
            // close toggle for operable windows lives on E.
            e.preventDefault()
            useScene.getState().updateNode(node.id, {
              side: node.side === 'front' ? 'back' : 'front',
              rotation: [node.rotation[0], node.rotation[1] + Math.PI, node.rotation[2]],
            })
            if (node.parentId) {
              useScene.getState().dirtyNodes.add(node.parentId as AnyNodeId)
            }
            sfxEmitter.emit('sfx:item-rotate')
          } else if (node && nodeRegistry.get(node.type)?.keyboardActions?.r?.appliesTo(node)) {
            // Registry-driven R action. Skylight uses this for open/
            // close toggling; future kinds with custom R behaviour
            // declare it on their `def.keyboardActions` without
            // touching this hook. Door / window still use the legacy
            // direct calls above (follow-up to migrate).
            e.preventDefault()
            nodeRegistry.get(node.type)?.keyboardActions?.r?.run(node)
            sfxEmitter.emit('sfx:item-rotate')
          } else if (node && 'rotation' in node) {
            e.preventDefault()
            // Round to the nearest 45° then step one increment (not a blind +45°).
            if (typeof node.rotation === 'number') {
              useScene
                .getState()
                .updateNode(node.id, { rotation: steppedRotation(node.rotation, 1) })
            } else if (Array.isArray(node.rotation)) {
              useScene.getState().updateNode(node.id, {
                rotation: [
                  node.rotation[0],
                  steppedRotation(node.rotation[1], 1),
                  node.rotation[2],
                ],
              })
            }
            sfxEmitter.emit('sfx:item-rotate')
          }
        }
      } else if ((e.key === 't' || e.key === 'T') && !isVersionPreviewMode && !isPlacingOpening()) {
        // Rotate selected node counter-clockwise
        // Multi-selection → group rotate, mirroring the R arm above.
        if (rotateGroupSelection(-1)) {
          e.preventDefault()
          return
        }
        const rotatableReference = getRotatableSelectedReference()
        if (rotatableReference) {
          e.preventDefault()
          useScene.getState().updateNode(rotatableReference.id, {
            rotation: [
              rotatableReference.rotation[0],
              steppedRotation(rotatableReference.rotation[1], -1),
              rotatableReference.rotation[2],
            ],
          })
          sfxEmitter.emit('sfx:item-rotate')
          return
        }
        const selectedNodeIds = useViewer.getState().selection.selectedIds as AnyNodeId[]
        if (selectedNodeIds.length === 1) {
          const node = useScene.getState().nodes[selectedNodeIds[0]!]
          if (node?.type === 'door') {
            // Door's open/close moved to E; T is a no-op for doors so
            // it doesn't free-rotate a wall-bound node by π/4.
            e.preventDefault()
          } else if (node?.type === 'window') {
            // Window's open/close moved to E; T is a no-op so it doesn't
            // free-rotate a wall-bound node by π/4.
            e.preventDefault()
          } else if (node && nodeRegistry.get(node.type)?.keyboardActions?.t?.appliesTo(node)) {
            // Registry-driven T action. Same shape as the R arm above.
            e.preventDefault()
            nodeRegistry.get(node.type)?.keyboardActions?.t?.run(node)
            sfxEmitter.emit('sfx:item-rotate')
          } else if (node && 'rotation' in node) {
            e.preventDefault()
            // Round to the nearest 45° then step one increment back.
            if (typeof node.rotation === 'number') {
              useScene
                .getState()
                .updateNode(node.id, { rotation: steppedRotation(node.rotation, -1) })
            } else if (Array.isArray(node.rotation)) {
              useScene.getState().updateNode(node.id, {
                rotation: [
                  node.rotation[0],
                  steppedRotation(node.rotation[1], -1),
                  node.rotation[2],
                ],
              })
            }
            sfxEmitter.emit('sfx:item-rotate')
          }
        }
      } else if ((e.key === 'e' || e.key === 'E') && !isVersionPreviewMode) {
        // Toggle door / operable-window open/closed state. Moved off R,
        // which now flips the opening (side + π rotation).
        const selectedNodeIds = useViewer.getState().selection.selectedIds as AnyNodeId[]
        if (selectedNodeIds.length === 1) {
          const node = useScene.getState().nodes[selectedNodeIds[0]!]
          if (node?.type === 'door' && node.openingKind !== 'opening') {
            e.preventDefault()
            toggleDoorOpenState(node.id)
            sfxEmitter.emit('sfx:item-rotate')
          } else if (
            node?.type === 'window' &&
            node.openingKind !== 'opening' &&
            (node.windowType === 'sliding' ||
              node.windowType === 'casement' ||
              node.windowType === 'awning' ||
              node.windowType === 'hopper' ||
              node.windowType === 'single-hung' ||
              node.windowType === 'double-hung' ||
              node.windowType === 'louvered')
          ) {
            e.preventDefault()
            toggleWindowOpenState(node.id)
            sfxEmitter.emit('sfx:item-rotate')
          }
        }
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !isVersionPreviewMode) {
        e.preventDefault()

        // Check for a selected reference (guide/scan) first
        const selectedRefId = useEditor.getState().selectedReferenceId
        if (selectedRefId) {
          const refNode = useScene.getState().nodes[selectedRefId as AnyNodeId]
          if (refNode && (refNode.type === 'guide' || refNode.type === 'scan')) {
            sfxEmitter.emit('sfx:structure-delete')
            useScene.getState().deleteNode(selectedRefId as AnyNodeId)
            useEditor.getState().setSelectedReferenceId(null)
            return
          }
        }

        const selectedNodeIds = useViewer.getState().selection.selectedIds as AnyNodeId[]

        if (selectedNodeIds.length > 0) {
          // Guard against accidental bulk deletion (e.g. box-select all + Delete)
          const BULK_DELETE_THRESHOLD = 10
          if (selectedNodeIds.length >= BULK_DELETE_THRESHOLD) {
            const confirmed = window.confirm(
              `Delete ${selectedNodeIds.length} selected elements? This cannot be undone if the undo history is exhausted.`,
            )
            if (!confirmed) return
          }

          // Play appropriate SFX based on what's being deleted
          if (selectedNodeIds.length === 1) {
            const node = useScene.getState().nodes[selectedNodeIds[0]!]
            emitDeleteSFX(node?.type)
          } else {
            sfxEmitter.emit('sfx:structure-delete')
          }

          useScene.getState().deleteNodes(selectedNodeIds)
          return
        }

        // Delete selected zone when no explicit element selection is active.
        const selectedZoneId = useViewer.getState().selection.zoneId
        if (selectedZoneId) {
          sfxEmitter.emit('sfx:structure-delete')
          useScene.getState().deleteNode(selectedZoneId as AnyNodeId)
          useViewer.getState().setSelection({ zoneId: null })
        }
      }
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') {
        const wasClean = ctrlTapClean
        ctrlTapClean = false
        if (!wasClean) return
        // Same scope as the Shift snapping-mode cycle, and never while typing
        // in an input.
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
          return
        }
        if (!isSnappingCycleContext()) return
        // Cycle the grid / measurement step (0.5 → 0.25 → 0.1 → 0.05).
        useEditor.getState().cycleGridSnapStep()
        sfxEmitter.emit('sfx:grid-snap')
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [disabled, isVersionPreviewMode])

  return null
}
