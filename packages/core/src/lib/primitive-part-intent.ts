const FAMILY_TERMS =
  '(?:car|vehicle|truck|suv|sedan|automobile|auto|bicycle|bike|cycle|aircraft|airplane|plane|jet|pump|fan|robot|robot\\s+arm|machine|lathe|conveyor|tank|reactor|compressor)'

const FAMILY_QUALIFIED_COMPONENT_TERMS =
  '(?:steering\\s+wheel|wheel|tire|tyre|rim|hub|window|windshield|door|mirror|seat|dashboard|wiper|handle|headlight|taillight|tail\\s+light|bumper|wing|engine|propeller|blade|impeller|shaft|gear|bearing|flange|nozzle|port|valve|panel|guard|grille|belt|roller|motor|part|component|accessory|subpart)'

const FAMILY_QUALIFIED_COMPONENT_PATTERNS = [
  new RegExp(`\\b${FAMILY_TERMS}\\s+(?:${FAMILY_QUALIFIED_COMPONENT_TERMS})\\b`, 'i'),
  new RegExp(
    `\\b${FAMILY_QUALIFIED_COMPONENT_TERMS}\\s+(?:for|of)\\s+(?:a\\s+|an\\s+|the\\s+)?${FAMILY_TERMS}\\b`,
    'i',
  ),
  /\b(?:part|component|accessory|subpart)\s+(?:for|of)\s+(?:a\s+|an\s+|the\s+)?(?:car|vehicle|aircraft|pump|fan|robot|machine|conveyor|reactor|compressor)\b/i,
  /(?:\u6c7d\u8f66|\u8f66\u8f86|\u8f7f\u8f66|\u5361\u8f66|\u81ea\u884c\u8f66|\u5355\u8f66|\u98de\u673a|\u5ba2\u673a|\u6cf5|\u6c34\u6cf5|\u98ce\u6247|\u7535\u98ce\u6247|\u673a\u5668\u4eba|\u673a\u68b0\u81c2|\u673a\u5e8a|\u8f93\u9001\u673a|\u53cd\u5e94\u91dc|\u53cd\u5e94\u5668|\u538b\u7f29\u673a)(?:\u7684)?(?:\u65b9\u5411\u76d8|\u8f6e\u5b50|\u8f6e\u80ce|\u8f66\u8f6e|\u8f6e\u6bc2|\u8f66\u7a97|\u7a97\u6237|\u6321\u98ce\u73bb\u7483|\u8f66\u95e8|\u540e\u89c6\u955c|\u5ea7\u6905|\u4eea\u8868\u76d8|\u96e8\u5237|\u95e8\u628a\u624b|\u8f66\u706f|\u5927\u706f|\u5c3e\u706f|\u4fdd\u9669\u6760|\u673a\u7ffc|\u53d1\u52a8\u673a|\u87ba\u65cb\u6868|\u53f6\u7247|\u53f6\u8f6e|\u8f74|\u9f7f\u8f6e|\u8f74\u627f|\u6cd5\u5170|\u55b7\u5634|\u63a5\u53e3|\u7aef\u53e3|\u9600\u95e8|\u624b\u67c4|\u9762\u677f|\u62a4\u7f69|\u683c\u6805|\u76ae\u5e26|\u6eda\u7b52|\u7535\u673a|\u9a6c\u8fbe|\u96f6\u4ef6|\u90e8\u4ef6|\u914d\u4ef6)/,
]

const STANDALONE_COMPONENT_PATTERNS = [
  /\b(?:steering\s+wheel|wheel|tire|tyre|rim|hub|windshield|mirror|seat|dashboard|wiper|door\s+handle|handle|headlight|taillight|bumper|wing|propeller|blade|impeller|shaft|panel|guard|grille|belt|roller|component|accessory|subpart)\b/i,
  /(?:\u65b9\u5411\u76d8|\u8f6e\u5b50|\u8f6e\u80ce|\u8f66\u8f6e|\u8f6e\u6bc2|\u6321\u98ce\u73bb\u7483|\u540e\u89c6\u955c|\u5ea7\u6905|\u4eea\u8868\u76d8|\u96e8\u5237|\u95e8\u628a\u624b|\u8f66\u95e8|\u8f66\u7a97|\u7a97\u6237|\u8f66\u706f|\u5927\u706f|\u5c3e\u706f|\u4fdd\u9669\u6760|\u673a\u7ffc|\u87ba\u65cb\u6868|\u53f6\u7247|\u53f6\u8f6e|\u8f74|\u624b\u67c4|\u9762\u677f|\u62a4\u7f69|\u683c\u6805|\u76ae\u5e26|\u6eda\u7b52|\u96f6\u4ef6|\u90e8\u4ef6|\u914d\u4ef6)/,
]

const COMPLETE_OBJECT_PATTERNS = [
  /\b(?:whole|complete|entire|full)\s+(?:car|vehicle|truck|suv|sedan|aircraft|airplane|plane|pump|fan|robot|machine|conveyor|reactor|compressor)\b/i,
  /\b(?:make|create|generate|build)\s+(?:a\s+|an\s+|one\s+)(?:car|vehicle|truck|suv|sedan|aircraft|airplane|plane|pump|fan|robot|machine|conveyor|reactor|compressor)\b/i,
  /(?:\u5b8c\u6574|\u6574\u4e2a|\u6574\u53f0|\u6574\u8f86|\u4e00\u8f86|\u4e00\u53f0|\u4e00\u67b6)(?:\u6c7d\u8f66|\u8f66\u8f86|\u8f7f\u8f66|\u5361\u8f66|\u98de\u673a|\u5ba2\u673a|\u6cf5|\u6c34\u6cf5|\u98ce\u6247|\u7535\u98ce\u6247|\u673a\u5668\u4eba|\u673a\u68b0\u81c2|\u673a\u5e8a|\u8f93\u9001\u673a|\u53cd\u5e94\u91dc|\u53cd\u5e94\u5668|\u538b\u7f29\u673a)/,
]

function normalizedText(text: string): string {
  return text.trim().toLowerCase()
}

function hasCompleteObjectIntent(text: string): boolean {
  return COMPLETE_OBJECT_PATTERNS.some((pattern) => pattern.test(text))
}

function hasStandaloneComponentIntent(text: string): boolean {
  return STANDALONE_COMPONENT_PATTERNS.some((pattern) => pattern.test(text))
}

export function hasFamilyQualifiedPartIntent(text: string): boolean {
  const normalized = normalizedText(text)
  if (!normalized) return false
  return FAMILY_QUALIFIED_COMPONENT_PATTERNS.some((pattern) => pattern.test(normalized))
}

export function hasComponentPartIntent(text: string): boolean {
  const normalized = normalizedText(text)
  if (!normalized) return false
  if (hasStandaloneComponentIntent(normalized)) return true
  if (hasFamilyQualifiedPartIntent(normalized)) return true
  return false
}

export function hasWholeObjectIntent(text: string): boolean {
  const normalized = normalizedText(text)
  if (!normalized) return false
  return hasCompleteObjectIntent(normalized) && !hasComponentPartIntent(normalized)
}
