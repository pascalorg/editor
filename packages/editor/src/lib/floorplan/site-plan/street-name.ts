/**
 * Street names compared the way the Postal Service reads an address (USPS
 * Publication 28): a name is its directional, its core and its street type,
 * each spelling brought to the standard abbreviation. "4121 NW 34th St" and
 * OSM's "Northwest 34th Street" are one street; "Northwest 34th Terrace" is
 * another — the type is part of the name, and so is the quadrant.
 */

/**
 * USPS Publication 28, Appendix C1 — street suffixes: the standard
 * abbreviation, then every spelling the Postal Service lists for it (lower
 * case, periods dropped).
 */
const PUB28_SUFFIXES: Record<string, readonly string[]> = {
  aly: ['allee', 'alley', 'ally', 'aly'],
  anx: ['anex', 'annex', 'annx', 'anx'],
  arc: ['arc', 'arcade'],
  ave: ['av', 'ave', 'aven', 'avenu', 'avenue', 'avn', 'avnue'],
  byu: ['bayoo', 'bayou'],
  bch: ['bch', 'beach'],
  bnd: ['bend', 'bnd'],
  blf: ['blf', 'bluf', 'bluff'],
  blfs: ['bluffs'],
  btm: ['bot', 'btm', 'bottm', 'bottom'],
  blvd: ['blvd', 'boul', 'boulevard', 'boulv'],
  br: ['br', 'brnch', 'branch'],
  brg: ['brdge', 'brg', 'bridge'],
  brk: ['brk', 'brook'],
  brks: ['brooks'],
  bg: ['burg'],
  bgs: ['burgs'],
  byp: ['byp', 'bypa', 'bypas', 'bypass', 'byps'],
  cp: ['camp', 'cp', 'cmp'],
  cyn: ['canyn', 'canyon', 'cnyn'],
  cpe: ['cape', 'cpe'],
  cswy: ['causeway', 'causwa', 'cswy'],
  ctr: ['cen', 'cent', 'center', 'centr', 'centre', 'cnter', 'cntr', 'ctr'],
  ctrs: ['centers'],
  cir: ['cir', 'circ', 'circl', 'circle', 'crcl', 'crcle'],
  cirs: ['circles'],
  clf: ['clf', 'cliff'],
  clfs: ['clfs', 'cliffs'],
  clb: ['clb', 'club'],
  cmn: ['common'],
  cmns: ['commons'],
  cor: ['cor', 'corner'],
  cors: ['corners', 'cors'],
  crse: ['course', 'crse'],
  ct: ['court', 'ct'],
  cts: ['courts', 'cts'],
  cv: ['cove', 'cv'],
  cvs: ['coves'],
  crk: ['creek', 'crk'],
  cres: ['crescent', 'cres', 'crsent', 'crsnt'],
  crst: ['crest'],
  xing: ['crossing', 'crssng', 'xing'],
  xrd: ['crossroad'],
  xrds: ['crossroads'],
  curv: ['curve'],
  dl: ['dale', 'dl'],
  dm: ['dam', 'dm'],
  dv: ['div', 'divide', 'dv', 'dvd'],
  dr: ['dr', 'driv', 'drive', 'drv'],
  drs: ['drives'],
  est: ['est', 'estate'],
  ests: ['estates', 'ests'],
  expy: ['exp', 'expr', 'express', 'expressway', 'expw', 'expy'],
  ext: ['ext', 'extension', 'extn', 'extnsn'],
  exts: ['exts'],
  fall: ['fall'],
  fls: ['falls', 'fls'],
  fry: ['ferry', 'frry', 'fry'],
  fld: ['field', 'fld'],
  flds: ['fields', 'flds'],
  flt: ['flat', 'flt'],
  flts: ['flats', 'flts'],
  frd: ['ford', 'frd'],
  frds: ['fords'],
  frst: ['forest', 'forests', 'frst'],
  frg: ['forg', 'forge', 'frg'],
  frgs: ['forges'],
  frk: ['fork', 'frk'],
  frks: ['forks', 'frks'],
  ft: ['fort', 'frt', 'ft'],
  fwy: ['freeway', 'freewy', 'frway', 'frwy', 'fwy'],
  gdn: ['garden', 'gardn', 'grden', 'grdn'],
  gdns: ['gardens', 'gdns', 'grdns'],
  gtwy: ['gateway', 'gatewy', 'gatway', 'gtway', 'gtwy'],
  gln: ['glen', 'gln'],
  glns: ['glens'],
  grn: ['green', 'grn'],
  grns: ['greens'],
  grv: ['grov', 'grove', 'grv'],
  grvs: ['groves'],
  hbr: ['harb', 'harbor', 'harbr', 'hbr', 'hrbor'],
  hbrs: ['harbors'],
  hvn: ['haven', 'hvn'],
  hts: ['ht', 'hts'],
  hwy: ['highway', 'highwy', 'hiway', 'hiwy', 'hway', 'hwy'],
  hl: ['hill', 'hl'],
  hls: ['hills', 'hls'],
  holw: ['hllw', 'hollow', 'hollows', 'holw', 'holws'],
  inlt: ['inlt'],
  is: ['is', 'island', 'islnd'],
  iss: ['islands', 'islnds', 'iss'],
  isle: ['isle', 'isles'],
  jct: ['jct', 'jction', 'jctn', 'junction', 'junctn', 'juncton'],
  jcts: ['jctns', 'jcts', 'junctions'],
  ky: ['key', 'ky'],
  kys: ['keys', 'kys'],
  knl: ['knl', 'knol', 'knoll'],
  knls: ['knls', 'knolls'],
  lk: ['lk', 'lake'],
  lks: ['lks', 'lakes'],
  land: ['land'],
  lndg: ['landing', 'lndg', 'lndng'],
  ln: ['lane', 'ln'],
  lgt: ['lgt', 'light'],
  lgts: ['lights'],
  lf: ['lf', 'loaf'],
  lck: ['lck', 'lock'],
  lcks: ['lcks', 'locks'],
  ldg: ['ldg', 'ldge', 'lodg', 'lodge'],
  loop: ['loop', 'loops'],
  mall: ['mall'],
  mnr: ['mnr', 'manor'],
  mnrs: ['manors', 'mnrs'],
  mdw: ['meadow'],
  mdws: ['mdw', 'mdws', 'meadows', 'medows'],
  mews: ['mews'],
  ml: ['mill'],
  mls: ['mills'],
  msn: ['missn', 'mssn'],
  mtwy: ['motorway'],
  mt: ['mnt', 'mt', 'mount'],
  mtn: ['mntain', 'mntn', 'mountain', 'mountin', 'mtin', 'mtn'],
  mtns: ['mntns', 'mountains'],
  nck: ['nck', 'neck'],
  orch: ['orch', 'orchard', 'orchrd'],
  oval: ['oval', 'ovl'],
  opas: ['overpass'],
  park: ['park', 'prk', 'parks'],
  pkwy: ['parkway', 'parkwy', 'pkway', 'pkwy', 'pky', 'parkways', 'pkwys'],
  pass: ['pass'],
  psge: ['passage'],
  path: ['path', 'paths'],
  pike: ['pike', 'pikes'],
  pne: ['pine'],
  pnes: ['pines', 'pnes'],
  pl: ['pl', 'place'],
  pln: ['plain', 'pln'],
  plns: ['plains', 'plns'],
  plz: ['plaza', 'plz', 'plza'],
  pt: ['point', 'pt'],
  pts: ['points', 'pts'],
  prt: ['port', 'prt'],
  prts: ['ports', 'prts'],
  pr: ['pr', 'prairie', 'prr'],
  radl: ['rad', 'radial', 'radiel', 'radl'],
  ramp: ['ramp'],
  rnch: ['ranch', 'ranches', 'rnch', 'rnchs'],
  rpd: ['rapid', 'rpd'],
  rpds: ['rapids', 'rpds'],
  rst: ['rest', 'rst'],
  rdg: ['rdg', 'rdge', 'ridge'],
  rdgs: ['rdgs', 'ridges'],
  riv: ['riv', 'river', 'rvr', 'rivr'],
  rd: ['rd', 'road'],
  rds: ['roads', 'rds'],
  rte: ['route'],
  row: ['row'],
  rue: ['rue'],
  run: ['run'],
  shl: ['shl', 'shoal'],
  shls: ['shls', 'shoals'],
  shr: ['shoar', 'shore', 'shr'],
  shrs: ['shoars', 'shores', 'shrs'],
  skwy: ['skyway'],
  spg: ['spg', 'spng', 'spring', 'sprng'],
  spgs: ['spgs', 'spngs', 'springs', 'sprngs'],
  spur: ['spur', 'spurs'],
  sq: ['sq', 'sqr', 'sqre', 'squ', 'square'],
  sqs: ['sqrs', 'squares'],
  sta: ['sta', 'station', 'statn', 'stn'],
  stra: ['stra', 'strav', 'straven', 'stravenue', 'stravn', 'strvn', 'strvnue'],
  strm: ['stream', 'streme', 'strm'],
  st: ['street', 'strt', 'st', 'str'],
  sts: ['streets'],
  smt: ['smt', 'sumit', 'sumitt', 'summit'],
  ter: ['ter', 'terr', 'terrace'],
  trwy: ['throughway'],
  trce: ['trace', 'traces', 'trce'],
  trak: ['track', 'tracks', 'trak', 'trk', 'trks'],
  trfy: ['trafficway'],
  trl: ['trail', 'trails', 'trl', 'trls'],
  trlr: ['trailer', 'trlr', 'trlrs'],
  tunl: ['tunel', 'tunl', 'tunls', 'tunnel', 'tunnels', 'tunnl'],
  tpke: ['trnpk', 'turnpike', 'turnpk'],
  upas: ['underpass'],
  un: ['un', 'union'],
  uns: ['unions'],
  vly: ['valley', 'vally', 'vlly', 'vly'],
  vlys: ['valleys', 'vlys'],
  via: ['vdct', 'via', 'viadct', 'viaduct'],
  vw: ['view', 'vw'],
  vws: ['views', 'vws'],
  vlg: ['vill', 'villag', 'village', 'villg', 'villiage', 'vlg'],
  vlgs: ['villages', 'vlgs'],
  vl: ['ville', 'vl'],
  vis: ['vis', 'vist', 'vista', 'vst', 'vsta'],
  walk: ['walk', 'walks'],
  wall: ['wall'],
  way: ['wy', 'way'],
  ways: ['ways'],
  wl: ['well'],
  wls: ['wells', 'wls'],
}

/** Any listed spelling of a street type → its Pub. 28 abbreviation. */
const SUFFIX: ReadonlyMap<string, string> = new Map(
  Object.entries(PUB28_SUFFIXES).flatMap(([abbr, spellings]) =>
    spellings.map((s) => [s, abbr] as const),
  ),
)

/** Pub. 28 directionals, spelled out or abbreviated → the abbreviation. */
const DIRECTIONAL: ReadonlyMap<string, string> = new Map([
  ['n', 'n'],
  ['s', 's'],
  ['e', 'e'],
  ['w', 'w'],
  ['ne', 'ne'],
  ['nw', 'nw'],
  ['se', 'se'],
  ['sw', 'sw'],
  ['north', 'n'],
  ['south', 's'],
  ['east', 'e'],
  ['west', 'w'],
  ['northeast', 'ne'],
  ['northwest', 'nw'],
  ['southeast', 'se'],
  ['southwest', 'sw'],
])

export interface StreetName {
  /** The directional before the name ("nw"), '' when none. */
  pre: string
  /** The name itself, lower case ("34th", "castro"). */
  name: string
  /** The street type as its Pub. 28 abbreviation ("st", "ter"), '' when the name carries none. */
  type: string
  /** The directional after the type ("n" in "1st St N"), '' when none. */
  post: string
}

/**
 * A street line read into its parts: the house number dropped, the type and
 * the directionals standardised. A word is only read as a type or a
 * directional when a name is left beside it ("North St" is the street named
 * North).
 */
export function parseStreetName(s: string | null | undefined): StreetName {
  const words = String(s ?? '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/^\s*\d+[a-z]?(?:-\d+[a-z]?)?\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
  let post = ''
  let type = ''
  let pre = ''
  if (words.length >= 2 && DIRECTIONAL.has(words[words.length - 1] as string))
    post = DIRECTIONAL.get(words.pop() as string) as string
  if (words.length >= 2 && SUFFIX.has(words[words.length - 1] as string))
    type = SUFFIX.get(words.pop() as string) as string
  if (words.length >= 2 && DIRECTIONAL.has(words[0] as string))
    pre = DIRECTIONAL.get(words.shift() as string) as string
  return { pre, name: words.join(' '), type, post }
}

/**
 * Do two street lines name the same street? The names must agree, and so
 * must the street types and the directionals wherever both lines give one:
 * "NW 34th St" is "Northwest 34th Street" (and "34th Street"), never
 * "Northwest 34th Terrace" or "SW 34th St". A line with no name matches
 * nothing.
 */
export function sameStreet(
  a: string | StreetName | null | undefined,
  b: string | StreetName | null | undefined,
): boolean {
  const x = typeof a === 'object' && a !== null ? a : parseStreetName(a)
  const y = typeof b === 'object' && b !== null ? b : parseStreetName(b)
  if (!x.name || x.name !== y.name) return false
  if (x.type && y.type && x.type !== y.type) return false
  const dx = [x.pre, x.post].filter(Boolean).join(' ')
  const dy = [y.pre, y.post].filter(Boolean).join(' ')
  return !dx || !dy || dx === dy
}
