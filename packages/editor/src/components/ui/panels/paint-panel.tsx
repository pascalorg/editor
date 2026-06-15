'use client'

import useEditor from '../../../store/use-editor'
import { MaterialPropertiesEditor } from '../controls/material-properties-editor'
import { PanelSection } from '../controls/panel-section'
import { PanelWrapper } from './panel-wrapper'

export function PaintPanel() {
  const activePaintMaterial = useEditor((state) => state.activePaintMaterial)
  const activePaintTarget = useEditor((state) => state.activePaintTarget)
  const setActivePaintMaterial = useEditor((state) => state.setActivePaintMaterial)
  const setPaintPanelOpen = useEditor((state) => state.setPaintPanelOpen)

  const customMaterial =
    activePaintMaterial?.material?.properties && !activePaintMaterial.materialPreset
      ? activePaintMaterial.material
      : null

  if (!customMaterial) return null

  return (
    <PanelWrapper onClose={() => setPaintPanelOpen(false)} title="Material" width={320}>
      <PanelSection title="Custom material">
        <MaterialPropertiesEditor
          onChange={(material) =>
            setActivePaintMaterial({
              material,
              sourceTarget: activePaintMaterial?.sourceTarget ?? activePaintTarget,
            })
          }
          value={customMaterial}
        />
      </PanelSection>
    </PanelWrapper>
  )
}
