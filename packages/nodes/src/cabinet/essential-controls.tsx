'use client'

import { usePascalI18n } from '@pascal-app/core'
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
  const i18n = usePascalI18n()
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
    <PanelSection
      title={i18n._({ id: 'node.cabinet.essentialControls.itemOptions', message: 'Item options' })}
    >
      {entries.map(({ part, index }) => (
        <div key={part.id} className="space-y-2 pb-2">
          <div className="text-xs text-muted-foreground">
            {part.type === 'door'
              ? i18n._({
                  id: 'node.cabinet.essentialControls.doorDirection',
                  message: 'Door direction',
                })
              : part.type === 'sink'
                ? i18n._({
                    id: 'node.cabinet.essentialControls.sinkLayout',
                    message: 'Sink layout',
                  })
                : isFridgeCompartmentType(part.type)
                  ? i18n._({
                      id: 'node.cabinet.essentialControls.fridgeType',
                      message: 'Fridge type',
                    })
                  : i18n._({
                      id: 'node.cabinet.essentialControls.cooktopType',
                      message: 'Cooktop type',
                    })}
            {entries.length > 1 ? ` · ${index + 1}` : ''}
          </div>
          {part.type === 'door' && (
            <SegmentedControl
              value={compartmentDoorType(part, width)}
              options={[
                {
                  value: 'single-left',
                  label: i18n._({
                    id: 'node.cabinet.essentialControls.leftHinge',
                    message: 'Left hinge',
                  }),
                },
                {
                  value: 'single-right',
                  label: i18n._({
                    id: 'node.cabinet.essentialControls.rightHinge',
                    message: 'Right hinge',
                  }),
                },
                {
                  value: 'double',
                  label: i18n._({ id: 'node.cabinet.essentialControls.double', message: 'Double' }),
                },
                {
                  value: 'glass',
                  label: i18n._({ id: 'node.cabinet.essentialControls.glass', message: 'Glass' }),
                },
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
                {
                  value: 'single',
                  label: i18n._({ id: 'node.cabinet.essentialControls.single', message: 'Single' }),
                },
                {
                  value: 'double',
                  label: i18n._({ id: 'node.cabinet.essentialControls.double', message: 'Double' }),
                },
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
                {
                  value: 'fridge-single',
                  label: i18n._({ id: 'node.cabinet.essentialControls.single', message: 'Single' }),
                },
                {
                  value: 'fridge-double',
                  label: i18n._({ id: 'node.cabinet.essentialControls.double', message: 'Double' }),
                },
                {
                  value: 'fridge-top-freezer',
                  label: i18n._({
                    id: 'node.cabinet.essentialControls.topFreezer',
                    message: 'Top freezer',
                  }),
                },
                {
                  value: 'fridge-bottom-freezer',
                  label: i18n._({
                    id: 'node.cabinet.essentialControls.bottomFreezer',
                    message: 'Bottom freezer',
                  }),
                },
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
                {
                  value: 'cooktop-gas',
                  label: i18n._({ id: 'node.cabinet.essentialControls.gas', message: 'Gas' }),
                },
                {
                  value: 'cooktop-induction',
                  label: i18n._({
                    id: 'node.cabinet.essentialControls.induction',
                    message: 'Induction',
                  }),
                },
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
