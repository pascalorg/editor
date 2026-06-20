import type { ProcessLinePlan, ProcessStationPlan } from './process-line-types'

export type ProcessDisplayLocale = 'en-US' | 'zh-CN'

const CJK_TEXT_RE = /[\u3400-\u9fff]/

const PROCESS_LABELS_ZH: Record<string, string> = {
  cement_plant_full: '\u6c34\u6ce5\u5de5\u5382',
  cement_clinker_production_line: '\u6c34\u6ce5\u719f\u6599\u4ea7\u7ebf',
  water_electrolysis_hydrogen: '\u7535\u89e3\u6c34\u5236\u6c22\u8f66\u95f4',
}

const STATION_LABELS_ZH: Record<string, string> = {
  bag_filter: '\u7a91\u5c3e\u888b\u6536\u5c18\u5668',
  cement_mill: '\u6c34\u6ce5\u78e8',
  cement_packer: '\u6c34\u6ce5\u5305\u88c5\u673a',
  cement_silo: '\u6c34\u6ce5\u5e93',
  clinker_conveying: '\u719f\u6599\u8f93\u9001',
  clinker_crusher: '\u719f\u6599\u7834\u788e\u673a',
  clinker_silo: '\u719f\u6599\u5e93',
  coal_mill: '\u7164\u78e8',
  control_and_safety: '\u63a7\u5236\u4e0e\u5b89\u5168\u76d1\u6d4b',
  cooling_loop: '\u51b7\u5374\u6c34\u56de\u8def',
  dc_power_supply: '\u76f4\u6d41\u7535\u6e90',
  electrolyzer: '\u7535\u89e3\u69fd\u7ec4',
  grate_cooler: '\u7be6\u51b7\u673a',
  hydrogen_buffer: '\u6c22\u6c14\u5e72\u71e5\u7f13\u51b2\u7f50',
  hydrogen_separator: '\u6c22\u6c14\u6c14\u6db2\u5206\u79bb\u5668',
  kiln_burner: '\u7a91\u5934\u71c3\u70e7\u5668',
  kiln_hood: '\u7a91\u5934\u7f69',
  kiln_tail_esp: '\u7a91\u5c3e\u7535\u6536\u5c18',
  limestone_crusher: '\u77f3\u7070\u77f3\u7834\u788e\u673a',
  mcc_control: 'MCC\u63a7\u5236\u67dc',
  oxygen_separator: '\u6c27\u6c14\u6c14\u6db2\u5206\u79bb\u5668',
  pre_homogenization: '\u5806\u53d6\u6599\u673a',
  preheater_tower: '\u9884\u70ed\u5668\u5854',
  process_stack: '\u70df\u56f1',
  raw_meal_silo: '\u751f\u6599\u5747\u5316\u5e93',
  raw_mill: '\u539f\u6599\u78e8',
  raw_meal_feed: '\u751f\u6599\u5582\u6599',
  rotary_kiln: '\u56de\u8f6c\u7a91',
  tertiary_air_duct: '\u4e09\u6b21\u98ce\u7ba1',
  water_treatment: '\u7eaf\u6c34\u5904\u7406',
  whr_boiler: '\u4f59\u70ed\u9505\u7089',
}

export function containsCjkText(value: unknown): value is string {
  return typeof value === 'string' && CJK_TEXT_RE.test(value)
}

export function detectProcessDisplayLocale(prompt: string): ProcessDisplayLocale {
  return containsCjkText(prompt) ? 'zh-CN' : 'en-US'
}

export function processDisplayLabel(
  plan: Pick<ProcessLinePlan, 'processDisplayLabel' | 'processId' | 'processLabel'>,
) {
  return plan.processDisplayLabel ?? plan.processLabel
}

export function stationDisplayLabel(station: Pick<ProcessStationPlan, 'displayLabel' | 'label'>) {
  return station.displayLabel ?? station.label
}

export function localizeProcessLinePlan(plan: ProcessLinePlan, prompt: string): ProcessLinePlan {
  const locale = detectProcessDisplayLocale(prompt)
  if (locale !== 'zh-CN') return plan

  const processDisplayName =
    plan.processDisplayLabel ??
    (plan.processId ? PROCESS_LABELS_ZH[plan.processId] : undefined) ??
    (containsCjkText(plan.processLabel) ? plan.processLabel : undefined)

  return {
    ...plan,
    processDisplayLabel: processDisplayName,
    stations: plan.stations.map((station) => ({
      ...station,
      displayLabel:
        station.displayLabel ??
        STATION_LABELS_ZH[station.id] ??
        (containsCjkText(station.label) ? station.label : undefined),
    })),
  }
}
