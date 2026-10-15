'use client'

import { PanelSection, SegmentedControl } from '@pascal-app/editor'
import {
  type CabinetCompartment,
  type CabinetCooktopCompartmentType,
  type CabinetFridgeCompartmentType,
  COOKTOP_DEFAULT_GAS_LAYOUT,
  COOKTOP_DEFAULT_INDUCTION_LAYOUT,
  compartmentDoorType,
  compartmentSinkLayout,
  isCooktopCompartmentType,
  isFridgeCompartmentType,
  patchCompartment,
} from './stack'

export function CabinetEssentialControls({
  stack,
  width,
  onReplace,
}: {
  stack: CabinetCompartment[]
  width: number
  onReplace: (index: number, next: CabinetCompartment) => void
}) {
  const entries = stack
    .map((part, index) => ({ part, index }))
    .filter(
      ({ part }) =>
        part.type === 'door' ||
        part.type === 'sink' ||
        isFridgeCompartmentType(part.type) ||
        isCooktopCompartmentType(part.type),
    )
  if (!entries.length) return null
  return (
    <PanelSection title="Item options">
      {entries.map(({ part, index }) => (
        <div key={part.id} className="space-y-2 pb-2">
          <div className="text-xs text-muted-foreground">
            {part.type === 'door'
              ? 'Door direction'
              : part.type === 'sink'
                ? 'Sink layout'
                : isFridgeCompartmentType(part.type)
                  ? 'Fridge type'
                  : 'Cooktop type'}
            {entries.length > 1 ? ` · ${index + 1}` : ''}
          </div>
          {part.type === 'door' && (
            <SegmentedControl
              value={compartmentDoorType(part, width)}
              options={[
                { value: 'single-left', label: 'Left hinge' },
                { value: 'single-right', label: 'Right hinge' },
                { value: 'double', label: 'Double' },
                { value: 'glass', label: 'Glass' },
              ]}
              onChange={(value) =>
                onReplace(
                  index,
                  patchCompartment(part, {
                    doorType: value as 'single-left' | 'single-right' | 'double' | 'glass',
                  }),
                )
              }
            />
          )}
          {part.type === 'sink' && (
            <SegmentedControl
              value={compartmentSinkLayout(part)}
              options={[
                { value: 'single', label: 'Single' },
                { value: 'double', label: 'Double' },
                { value: 'double-offset', label: '60/40' },
              ]}
              onChange={(value) =>
                onReplace(
                  index,
                  patchCompartment(part, {
                    sinkLayout: value as 'single' | 'double' | 'double-offset',
                  }),
                )
              }
            />
          )}
          {isFridgeCompartmentType(part.type) && (
            <SegmentedControl
              value={part.type}
              options={[
                { value: 'fridge-single', label: 'Single' },
                { value: 'fridge-double', label: 'Double' },
                { value: 'fridge-top-freezer', label: 'Top freezer' },
                { value: 'fridge-bottom-freezer', label: 'Bottom freezer' },
              ]}
              onChange={(value) =>
                onReplace(
                  index,
                  patchCompartment(part, { type: value as CabinetFridgeCompartmentType }),
                )
              }
            />
          )}
          {isCooktopCompartmentType(part.type) && (
            <SegmentedControl
              value={part.type}
              options={[
                { value: 'cooktop-gas', label: 'Gas' },
                { value: 'cooktop-induction', label: 'Induction' },
              ]}
              onChange={(value) =>
                onReplace(
                  index,
                  patchCompartment(part, {
                    type: value as CabinetCooktopCompartmentType,
                    cooktopLayout:
                      value === 'cooktop-gas'
                        ? COOKTOP_DEFAULT_GAS_LAYOUT
                        : COOKTOP_DEFAULT_INDUCTION_LAYOUT,
                  }),
                )
              }
            />
          )}
        </div>
      ))}
    </PanelSection>
  )
}
