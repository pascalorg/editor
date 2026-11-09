'use client'

import {
  type AnyNode,
  type GuideNode,
  loadAssetUrl,
  type ScanNode,
  saveAsset,
  useLocale,
  useScene, usePascalI18n,
  type PascalI18n,
} from '@pascal-app/core'
import {
  Eye,
  EyeOff,
  LocateFixed,
  Lock,
  Move,
  RotateCcw,
  Ruler,
  Trash2,
  Unlock,
  Upload,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { guideEmitter } from '../../../lib/guide-events'
import { getGuideImageName } from '../../../lib/local-guide-image'
import { formatReferenceScaleLabel } from '../../../lib/reference-scale'
import { cn } from '../../../lib/utils'
import useEditor from '../../../store/use-editor'
import { isViewVisible, VIEW_2D } from '../../../store/view-layout'
import { ActionButton, ActionGroup } from '../controls/action-button'
import { PanelSection } from '../controls/panel-section'
import { SliderControl } from '../controls/slider-control'
import { PanelWrapper } from './panel-wrapper'

type ReferenceNode = ScanNode | GuideNode

function getScaleStatus(
  guide: GuideNode,
  scaleReferenceVisible: boolean,
  locale: string,
  i18n: PascalI18n,
) {
  const reference = guide.scaleReference
  if (!reference) {
    return i18n._({ id: 'editor.panels.referencePanel.uncalibrated', message: 'Uncalibrated' })
  }
  const scale = formatReferenceScaleLabel(reference, locale)
  return scaleReferenceVisible
    ? i18n._({ id: 'editor.panels.referencePanel.scaled', message: 'Scaled · {scale}', values: { scale } })
    : i18n._({
        id: 'editor.panels.referencePanel.scaledHidden',
        message: 'Scaled (hidden) · {scale}',
        values: { scale },
      })
}

export function ReferencePanel() {
  const i18n = usePascalI18n()
  const locale = useLocale()
  const selectedReferenceId = useEditor((s) => s.selectedReferenceId)
  const setSelectedReferenceId = useEditor((s) => s.setSelectedReferenceId)
  const guideUi = useEditor((s) =>
    selectedReferenceId ? s.guideUi[selectedReferenceId] : undefined,
  )
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
  const isScaleFlowActive = useEditor(
    (s) => s.referenceScaleActiveGuideId !== null && s.referenceScaleActiveGuideId === node?.id,
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
        updateNode(
          selectedReferenceId as AnyNode['id'],
          {
            name: getGuideImageName(file.name),
            url: assetUrl,
            scaleReference: null,
          } as Partial<GuideNode>,
        )
        setGuideScaleReferenceVisible(selectedReferenceId, true)
        // The new image starts uncalibrated — drop the calibration auto-lock
        // so it can be resized/rotated right away.
        setGuideLocked(selectedReferenceId, false)
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
    guideEmitter.emit('guide:deleted', { guideId: selectedReferenceId as GuideNode['id'] })
    clearGuideUi(selectedReferenceId)
    setSelectedReferenceId(null)
  }, [clearGuideUi, deleteNode, node?.type, selectedReferenceId, setSelectedReferenceId])

  const handleStartScale = useCallback(() => {
    if (node?.type !== 'guide') {
      return
    }

    // The scale line is drawn on the 2D plan — starting from a 3D-only view
    // would arm the flow invisibly inside the hidden floorplan panel.
    const editor = useEditor.getState()
    if (!isViewVisible(editor, VIEW_2D)) editor.showView(VIEW_2D)

    guideEmitter.emit('guide:set-reference-scale', { guideId: node.id })
  }, [node])

  const handleCancelScale = useCallback(() => {
    guideEmitter.emit('guide:cancel-reference-scale')
  }, [])

  const handleMoveScan = useCallback(() => {
    if (node?.type !== 'scan') return
    useEditor.getState().setMovingNode(node as never)
    setSelectedReferenceId(null)
  }, [node, setSelectedReferenceId])

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
  const scaleStatus = isScan ? null : getScaleStatus(node, scaleReferenceVisible, locale, i18n)

  return (
    <PanelWrapper
      onClose={handleClose}
      title={node.name || (isScan ? i18n._({ id: 'editor.panels.referencePanel.capture', message: 'Capture' }) : i18n._({ id: 'editor.panels.referencePanel.guideImage', message: 'Guide Image' }))}
      width={300}
    >
      {!isScan && (
        <>
          <PanelSection title={i18n._({ id: 'editor.panels.referencePanel.image', message: 'Image' })}>
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
                disabled={isReplacing}
                icon={<Upload className="h-3.5 w-3.5" />}
                label={isReplacing ? i18n._({ id: 'editor.panels.referencePanel.replacing', message: 'Replacing...' }) : i18n._({ id: 'editor.panels.referencePanel.replace', message: 'Replace' })}
                onClick={() => replaceInputRef.current?.click()}
              />
              <ActionButton
                className="text-destructive hover:bg-destructive/10"
                icon={<Trash2 className="h-3.5 w-3.5" />}
                label={i18n._({ id: 'editor.panels.referencePanel.delete', message: 'Delete' })}
                onClick={handleDeleteGuide}
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
                label={node.visible === false ? i18n._({ id: 'editor.panels.referencePanel.show', message: 'Show' }) : i18n._({ id: 'editor.panels.referencePanel.hide', message: 'Hide' })}
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
                label={guideLocked ? i18n._({ id: 'editor.panels.referencePanel.unlock', message: 'Unlock' }) : i18n._({ id: 'editor.panels.referencePanel.lock', message: 'Lock' })}
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
                {i18n._({ id: 'editor.panels.referencePanel.overlayImageUnavailableReplaceTheImage', message: 'Overlay image unavailable. Replace the image to restore it.' })}
              </div>
            )}
          </PanelSection>

          <PanelSection title={i18n._({ id: 'editor.panels.referencePanel.referenceScale', message: 'Reference Scale' })}>
            <div className="flex items-center gap-2 rounded-md border border-border/50 bg-background/40 px-2.5 py-2 text-sm">
              <Ruler
                className={cn(
                  'h-4 w-4 shrink-0',
                  node.scaleReference ? 'text-primary' : 'text-amber-600 dark:text-amber-400',
                )}
              />
              <span className="truncate text-muted-foreground">{scaleStatus}</span>
            </div>

            {!node.scaleReference && (
              <p className="px-0.5 text-muted-foreground text-xs leading-snug">
                {isScaleFlowActive
                  ? i18n._({ id: 'editor.panels.referencePanel.clickBothEndsOfAKnown', message: 'Click both ends of a known distance on the plan, then type its real length.' })
                  : i18n._({ id: 'editor.panels.referencePanel.drawALineOverAKnown', message: 'Draw a line over a known dimension on the plan, then type its real length to scale the image exactly.' })}
              </p>
            )}

            <ActionGroup>
              <ActionButton
                className={cn(
                  !node.scaleReference &&
                    !isScaleFlowActive &&
                    'border-primary/50 bg-primary/15 text-primary hover:bg-primary/25 active:bg-primary/25',
                )}
                label={
                  isScaleFlowActive ? i18n._({ id: 'editor.panels.referencePanel.cancel', message: 'Cancel' }) : node.scaleReference ? i18n._({ id: 'editor.panels.referencePanel.editScale', message: 'Edit Scale' }) : i18n._({ id: 'editor.panels.referencePanel.setScale', message: 'Set Scale' })
                }
                onClick={isScaleFlowActive ? handleCancelScale : handleStartScale}
              />
            </ActionGroup>

            {node.scaleReference && (
              <ActionGroup>
                <ActionButton
                  label={scaleReferenceVisible ? i18n._({ id: 'editor.panels.referencePanel.hideScale', message: 'Hide Scale' }) : i18n._({ id: 'editor.panels.referencePanel.showScale', message: 'Show Scale' })}
                  onClick={() => setGuideScaleReferenceVisible(node.id, !scaleReferenceVisible)}
                />
                <ActionButton
                  label={i18n._({ id: 'editor.panels.referencePanel.clearScale', message: 'Clear Scale' })}
                  onClick={() => {
                    handleUpdate({ scaleReference: null } as Partial<GuideNode>)
                    // Calibrating auto-locked the guide; clearing the scale
                    // returns it to a freely-editable reference.
                    setGuideLocked(node.id, false)
                  }}
                />
              </ActionGroup>
            )}
          </PanelSection>

          <PanelSection title={i18n._({ id: 'editor.panels.referencePanel.quickActions', message: 'Quick Actions' })}>
            <ActionGroup>
              <ActionButton
                icon={<LocateFixed className="h-3.5 w-3.5" />}
                label={i18n._({ id: 'editor.panels.referencePanel.center', message: 'Center' })}
                onClick={() =>
                  handleUpdate({
                    position: [0, node.position[1], 0],
                  } as Partial<GuideNode>)
                }
              />
              <ActionButton
                icon={<RotateCcw className="h-3.5 w-3.5" />}
                label={i18n._({ id: 'editor.panels.referencePanel.resetRotation', message: 'Reset Rotation' })}
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
                label={i18n._({ id: 'editor.panels.referencePanel.resetImageScale', message: 'Reset Image Scale' })}
                onClick={() => handleUpdate({ scale: 1 } as Partial<GuideNode>)}
              />
            </ActionGroup>
          </PanelSection>
        </>
      )}

      {isScan && (
        <PanelSection title={i18n._({ id: 'editor.panels.referencePanel.capture', message: 'Capture' })}>
          <ActionGroup>
            <ActionButton
              icon={<Move className="h-3.5 w-3.5" />}
              label={i18n._({ id: 'editor.panels.referencePanel.move', message: 'Move' })}
              onClick={handleMoveScan}
            />
            <ActionButton
              icon={
                node.visible === false ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )
              }
              label={node.visible === false ? i18n._({ id: 'editor.panels.referencePanel.show', message: 'Show' }) : i18n._({ id: 'editor.panels.referencePanel.hide', message: 'Hide' })}
              onClick={() => handleUpdate({ visible: node.visible === false })}
            />
          </ActionGroup>
        </PanelSection>
      )}

      <PanelSection title={i18n._({ id: 'editor.panels.referencePanel.position', message: 'Position' })}>
        <SliderControl
          label={
            <>
              X<sub className="ml-[1px] text-[11px] opacity-70">{i18n._({ id: 'editor.panels.referencePanel.pos', message: 'pos' })}</sub>
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
          value={node.position[0]}
        />
        <SliderControl
          label={
            <>
              Y<sub className="ml-[1px] text-[11px] opacity-70">{i18n._({ id: 'editor.panels.referencePanel.pos', message: 'pos' })}</sub>
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
          value={node.position[1]}
        />
        <SliderControl
          label={
            <>
              Z<sub className="ml-[1px] text-[11px] opacity-70">{i18n._({ id: 'editor.panels.referencePanel.pos', message: 'pos' })}</sub>
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
          value={node.position[2]}
        />
      </PanelSection>

      <PanelSection title={i18n._({ id: 'editor.panels.referencePanel.rotation', message: 'Rotation' })}>
        <SliderControl
          label={
            <>
              Y<sub className="ml-[1px] text-[11px] opacity-70">{i18n._({ id: 'editor.panels.referencePanel.rot', message: 'rot' })}</sub>
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

      <PanelSection title={i18n._({ id: 'editor.panels.referencePanel.scaleOpacity', message: 'Scale & Opacity' })}>
        <SliderControl
          label={
            <>
              {i18n._({ id: 'editor.panels.referencePanel.xyz', message: 'XYZ' })}<sub className="ml-[1px] text-[11px] opacity-70">{i18n._({ id: 'editor.panels.referencePanel.scale', message: 'scale' })}</sub>
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
          label={i18n._({ id: 'editor.panels.referencePanel.opacity', message: 'Opacity' })}
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
