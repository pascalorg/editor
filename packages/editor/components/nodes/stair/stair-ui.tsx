'use client'

import { ArrowLeft, ArrowRight, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useShallow } from 'zustand/shallow'
import { useEditor } from '@/hooks/use-editor'
import { generateId } from '@/lib/scenegraph/schema/base'
import type { StairNode, StairSegmentNode } from '@/lib/scenegraph/schema/nodes/stair'
import { cn } from '@/lib/utils'

type AttachmentSide = 'front' | 'left' | 'right'
type SegmentType = 'stair' | 'landing'

export function StairUI() {
  const { addNode, deleteNode, updateNode, selectedNodeIds } = useEditor(
    useShallow((state) => ({
      addNode: state.addNode,
      deleteNode: state.deleteNode,
      updateNode: state.updateNode,
      selectedNodeIds: state.selectedNodeIds,
    })),
  )

  const node = useEditor((state) => {
    if (state.selectedNodeIds.length !== 1) return null
    const n = state.graph.getNodeById(state.selectedNodeIds[0] as any)?.data()
    return n?.type === 'stair' ? (n as StairNode) : null
  })

  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null)

  if (!node) return null

  const segments = node.children

  const addSegment = (type: SegmentType) => {
    const segmentData = {
      id: generateId('stairsegment'),
      type: 'stairsegment' as const,
      object: 'node' as const,
      segmentType: type,
      width: 1.0,
      length: type === 'landing' ? 1.0 : 3,
      height: type === 'landing' ? 0 : 2,
      stepCount: 10,
      attachmentSide: 'front' as const,
      fillToFloor: true,
      thickness: 0.25,
      parentId: null,
      visible: true,
      opacity: 100,
      metadata: {},
      name: 'Stair Segment',
    }

    // Add node (adds to beginning of children array)
    const id = addNode(segmentData, node.id)

    // Move the new segment to the end of the list
    const state = useEditor.getState()
    const freshParent = state.graph.getNodeById(node.id)?.data() as StairNode

    if (freshParent && freshParent.children.length > 1) {
      const children = [...freshParent.children]
      // Check if the first element is our new node
      if (children[0].id === id) {
        const first = children.shift()
        if (first) {
          children.push(first)
          updateNode(node.id, { children })
        }
      }
    }

    setSelectedSegmentId(id)
  }

  const updateSegment = (id: string, updates: Partial<StairSegmentNode>) => {
    updateNode(id, updates)
  }

  const removeSegment = (id: string) => {
    deleteNode(id)
    if (selectedSegmentId === id) setSelectedSegmentId(null)
  }

  const selectedSegment = segments.find((s) => s.id === selectedSegmentId)
  const selectedIndex = segments.findIndex((s) => s.id === selectedSegmentId)
  const prevSegment = selectedIndex > 0 ? segments[selectedIndex - 1] : null

  const getTurnIcon = (side: AttachmentSide) => {
    switch (side) {
      case 'front':
        return <ArrowUp className="h-4 w-4" />
      case 'left':
        return <ArrowLeft className="h-4 w-4" />
      case 'right':
        return <ArrowRight className="h-4 w-4" />
    }
  }

  return (
    <div className="pointer-events-auto fixed top-20 right-4 z-50 flex h-[calc(100vh-6rem)] w-80 flex-col overflow-hidden rounded-lg border border-border bg-background/95 shadow-xl backdrop-blur-md">
      <div className="flex items-center justify-between border-b p-4">
        <h1 className="font-bold text-foreground text-lg">Stair Designer</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-6">
          {/* Segment List */}
          <div className="space-y-2">
            <h2 className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
              Segments
            </h2>
            {segments.map((segment, index) => (
              <div
                className={cn(
                  'cursor-pointer rounded-lg border p-3 transition-all',
                  selectedSegmentId === segment.id
                    ? 'border-primary bg-primary/10 shadow-sm'
                    : 'border-border bg-card hover:border-primary/50',
                )}
                key={segment.id}
                onClick={() => setSelectedSegmentId(segment.id)}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-medium text-foreground">
                    {index + 1}. {segment.segmentType === 'stair' ? 'Stair' : 'Landing'}
                  </span>
                  <div className="flex gap-1">
                    {index > 0 && (
                      <div
                        className="rounded bg-muted p-1 text-muted-foreground"
                        title={`Attached to ${segment.attachmentSide}`}
                      >
                        {getTurnIcon(segment.attachmentSide)}
                      </div>
                    )}
                    <button
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeSegment(segment.id)
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="flex gap-2 text-muted-foreground text-xs">
                  <span>W: {segment.width}m</span>
                  <span>L: {segment.length}m</span>
                  {segment.segmentType === 'stair' && <span>H: {segment.height}m</span>}
                </div>
              </div>
            ))}
          </div>

          {/* Add Buttons */}
          <div className="grid grid-cols-2 gap-2">
            <button
              className="flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90"
              onClick={() => addSegment('stair')}
            >
              <Plus className="h-4 w-4" /> Add Stair
            </button>
            <button
              className="flex items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 font-medium text-foreground text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
              onClick={() => addSegment('landing')}
            >
              <Plus className="h-4 w-4" /> Add Landing
            </button>
          </div>

          <hr className="border-border" />

          {/* Properties Panel */}
          {selectedSegment ? (
            <div className="fade-in slide-in-from-left-4 animate-in space-y-4 duration-200">
              <h2 className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
                Properties
              </h2>

              {/* Attachment Side (Only for segments after the first one) */}
              {prevSegment && (
                <div className="space-y-1">
                  <label className="font-medium text-muted-foreground text-xs">Attach To</label>
                  <div className="grid grid-cols-3 gap-1">
                    {(['front', 'left', 'right'] as AttachmentSide[]).map((side) => {
                      const isDisabled = prevSegment.segmentType === 'stair' && side !== 'front'
                      if (isDisabled) return null

                      return (
                        <button
                          className={cn(
                            'flex flex-col items-center gap-1 rounded border p-2 text-xs transition-colors',
                            selectedSegment.attachmentSide === side
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border bg-card text-muted-foreground hover:bg-accent',
                          )}
                          key={side}
                          onClick={() =>
                            updateSegment(selectedSegment.id, { attachmentSide: side })
                          }
                        >
                          {getTurnIcon(side)}
                          <span className="capitalize">{side}</span>
                        </button>
                      )
                    })}
                  </div>
                  {prevSegment.segmentType === 'stair' && (
                    <p className="text-[10px] text-muted-foreground italic">
                      Stairs can only have segments attached to their end.
                    </p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="font-medium text-muted-foreground text-xs">Width (m)</label>
                  <input
                    className="w-full rounded border border-input bg-background p-2 text-foreground text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    onChange={(e) =>
                      updateSegment(selectedSegment.id, {
                        width: Number.parseFloat(e.target.value),
                      })
                    }
                    step="0.1"
                    type="number"
                    value={selectedSegment.width}
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-medium text-muted-foreground text-xs">Length (m)</label>
                  <input
                    className="w-full rounded border border-input bg-background p-2 text-foreground text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    onChange={(e) =>
                      updateSegment(selectedSegment.id, {
                        length: Number.parseFloat(e.target.value),
                      })
                    }
                    step="0.1"
                    type="number"
                    value={selectedSegment.length}
                  />
                </div>
              </div>

              {selectedSegment.segmentType === 'stair' && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="font-medium text-muted-foreground text-xs">
                        Height (m)
                      </label>
                      <input
                        className="w-full rounded border border-input bg-background p-2 text-foreground text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                        onChange={(e) =>
                          updateSegment(selectedSegment.id, {
                            height: Number.parseFloat(e.target.value),
                          })
                        }
                        step="0.1"
                        type="number"
                        value={selectedSegment.height}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-medium text-muted-foreground text-xs">Steps</label>
                      <input
                        className="w-full rounded border border-input bg-background p-2 text-foreground text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                        min="1"
                        onChange={(e) =>
                          updateSegment(selectedSegment.id, {
                            stepCount: Number.parseInt(e.target.value, 10),
                          })
                        }
                        type="number"
                        value={selectedSegment.stepCount}
                      />
                    </div>
                  </div>
                </>
              )}

              <div className="space-y-3 border-border border-t pt-2">
                <div className="flex items-center justify-between">
                  <label className="font-medium text-muted-foreground text-xs">Fill to Floor</label>
                  <button
                    className={cn(
                      'relative h-5 w-10 rounded-full transition-colors',
                      selectedSegment.fillToFloor ? 'bg-primary' : 'bg-muted',
                    )}
                    onClick={() =>
                      updateSegment(selectedSegment.id, {
                        fillToFloor: !selectedSegment.fillToFloor,
                      })
                    }
                  >
                    <div
                      className={cn(
                        'absolute top-1 h-3 w-3 rounded-full bg-background transition-transform',
                        selectedSegment.fillToFloor ? 'left-6' : 'left-1',
                      )}
                    />
                  </button>
                </div>

                {!selectedSegment.fillToFloor && (
                  <div className="fade-in slide-in-from-top-1 animate-in space-y-1">
                    <label className="font-medium text-muted-foreground text-xs">
                      Thickness (m)
                    </label>
                    <input
                      className="w-full rounded border border-input bg-background p-2 text-foreground text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                      min="0.05"
                      onChange={(e) =>
                        updateSegment(selectedSegment.id, {
                          thickness: Number.parseFloat(e.target.value),
                        })
                      }
                      step="0.05"
                      type="number"
                      value={selectedSegment.thickness || 0.25}
                    />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="py-10 text-center text-muted-foreground text-sm">
              Select a segment to edit properties
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
