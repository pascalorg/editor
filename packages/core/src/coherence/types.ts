/**
 * What the checker reports. An issue is one measured contact that crossed a tolerance; an item is
 * what an agent or a person reads, issues of one kind grouped under the roof (or other element)
 * they share, with the ways out and a view that shows the defect.
 */

export type CoherenceFamily = 'enclosure' | 'support' | 'hosting'

export type EnclosureCode =
  | 'roof_wall_pierce'
  | 'roof_wall_gap'
  | 'roof_wall_parapet_short'
  | 'roof_wall_parapet_uncapped'

export type SupportCode =
  | 'support_orphan'
  | 'support_not_seated'
  | 'support_floating'
  | 'support_cantilever'

export type HostingCode = 'hosting_outside_face' | 'hosting_no_lintel'

/** Every code a family reports; the union grows with the families. */
export type CoherenceCode = EnclosureCode | SupportCode | HostingCode

/**
 * `error` is a physically impossible state (a wall running through a roof); `check` is a
 * hypothesis the maker settles (a roof standing clear of a wall). Both close the same way.
 */
export type CoherenceSeverity = 'error' | 'check'

export type CoherenceMeasure = { quantity: string; expected: string; actual: string }

/** The compass sides view_scene takes. */
export type CoherenceViewSide =
  | 'north'
  | 'north-east'
  | 'east'
  | 'south-east'
  | 'south'
  | 'south-west'
  | 'west'
  | 'north-west'

/** The numbers behind an issue's sentence, kept so resolutions are computed, not guessed. */
export type RoofWallFigures = {
  /** Where the wall ends, in world metres. */
  wallTop: number
  /** Where the roof's body starts at its edge: the roof level's base plus the roof's own height. */
  seat: number
  /** The most the wall top stands above the roof's underside along it (m); at most 0 if never. */
  overUnderside: number
  /** The most the roof's underside stands above the wall top along it (m); 0 if never. */
  shortOfUnderside: number
  /** The least the wall top stands above the roof's covering along it (m); negative if inside. */
  aboveCovering: number
  /** How much the roof's covering rises or falls along the wall (m). */
  coveringRange: number
  /** The lowest the roof's underside gets along the wall, in world metres. */
  undersideLow: number
  /** The highest the roof's covering gets along the wall, in world metres. */
  coveringHigh: number
  /** The nearest the wall comes to the roof's edge (m). */
  insetFromEdge: number
  coveredLength: number
  wallLength: number
}

type IssueFields = {
  /** The family, the kind and the sorted node ids: the same every time the same contact fails. */
  id: string
  /** The element the item is reported under; issues of one kind under one roof share it. */
  group: string
  severity: CoherenceSeverity
  principle: string
  measured: CoherenceMeasure
  /** The element the issue is about first, then what it meets. */
  nodeIds: string[]
  /** The levels the issue lives on: where a write has to look again. */
  levelIds: string[]
  /** The node whose metadata holds what the maker says about the issue (a dispute). */
  carrierId: string
}

export type EnclosureIssue = IssueFields & {
  family: 'enclosure'
  code: EnclosureCode
  figures: RoofWallFigures
}

/** The numbers behind a Support issue's sentence. Gaps are vertical, in metres. */
export type SupportFigures = {
  /** Where the element ends (a post's top) or begins (a roof's seat), in world metres. */
  at: number
  /** The gap to the nearest thing it could carry or rest on; 0 when there is none (`nothing`). */
  gap: number
  /** 1 when nothing is in reach to measure against, else 0. */
  nothing: number
  /** How far a roof reaches past the supports on one side (m); 0 for the other codes. */
  overhang: number
  /** The span between the supports on that axis (m); 0 for the other codes. */
  backspan: number
}

export type SupportIssue = IssueFields & {
  family: 'support'
  code: SupportCode
  figures: SupportFigures
}

/** The numbers behind a Hosting issue's sentence, in metres above the face's own base. */
export type HostingFigures = {
  /** The effective top of the face over the opening's span, less its head: negative when the head is past it. */
  margin: number
  /** The effective top of the face over the span. */
  top: number
  /** The opening's head and sill. */
  head: number
  sill: number
}

export type HostingIssue = IssueFields & {
  family: 'hosting'
  code: HostingCode
  figures: HostingFigures
}

export type CoherenceIssue = EnclosureIssue | SupportIssue | HostingIssue

export type DisputeEvidence = {
  /** A measurement the maker took, or a view_scene it looked at. */
  kind: 'measurement' | 'view'
  detail: string
}

/** What a maker said about an item, as the item shows it. */
export type DisputeStatement = { reason: string; evidence: DisputeEvidence }

export type CoherenceEdit = { id: string; set: Record<string, unknown> }

export type CoherenceResolution = {
  label: string
  /** The edits that make the move, ready for update_node or apply_patch. Absent when it is not one edit. */
  edits?: CoherenceEdit[]
  /** What the move costs, or why it cannot be made as stated. */
  note?: string
}

export type CoherenceCheck = {
  /** The view_scene arguments that show the defect. */
  view: { target: string; from: CoherenceViewSide; elevation: number }
  measure: string
}

export type CoherenceItem = {
  id: string
  /** `disputed` while the maker's dispute stands, and not counted open; `open` otherwise. */
  status: 'open' | 'disputed'
  /** Why the maker says it stands. Present while status is `disputed`. */
  dispute?: DisputeStatement
  /** What the maker said before a write changed the measurement: the item is open again. */
  reopened?: DisputeStatement
  family: CoherenceFamily
  code: CoherenceCode
  severity: CoherenceSeverity
  principle: string
  count: number
  /** Every node the item names: the roof, then the walls. */
  nodeIds: string[]
  issueIds: string[]
  /** The worst contact, with the spread when several walls differ. */
  measured: CoherenceMeasure & { spread?: string }
  resolutions: CoherenceResolution[]
  check: CoherenceCheck
}

export type CoherenceResolved = {
  id: string
  family: CoherenceFamily
  code: CoherenceCode
  nodeIds: string[]
}

/** What a write did to the checklist, within the levels it rechecked. */
export type CoherenceDelta = {
  introduced: CoherenceItem[]
  resolved: CoherenceResolved[]
  /** The issues still open in those levels after the write, introduced ones included. */
  open: number
  /** The issues under a standing dispute in those levels, when there are any. */
  disputed?: number
}
