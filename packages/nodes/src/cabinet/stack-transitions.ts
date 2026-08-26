import type {
  CabinetModuleNode as CabinetModuleNodeType,
  CabinetNode as CabinetNodeType,
} from '@pascal-app/core'
import { CABINET_METRIC_DEFAULTS } from '@pascal-app/core'
import { resolveCabinetType } from './run-ops'
import {
  type CabinetCompartment,
  type CabinetCooktopCompartmentType,
  type CabinetFridgeCompartmentType,
  type CabinetHoodCompartmentType,
  COOKTOP_STANDARD_WIDTH,
  cooktopCabinetStack,
  DISHWASHER_STANDARD_WIDTH,
  FRIDGE_COLUMN_HEIGHT,
  FRIDGE_COLUMN_WIDTH,
  FRIDGE_WIDE_WIDTH,
  fridgeCabinetStack,
  hoodCompartmentHeight,
  isCooktopCompartmentType,
  isFridgeCompartmentType,
  isHoodCompartmentType,
  MICROWAVE_STANDARD_WIDTH,
  OVEN_STANDARD_WIDTH,
  PULL_OUT_PANTRY_STANDARD_WIDTH,
  replaceCabinetCompartmentStack,
  SINK_STANDARD_WIDTH,
  sinkCabinetStack,
  stackForCabinet,
  TALL_CABINET_CARCASS_HEIGHT,
} from './stack'

const BASE_MODULE_WIDTH = 0.5
const BASE_CARCASS_HEIGHT = CABINET_METRIC_DEFAULTS.carcassHeight
const WALL_CARCASS_HEIGHT = CABINET_METRIC_DEFAULTS.carcassHeight
const TALL_CARCASS_HEIGHT = TALL_CABINET_CARCASS_HEIGHT

export function resolveCompartmentTransition({
  node,
  parentRun,
  index,
  next,
}: {
  node: CabinetNodeType | CabinetModuleNodeType
  parentRun: CabinetNodeType | undefined
  index: number
  next: CabinetCompartment
}): { stack: CabinetCompartment[]; modulePatch: Partial<CabinetModuleNodeType> } {
  const stack = stackForCabinet(node)
  const current = stack[index]
  const leavingFridge = current ? isFridgeCompartmentType(current.type) : false
  const enteringFridge = isFridgeCompartmentType(next.type)
  const enteringCooktop = isCooktopCompartmentType(next.type)
  const enteringSink = next.type === 'sink'
  const leavingPullOutPantry = current?.type === 'pull-out-pantry'
  const enteringPullOutPantry = next.type === 'pull-out-pantry'
  const leavingHood = current ? isHoodCompartmentType(current.type) : false
  const enteringHood = isHoodCompartmentType(next.type)
  const leavingFixedModuleForStandardStorage =
    (leavingFridge || leavingPullOutPantry || leavingHood) &&
    (next.type === 'shelf' || next.type === 'drawer' || next.type === 'door')
  const enteringDishwasher = next.type === 'dishwasher'
  const dishwasherHeight = parentRun?.carcassHeight ?? BASE_CARCASS_HEIGHT
  const replacement = enteringDishwasher ? { ...next, height: dishwasherHeight } : next
  const hoodModulePatch: Partial<CabinetModuleNodeType> = enteringHood
    ? {
        carcassHeight: Math.max(
          0.4,
          hoodCompartmentHeight(next.type as CabinetHoodCompartmentType),
        ),
        countertopThickness: 0,
        countertopOverhang: 0,
        showPlinth: false,
        withCountertop: false,
      }
    : leavingHood
      ? { carcassHeight: WALL_CARCASS_HEIGHT }
      : {}
  const tallApplianceModulePatch: Partial<CabinetModuleNodeType> =
    enteringFridge || enteringPullOutPantry
      ? {
          cabinetType: 'tall',
          width: enteringPullOutPantry
            ? PULL_OUT_PANTRY_STANDARD_WIDTH
            : next.type === 'fridge-double'
              ? FRIDGE_WIDE_WIDTH
              : FRIDGE_COLUMN_WIDTH,
          depth: parentRun?.depth ?? CABINET_METRIC_DEFAULTS.depth,
          carcassHeight: enteringFridge ? FRIDGE_COLUMN_HEIGHT : TALL_CARCASS_HEIGHT,
          plinthHeight: CABINET_METRIC_DEFAULTS.plinthHeight,
          toeKickDepth: 0.075,
          countertopThickness: 0,
          countertopOverhang: parentRun?.countertopOverhang ?? 0.02,
          showPlinth: false,
          withCountertop: false,
        }
      : {}
  const standardModulePatch: Partial<CabinetModuleNodeType> =
    (leavingFridge || leavingPullOutPantry) && !enteringFridge && !enteringPullOutPantry
      ? {
          cabinetType: 'base',
          width:
            next.type === 'microwave'
              ? MICROWAVE_STANDARD_WIDTH
              : next.type === 'dishwasher'
                ? DISHWASHER_STANDARD_WIDTH
                : enteringCooktop
                  ? COOKTOP_STANDARD_WIDTH
                  : BASE_MODULE_WIDTH,
          depth: parentRun?.depth ?? CABINET_METRIC_DEFAULTS.depth,
          carcassHeight: parentRun?.carcassHeight ?? BASE_CARCASS_HEIGHT,
          plinthHeight: parentRun?.plinthHeight ?? CABINET_METRIC_DEFAULTS.plinthHeight,
          toeKickDepth: parentRun?.toeKickDepth ?? 0.075,
          countertopThickness: 0,
          countertopOverhang: parentRun?.countertopOverhang ?? 0.02,
          showPlinth: false,
          withCountertop: false,
        }
      : {}
  const dishwasherModulePatch: Partial<CabinetModuleNodeType> = enteringDishwasher
    ? {
        cabinetType: 'base',
        width: DISHWASHER_STANDARD_WIDTH,
        depth: parentRun?.depth ?? CABINET_METRIC_DEFAULTS.depth,
        carcassHeight: dishwasherHeight,
        plinthHeight: parentRun?.plinthHeight ?? CABINET_METRIC_DEFAULTS.plinthHeight,
        toeKickDepth: parentRun?.toeKickDepth ?? 0.075,
        countertopThickness: 0,
        countertopOverhang: parentRun?.countertopOverhang ?? 0.02,
        showPlinth: false,
        withCountertop: false,
      }
    : {}

  return {
    stack: enteringFridge
      ? fridgeCabinetStack(next.type as CabinetFridgeCompartmentType)
      : enteringDishwasher
        ? [replacement]
        : enteringCooktop && stack.length === 1
          ? cooktopCabinetStack(next.type as CabinetCooktopCompartmentType)
          : enteringSink && stack.length === 1
            ? sinkCabinetStack()
            : enteringPullOutPantry
              ? [{ ...next, height: TALL_CARCASS_HEIGHT }]
              : leavingFixedModuleForStandardStorage
                ? [next]
                : enteringHood
                  ? [next]
                  : replaceCabinetCompartmentStack(
                      node,
                      index,
                      replacement,
                      node.type === 'cabinet-module' &&
                        resolveCabinetType(node, parentRun) === 'base'
                        ? 'drawer'
                        : 'door',
                    ),
    modulePatch: {
      ...tallApplianceModulePatch,
      ...standardModulePatch,
      ...dishwasherModulePatch,
      ...hoodModulePatch,
      ...(next.type === 'oven' ? { width: OVEN_STANDARD_WIDTH } : {}),
      ...(next.type === 'microwave' ? { width: MICROWAVE_STANDARD_WIDTH } : {}),
      ...(next.type === 'dishwasher' ? { width: DISHWASHER_STANDARD_WIDTH } : {}),
      ...(enteringCooktop ? { width: COOKTOP_STANDARD_WIDTH } : {}),
      ...(enteringSink ? { width: SINK_STANDARD_WIDTH } : {}),
      ...(enteringPullOutPantry ? { width: PULL_OUT_PANTRY_STANDARD_WIDTH } : {}),
      ...(isFridgeCompartmentType(next.type) && next.type !== 'fridge-double'
        ? { width: FRIDGE_COLUMN_WIDTH }
        : {}),
      ...(next.type === 'fridge-double' ? { width: FRIDGE_WIDE_WIDTH } : {}),
    },
  }
}
