'use client'

import {
  type AnyNode,
  emitter,
  type GuideNode,
  loadAssetUrl,
  saveAsset,
  type ScanNode,
  useScene,
} from '@pascal-app/core'
import { Eye, EyeOff, LocateFixed, Lock, RotateCcw, Ruler, Trash2, Unlock, Upload } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getGuideImageName } from '../../../lib/local-guide-image'
import useEditor from '../../../store/use-editor'
import { ActionButton, ActionGroup } from '../controls/action-button'
import { PanelSection } from '../controls/panel-section'
import { SliderControl } from '../controls/slider-control'
import { PanelWrapper } from './panel-wrapper'

type ReferenceNode = ScanNode | GuideNode

function getScaleStatus(guide: GuideNode, scaleReferenceVisible: boolean) {
  const reference = guide.scaleReference
  if (!reference) {
    return 'Uncalibrated'
  }

  return `${scaleReferenceVisible ? 'Scaled' : 'Scaled (hidden)'} · ${reference.label}`
}

export function ReferencePanel() {
  const selectedReferenceId = useEditor((s) => s.selectedReferenceId)
  const setSelectedReferenceId = useEditor((s) => s.setSelectedReferenceId)
  const guideUi = useEditor((s) => (selectedReferenceId ? s.guideUi[selectedReferenceId] : undefined))
  const setGuideLocked = useEditor((s) => s.setGuideLocked)
  const setGuideScaleReferenceVisible = useEditor((s) => s.setGuideScaleReferenceVisible)
  const clearGuideUi = useEditor((s) => s.clearGuideUi)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const [isReplacing, setIsReplacing] = useState(false)
  const [replaceError, setReplaceError] = useState<string | null>(null)
  const [isAssetMissing, setIsAssetMissing] = useState(false)

  const node = useScene((s) =>
    selectedReferenceId
      ? (s.nodes[selectedReferenceId as AnyNode['id']] as ReferenceNode | undefined)
      : undefined,
  )

  const handleUpdate = useCallback(
    (updates: Partial<ReferenceNode>) => {
      if (!selectedReferenceId) return
      updateNode(selectedReferenceId as AnyNode['id'], updates)
    },
    [selectedReferenceId, updateNode],
  )

  const handleClose = useCallback(() => {
    setSelectedReferenceId(null)
  }, [setSelectedReferenceId])

  const handleReplaceFile = useCallback(
    async (file: File) => {
      if (!(selectedReferenceId && node?.type === 'guide')) {
        return
      }

      if (!file.type.startsWith('image/')) {
        setReplaceError('Choose a PNG, JPEG, or WebP image.')
        return
      }

      setIsReplacing(true)
      setReplaceError(null)

      try {
        const assetUrl = await saveAsset(file)
        updateNode(selectedReferenceId as AnyNode['id'], {
          name: getGuideImageName(file.name),
          url: assetUrl,
          scaleReference: null,
        } as Partial<GuideNode>)
        setGuideScaleReferenceVisible(selectedReferenceId, true)
      } catch {
        setReplaceError('Could not replace that image.')
      } finally {
        setIsReplacing(false)
      }
    },
    [node?.type, selectedReferenceId, setGuideScaleReferenceVisible, updateNode],
  )

  const handleDeleteGuide = useCallback(() => {
    if (!(selectedReferenceId && node?.type === 'guide')) {
      return
    }

    deleteNode(selectedReferenceId as AnyNode['id'])
    emitter.emit('guide:deleted', { guideId: selectedReferenceId as GuideNode['id'] })
    clearGuideUi(selectedReferenceId)
    setSelectedReferenceId(null)
  }, [clearGuideUi, deleteNode, node?.type, selectedReferenceId, setSelectedReferenceId])

  const handleStartScale = useCallback(() => {
    if (node?.type !== 'guide') {
      return
    }

    emitter.emit('guide:set-reference-scale', { guideId: node.id })
  }, [node])

  const handleCancelScale = useCallback(() => {
    emitter.emit('guide:cancel-reference-scale')
  }, [])

  useEffect(() => {
    if (node?.type !== 'guide' || !node.url.startsWith('asset://')) {
      setIsAssetMissing(false)
      return
    }

    let cancelled = false
    loadAssetUrl(node.url).then((resolvedUrl) => {
      if (!cancelled) {
        setIsAssetMissing(!resolvedUrl)
      }
    })

    return () => {
      cancelled = true
    }
  }, [node])

  if (!node || (node.type !== 'scan' && node.type !== 'guide')) return null

  const isScan = node.type === 'scan'
  const guideLocked = !isScan && guideUi?.locked === true
  const scaleReferenceVisible = !isScan && guideUi?.scaleReferenceVisible !== false
  const scaleStatus = !isScan ? getScaleStatus(node, scaleReferenceVisible) : null

  return (
    <PanelWrapper
      onClose={handleClose}
      title={node.name || (isScan ? '3D Scan' : 'Guide Image')}
      width={300}
    >
      {!isScan && (
        <>
          <PanelSection title="Image">
            <input
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                event.currentTarget.value = ''
                if (file) {
                  void handleReplaceFile(file)
                }
              }}
              ref={replaceInputRef}
              type="file"
            />

            <ActionGroup>
              <ActionButton
                icon={<Upload className="h-3.5 w-3.5" />}
                label={isReplacing ? 'Replacing...' : 'Replace'}
                onClick={() => replaceInputRef.current?.click()}
                disabled={isReplacing}
              />
              <ActionButton
                icon={<Trash2 className="h-3.5 w-3.5" />}
                label="Delete"
                onClick={handleDeleteGuide}
                className="text-destructive hover:bg-destructive/10"
              />
            </ActionGroup>

            <ActionGroup>
              <ActionButton
                icon={
                  node.visible === false ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )
                }
                label={node.visible === false ? 'Show' : 'Hide'}
                onClick={() => handleUpdate({ visible: node.visible === false })}
              />
              <ActionButton
                icon={
                  guideLocked ? (
                    <Lock className="h-3.5 w-3.5" />
                  ) : (
                    <Unlock className="h-3.5 w-3.5" />
                  )
                }
                label={guideLocked ? 'Unlock' : 'Lock'}
                onClick={() => setGuideLocked(node.id, !guideLocked)}
              />
            </ActionGroup>

            {replaceError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-destructive text-xs">
                {replaceError}
              </div>
            )}

            {isAssetMissing && (
              <div className="rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-1.5 text-amber-700 text-xs dark:text-amber-300">
                Overlay image unavailable. Replace the image to restore it.
              </div>
            )}
          </PanelSection>

          <PanelSection title="Reference Scale">
            <div className="flex items-center gap-2 rounded-md border border-border/50 bg-background/40 px-2.5 py-2 text-sm">
              <Ruler className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate text-muted-foreground">{scaleStatus}</span>
            </div>

            <ActionGroup>
              <ActionButton
                label={node.scaleReference ? 'Edit Scale' : 'Set Scale'}
                onClick={handleStartScale}
              />
              <ActionButton label="Cancel" onClick={handleCancelScale} />
            </ActionGroup>

            <ActionGroup>
              <ActionButton
                label={scaleReferenceVisible ? 'Hide Scale' : 'Show Scale'}
                disabled={!node.scaleReference}
                onClick={() => {
                  if (!node.scaleReference) return
                  setGuideScaleReferenceVisible(node.id, !scaleReferenceVisible)
                }}
              />
              <ActionButton
                label="Clear Scale"
                disabled={!node.scaleReference}
                onClick={() => handleUpdate({ scaleReference: null } as Partial<GuideNode>)}
              />
            </ActionGroup>
          </PanelSection>

          <PanelSection title="Quick Actions">
            <ActionGroup>
              <ActionButton
                icon={<LocateFixed className="h-3.5 w-3.5" />}
                label="Center"
                onClick={() =>
                  handleUpdate({
                    position: [0, node.position[1], 0],
                  } as Partial<GuideNode>)
                }
              />
              <ActionButton
                icon={<RotateCcw className="h-3.5 w-3.5" />}
                label="Reset Rotation"
                onClick={() =>
                  handleUpdate({
                    rotation: [node.rotation[0], 0, node.rotation[2]],
                  } as Partial<GuideNode>)
                }
              />
            </ActionGroup>
            <ActionGroup>
              <ActionButton
                icon={<Ruler className="h-3.5 w-3.5" />}
                label="Reset Image Scale"
                onClick={() => handleUpdate({ scale: 1 } as Partial<GuideNode>)}
              />
            </ActionGroup>
          </PanelSection>
        </>
      )}

      <PanelSection title="Position">
        <SliderControl
          label={
            <>
              X<sub className="ml-[1px] text-[11px] opacity-70">pos</sub>
            </>
          }
          max={50}
          min={-50}
          onChange={(value) => {
            const pos = [...node.position] as [number, number, number]
            pos[0] = value
            handleUpdate({ position: pos })
          }}
          precision={2}
          step={0.1}
          unit="m"
          value={Math.round(node.position[0] * 100) / 100}
        />
        <SliderControl
          label={
            <>
              Y<sub className="ml-[1px] text-[11px] opacity-70">pos</sub>
            </>
          }
          max={50}
          min={-50}
          onChange={(value) => {
            const pos = [...node.position] as [number, number, number]
            pos[1] = value
            handleUpdate({ position: pos })
          }}
          precision={2}
          step={0.1}
          unit="m"
          value={Math.round(node.position[1] * 100) / 100}
        />
        <SliderControl
          label={
            <>
              Z<sub className="ml-[1px] text-[11px] opacity-70">pos</sub>
            </>
          }
          max={50}
          min={-50}
          onChange={(value) => {
            const pos = [...node.position] as [number, number, number]
            pos[2] = value
            handleUpdate({ position: pos })
          }}
          precision={2}
          step={0.1}
          unit="m"
          value={Math.round(node.position[2] * 100) / 100}
        />
      </PanelSection>

      <PanelSection title="Rotation">
        <SliderControl
          label={
            <>
              Y<sub className="ml-[1px] text-[11px] opacity-70">rot</sub>
            </>
          }
          max={180}
          min={-180}
          onChange={(degrees) => {
            const radians = (degrees * Math.PI) / 180
            handleUpdate({
              rotation: [node.rotation[0], radians, node.rotation[2]],
            })
          }}
          precision={0}
          step={1}
          unit="°"
          value={Math.round((node.rotation[1] * 180) / Math.PI)}
        />
        <div className="flex gap-1.5 px-1 pt-2 pb-1">
          <ActionButton
            label="-45°"
            onClick={() =>
              handleUpdate({
                rotation: [node.rotation[0], node.rotation[1] - Math.PI / 4, node.rotation[2]],
              })
            }
          />
          <ActionButton
            label="+45°"
            onClick={() =>
              handleUpdate({
                rotation: [node.rotation[0], node.rotation[1] + Math.PI / 4, node.rotation[2]],
              })
            }
          />
        </div>
      </PanelSection>

      <PanelSection title="Scale & Opacity">
        <SliderControl
          label={
            <>
              XYZ<sub className="ml-[1px] text-[11px] opacity-70">scale</sub>
            </>
          }
          max={10}
          min={0.01}
          onChange={(value) => {
            if (value > 0) {
              handleUpdate({ scale: value })
            }
          }}
          precision={2}
          step={0.1}
          value={Math.round(node.scale * 100) / 100}
        />

        <SliderControl
          label="Opacity"
          max={100}
          min={0}
          onChange={(v) => handleUpdate({ opacity: v })}
          precision={0}
          step={1}
          unit="%"
          value={node.opacity}
        />
      </PanelSection>
    </PanelWrapper>
  )
}
