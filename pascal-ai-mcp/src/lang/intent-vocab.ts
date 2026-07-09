// ---------------------------------------------------------------------------
// Trilingual (zh / ja / en) scene-intent vocabulary — the deterministic
// fallback for classifying a request about an existing scene when the model
// classifier is unavailable (budget exhausted / API failure).
//
// Same policy as room-vocab.ts: adding a language means editing THIS table
// only. Keep these in sync with the reply hints in i18n.ts — e.g.
// remainingIssuesHint tells the user to reply "继续修复" / "keep fixing" /
// 「修正を続けて」, so all three MUST classify as `update` here.
// ---------------------------------------------------------------------------

export type SceneIntent = 'query' | 'create' | 'update' | 'delete' | 'ambiguous'

// Order matters and mirrors classifySceneIntentFallback: delete before
// create/update (「取り除いて」 must never read as create), actions before
// the broad query match. Latin terms are word-bounded so e.g. \bmove\b does
// not fire inside "remove".
const DELETE_PATTERN =
  /删除|删掉|移除|去掉|拆除|\b(?:delete|remove|demolish)\b|\bget rid of\b|削除|取り除|撤去|取り壊|消して/i

const CREATE_PATTERN =
  /新增|添加|加一个|创建|放置|摆放|增加|\b(?:add|create|place|insert|install)\b|追加|新設|設置|置いて|作って|付けて|増やして/i

const UPDATE_PATTERN =
  /继续修复|修复|再修|重新修|继续优化|再优化|修改|改成|改为|调整|移动|缩短|延长|扩大|缩小|重命名|替换|\b(?:keep fixing|fix|repair|change|modify|adjust|move|resize|rename|replace|shorten|extend|widen|enlarge|shrink|swap)\b|修正|直して|修理|変更|調整|移動|変えて|置き換え|広げて|縮めて|短くして|長くして|リサイズ/i

const QUERY_PATTERN =
  /查看|查询|检查|核对|测量|告诉我|显示|\b(?:show|check|inspect|measure|view|list|display)\b|\btell me\b|\bhow (?:long|wide|high|tall|big|many|much)\b|\bwhat(?:'s| is| are)\b|\bwhere\b|確認して|教えて|見せて|表示して|測って|どれくらい|どのくらい/i

// Question-shaped messages: an explicit ?, zh interrogative particles, or ja
// sentence-final question forms (「〜ですか」「〜ますか」 often arrive without
// a question mark).
const QUESTION_PATTERN =
  /[?？]\s*$|(?:是不是|是否|有没有|好像|多少|多长|多高|多宽|是什么|为什么|吗|呢)[?？]?$|(?:ですか|ますか|でしょうか|でしたか|ありますか)[。]?\s*$/

export function isSceneQuestion(message: string): boolean {
  return QUESTION_PATTERN.test(message.trim())
}

export function classifySceneIntentFallback(message: string): SceneIntent {
  const value = message.trim()
  if (DELETE_PATTERN.test(value)) return 'delete'
  if (CREATE_PATTERN.test(value)) return 'create'
  if (UPDATE_PATTERN.test(value)) return 'update'
  if (isSceneQuestion(value) || QUERY_PATTERN.test(value)) return 'query'
  return 'ambiguous'
}
