// ---------------------------------------------------------------------------
// Reply-language support (中/日/英, default English).
//
// The pipeline INTERNALLY stays Chinese: diagnostics strings, gate failure
// messages, sceneResult records, and every model-facing prompt keep the
// exact zh text they had — repair prompts and persisted sessions stay stable
// no matter what language the user types. Localization happens only at the
// REPLY BOUNDARY: agent.ts renders the user-visible message frames and issue
// summaries through `t()` / the render helpers here, keyed by the language
// detected from the user's latest message.
//
// Adding a language = adding a column here (same policy as room-vocab.ts).
// ---------------------------------------------------------------------------

export type Lang = 'zh' | 'ja' | 'en'

// Kana ⇒ Japanese; Han without kana ⇒ Chinese; otherwise English. Checked
// against the user's most recent message each turn, so a conversation that
// switches language switches replies too. Two sticky rules soften the
// per-message detection:
// - a ja session stays ja on kana-less messages (terse Japanese like
//   「寝室2、浴室1」 is pure kanji and indistinguishable from Chinese);
// - short CJK-less messages ("ok", "yes") keep the prior language instead
//   of flipping the conversation to English.
export function detectLanguage(text: string | undefined | null, prior?: Lang): Lang {
  if (!text) return prior ?? 'en'
  if (/[぀-ヿ]/.test(text)) return 'ja'
  if (/[一-鿿]/.test(text)) return prior === 'ja' ? 'ja' : 'zh'
  if (prior && text.trim().length <= 4) return prior
  return 'en'
}

type Template<P> = (params: P) => string
type MessageDef<P> = { zh: Template<P>; ja: Template<P>; en: Template<P> }

function def<P>(zh: Template<P>, ja: Template<P>, en: Template<P>): MessageDef<P> {
  return { zh, ja, en }
}

// --- reply frames (方案 A) ---------------------------------------------------

export const MESSAGES = {
  planRejected: def<{ rounds: number; list: string }>(
    p => `户型规划未通过校验（已尝试 ${p.rounds} 轮）：\n${p.list}\n已确认的需求仍然保留，可以补充或调整需求后重试。`,
    p => `間取りプランが検証を通過しませんでした（${p.rounds} 回試行）：\n${p.list}\n確認済みの要件は保持されています。要件を補足・調整して再度お試しください。`,
    p => `The floor plan failed validation (${p.rounds} attempt(s)):\n${p.list}\nYour confirmed requirements are preserved — adjust them and try again.`,
  ),
  generateSuccess: def<{ url: string | null }>(
    p => `户型已生成并通过自动检查。${p.url ? `\n打开场景：${p.url}` : ''}`,
    p => `間取りを生成し、自動チェックに合格しました。${p.url ? `\nシーンを開く：${p.url}` : ''}`,
    p => `The floor plan was generated and passed all automated checks.${p.url ? `\nOpen the scene: ${p.url}` : ''}`,
  ),
  generateCancelled: def<Record<string, never>>(
    () => '已在生成过程中取消。未完成的半成品不会保存到你的项目，已确认的需求仍然保留，可以稍后重新生成。',
    () => '生成をキャンセルしました。未完成のシーンはプロジェクトに保存されません。確認済みの要件は保持されているため、後で再生成できます。',
    () => 'Generation was cancelled. The unfinished scene will not be saved to your project; your confirmed requirements are preserved, so you can regenerate later.',
  ),
  generateFailed: def<{ error: string }>(
    p => `户型生成失败：${p.error}。已确认的结构化需求仍然保留，可以稍后重试。`,
    p => `間取りの生成に失敗しました：${p.error}。確認済みの要件は保持されています。後で再度お試しください。`,
    p => `Floor plan generation failed: ${p.error}. Your confirmed requirements are preserved — please try again later.`,
  ),
  modifySuccess: def<Record<string, never>>(
    () => '已按你的要求修改当前户型，并通过自动检查。',
    () => 'ご要望どおりに間取りを修正し、自動チェックに合格しました。',
    () => 'The floor plan was modified as requested and passed all automated checks.',
  ),
  applyToExistingSuccess: def<Record<string, never>>(
    () => '已在现有户型基础上完成修改，并通过自动检查。',
    () => '既存の間取りをベースに修正を完了し、自動チェックに合格しました。',
    () => 'Changes were applied to the existing floor plan and passed all automated checks.',
  ),
  modifyCancelled: def<Record<string, never>>(
    () => '已在修改过程中取消。原场景保持不变，发送确认即可重试同一修改，或直接描述新的修改需求。',
    () => '修正をキャンセルしました。元のシーンは変更されていません。確認を送信すると同じ修正を再試行できます。新しい修正内容を入力しても構いません。',
    () => 'The modification was cancelled. The original scene is unchanged — send a confirmation to retry the same change, or describe a new one.',
  ),
  modifyFailedRetry: def<{ error: string }>(
    p => `场景修改失败：${p.error}。原场景和修改要求都已保留，发送确认即可重试同一操作，或直接描述新的修改需求。`,
    p => `シーンの修正に失敗しました：${p.error}。元のシーンと修正内容は保持されています。確認を送信すると再試行できます。新しい修正内容を入力しても構いません。`,
    p => `Scene modification failed: ${p.error}. The original scene and your request are preserved — send a confirmation to retry, or describe a new change.`,
  ),
  modifyFailedNoRetry: def<{ error: string }>(
    p => `场景修改失败：${p.error}。原场景已保留，可以重新描述需要的修改。`,
    p => `シーンの修正に失敗しました：${p.error}。元のシーンは保持されています。修正内容をもう一度入力してください。`,
    p => `Scene modification failed: ${p.error}. The original scene is preserved — please describe the change again.`,
  ),
  modifyNoScene: def<Record<string, never>>(
    () => '找不到需要修改的场景，请重新生成户型。',
    () => '修正対象のシーンが見つかりません。間取りを再生成してください。',
    () => 'No scene found to modify. Please generate a floor plan first.',
  ),
  repairCapReached: def<{ rounds: number; count: number; list: string }>(
    p => `自动修正已达上限（${p.rounds} 轮），仍有 ${p.count} 个结构问题需要人工确认：${p.list}`,
    p => `自動修正が上限（${p.rounds} 回）に達しました。${p.count} 件の構造上の問題が残っており、確認が必要です：${p.list}`,
    p => `Automatic repair reached its limit (${p.rounds} round(s)); ${p.count} structural issue(s) still need review:${p.list}`,
  ),
  gatesNotPassed: def<{ count: number; list: string }>(
    p => `完成门槛未全部通过（${p.count} 项）：\n${p.list}`,
    p => `完成条件を満たしていない項目があります（${p.count} 件）：\n${p.list}`,
    p => `${p.count} completion gate(s) did not pass:\n${p.list}`,
  ),
  furnitureIssuesSummary: def<{ count: number; list: string; moreCount: number }>(
    p => `有 ${p.count} 件家具未正确放置（越界/重叠/未成功放置）：\n${p.list}${p.moreCount > 0 ? `\n……以及另外 ${p.moreCount} 项` : ''}`,
    p => `${p.count} 点の家具が正しく配置されていません（範囲外／重なり／配置失敗）：\n${p.list}${p.moreCount > 0 ? `\n……ほか ${p.moreCount} 件` : ''}`,
    p => `${p.count} furniture item(s) were not placed correctly (out of bounds / overlapping / failed):\n${p.list}${p.moreCount > 0 ? `\n…and ${p.moreCount} more` : ''}`,
  ),
  remainingIssuesHint: def<Record<string, never>>(
    () => '\n\n如果希望我再自动尝试修正这些问题，回复"继续修复"即可；也可以直接描述具体改动，或在编辑器中手动调整。',
    () => '\n\nこれらの問題の自動修正を再度試す場合は「修正を続けて」と返信してください。具体的な変更内容を直接入力するか、エディタで手動調整することもできます。',
    () => '\n\nReply "keep fixing" if you want me to retry these automatically; you can also describe specific changes, or adjust manually in the editor.',
  ),
  furnitureGeneralNote: def<Record<string, never>>(
    () => '\n\n提示：家具的精确摆放（是否贴墙、挡门、朝向）仍建议在编辑器里再确认一下。',
    () => '\n\nヒント：家具の細かい配置（壁付け・ドアとの干渉・向き）はエディタで最終確認することをおすすめします。',
    () => '\n\nTip: double-check the exact furniture placement (against walls, door clearance, orientation) in the editor.',
  ),
  sessionCallLimit: def<Record<string, never>>(
    () => '本会话的模型调用已达累计上限，为控制成本已暂停。请新建一个会话继续。',
    () => 'このセッションのモデル呼び出し回数が上限に達したため、コスト管理のため一時停止しました。新しいセッションで続けてください。',
    () => 'This session reached its cumulative model-call limit and was paused to control costs. Please start a new session.',
  ),
  askFloorArea: def<Record<string, never>>(
    () => '户型的建筑面积或外部边界尺寸是多少？',
    () => '床面積または外形の寸法はどれくらいですか？',
    () => 'What is the floor area or the outer boundary dimensions?',
  ),
  askRequiredRooms: def<Record<string, never>>(
    () => '必须包含哪些房间或功能空间？',
    () => '必ず含めたい部屋や機能空間は何ですか？',
    () => 'Which rooms or functional spaces must be included?',
  ),
  askConfirmFact: def<{ label: string; value: string }>(
    p => `请确认${p.label}：${p.value}`,
    p => `${p.label}をご確認ください：${p.value}`,
    p => `Please confirm ${p.label}: ${p.value}`,
  ),
  clarifyDefault: def<Record<string, never>>(
    () => '请补充户型面积或边界尺寸，以及必须包含的功能空间。',
    () => '床面積または外形寸法と、必ず含めたい部屋・機能空間を教えてください。',
    () => 'Please provide the floor area or boundary dimensions, and the rooms/spaces that must be included.',
  ),
  clarifyAtLimit: def<{ questions: string }>(
    p => `目前仍有关键条件未确认。你可以点击"确认"让系统采用合理默认假设直接生成，或点击"取消"结束任务；也可以继续补充下面的条件：\n${p.questions}`,
    p => `まだ確認されていない重要な条件があります。「確認」を押すと妥当なデフォルトで生成します。「キャンセル」で終了するか、以下の条件を補足してください：\n${p.questions}`,
    p => `Some key details are still unconfirmed. Click "Confirm" to generate with reasonable defaults, "Cancel" to stop, or answer the questions below:\n${p.questions}`,
  ),
  clarifyAsk: def<{ questions: string }>(
    p => `我已经保留了可用信息，还需要确认以下关键条件：\n${p.questions}`,
    p => `いただいた情報は保存しました。以下の重要な条件を確認させてください：\n${p.questions}`,
    p => `I've kept the information you provided. A few key details still need confirming:\n${p.questions}`,
  ),
  confirmPrompt: def<{ summary: string }>(
    p => `${p.summary}\n\n确认后我才会开始生成并修改 Pascal 场景。如有不符，请直接补充或纠正。`,
    p => `${p.summary}\n\n確認をいただいてから生成とシーンの変更を開始します。相違があれば、そのまま補足・修正してください。`,
    p => `${p.summary}\n\nI will only start generating and modifying the scene after you confirm. If anything looks wrong, just add or correct it.`,
  ),
  summaryIntro: def<Record<string, never>>(
    () => '我目前理解的需求如下：',
    () => '現在把握している要件は次のとおりです：',
    () => "Here's my current understanding of your requirements:",
  ),
  summaryExisting: def<{ list: string }>(
    p => `· 现状：${p.list}`,
    p => `· 現状：${p.list}`,
    p => `· Existing conditions: ${p.list}`,
  ),
  summaryGoals: def<{ list: string }>(
    p => `· 设计目标：${p.list}`,
    p => `· 設計目標：${p.list}`,
    p => `· Design goals: ${p.list}`,
  ),
  summaryConstraints: def<{ list: string }>(
    p => `· 硬性约束：${p.list}`,
    p => `· ハード制約：${p.list}`,
    p => `· Hard constraints: ${p.list}`,
  ),
  summaryAssumptions: def<Record<string, never>>(
    () => '以下内容我会按默认假设处理（尚未经你确认），如不符请补充：',
    () => '以下はデフォルトの前提として扱います（未確認）。相違があれば補足してください：',
    () => "I'll treat the following as default assumptions (not yet confirmed) — correct me if any are wrong:",
  ),
  summaryConflict: def<{ question: string }>(
    p => `  - 待确认冲突：${p.question}`,
    p => `  - 未解決の矛盾：${p.question}`,
    p => `  - Unresolved conflict: ${p.question}`,
  ),
  summaryEmpty: def<Record<string, never>>(
    () => '（暂未提取到明确信息，将主要依据合理默认假设生成，你可以随时补充。）',
    () => '（明確な情報がまだ抽出できていません。妥当なデフォルトに基づいて生成します。いつでも補足できます。）',
    () => '(No concrete details extracted yet — generation will rely on reasonable defaults; you can add details anytime.)',
  ),
  moreItems: def<{ count: number }>(
    p => `\n……以及另外 ${p.count} 项`,
    p => `\n……ほか ${p.count} 件`,
    p => `\n…and ${p.count} more`,
  ),
  // --- ingest routing / existing-scene路径（zh 文案与旧硬编码逐字一致，eval 的
  // 失败分类正则依赖其中几条的关键词） ---
  taskCancelled: def<Record<string, never>>(
    () => '已取消当前户型设计任务。现有场景没有被修改。',
    () => '間取り設計タスクをキャンセルしました。既存のシーンは変更されていません。',
    () => 'The floor plan task was cancelled. The existing scene was not modified.',
  ),
  modifyConfirmed: def<Record<string, never>>(
    () => '修改已确认，正在更新当前户型。',
    () => '修正を確認しました。間取りを更新しています。',
    () => 'Modification confirmed — updating the floor plan.',
  ),
  notReadyToConfirm: def<Record<string, never>>(
    () => '当前需求还没有达到可确认状态，请先补充关键条件。',
    () => '要件はまだ確認できる状態ではありません。先に重要な条件を補足してください。',
    () => 'The requirements are not ready to confirm yet — please provide the key details first.',
  ),
  confirmedWithDefaults: def<Record<string, never>>(
    () => '已按当前信息并采用系统默认假设确认需求，正在生成户型。',
    () => '現在の情報とデフォルトの前提で要件を確定し、間取りを生成しています。',
    () => 'Requirements confirmed with current information and default assumptions — generating the floor plan.',
  ),
  requirementsConfirmed: def<Record<string, never>>(
    () => '需求已确认，正在生成户型。',
    () => '要件を確認しました。間取りを生成しています。',
    () => 'Requirements confirmed — generating the floor plan.',
  ),
  emptyInput: def<Record<string, never>>(
    () => '请输入户型需求，或上传一张户型图。',
    () => '間取りの要件を入力するか、間取り図を1枚アップロードしてください。',
    () => 'Please describe your floor plan requirements, or upload a floor plan image.',
  ),
  describeChangesInText: def<Record<string, never>>(
    () => '户型已经生成。请用文字描述需要修改的内容。',
    () => '間取りは生成済みです。修正したい内容をテキストで入力してください。',
    () => 'The floor plan is already generated. Please describe the changes you want in text.',
  ),
  messageTooLong: def<Record<string, never>>(
    () => '文字需求不能超过 5000 个字符，请精简后重新提交。',
    () => 'テキストは 5000 文字以内にしてください。要約して再送信をお願いします。',
    () => 'Text requirements must be under 5000 characters — please shorten and resubmit.',
  ),
  unsupportedImage: def<Record<string, never>>(
    () => '当前仅支持单张 JPG、JPEG 或 PNG 户型图，且图片必须小于 20 MB。',
    () => '現在は JPG・JPEG・PNG の間取り図 1 枚のみ対応しています（20 MB 未満）。',
    () => 'Only a single JPG, JPEG, or PNG floor plan image under 20 MB is supported.',
  ),
  sceneLoadFailed: def<{ sceneId: string; error: string }>(
    p => `无法加载场景 ${p.sceneId}：${p.error}。请刷新页面重新打开项目，或稍后重试。`,
    p => `シーン ${p.sceneId} を読み込めませんでした：${p.error}。ページを更新してプロジェクトを開き直すか、後で再試行してください。`,
    p => `Failed to load scene ${p.sceneId}: ${p.error}. Refresh the page to reopen the project, or try again later.`,
  ),
  briefParseFailed: def<{ error: string }>(
    p => `需求解析失败：${p.error}。你可以重试，已输入的文字仍保留在当前会话中。`,
    p => `要件の解析に失敗しました：${p.error}。再試行できます。入力済みのテキストはこのセッションに保持されています。`,
    p => `Requirement parsing failed: ${p.error}. You can retry — your input is preserved in this session.`,
  ),
  inspectNoScene: def<Record<string, never>>(
    () => '找不到需要核对的场景。',
    () => '確認対象のシーンが見つかりません。',
    () => 'No scene found to inspect.',
  ),
  inspectFailed: def<{ error: string }>(
    p => `场景核对失败：${p.error}。当前场景没有被修改。`,
    p => `シーンの確認に失敗しました：${p.error}。現在のシーンは変更されていません。`,
    p => `Scene inspection failed: ${p.error}. The current scene was not modified.`,
  ),
  inspectStarting: def<Record<string, never>>(
    () => '正在核对当前户型。',
    () => '現在の間取りを確認しています。',
    () => 'Inspecting the current floor plan.',
  ),
  sceneIntentAmbiguous: def<Record<string, never>>(
    () => '我还不能确定你是想查询当前户型，还是要新增、修改或删除内容。请明确说明操作和对象，例如“查看这面墙多长”或“删除客厅东侧的窗户”。',
    () => 'ご要望が現在の間取りの確認なのか、追加・修正・削除なのか判断できませんでした。操作と対象を明確にしてください。例：「この壁の長さを確認して」「リビング東側の窓を削除して」。',
    () => "I can't tell whether you want to inspect the current floor plan or add, modify, or delete something. Please state the action and target, e.g. \"check how long this wall is\" or \"delete the window on the east side of the living room\".",
  ),
  deleteConfirm: def<{ message: string }>(
    p => `准备删除当前户型内容：${p.message}\n\n这是删除操作，确认后目标节点及其关联内容可能被移除。请确认后再执行，确认前不会更改场景。`,
    p => `間取りから次の内容を削除しようとしています：${p.message}\n\nこれは削除操作です。確認後、対象ノードと関連する内容が取り除かれる可能性があります。確認するまでシーンは変更されません。`,
    p => `About to delete from the current floor plan: ${p.message}\n\nThis is a destructive operation — the target nodes and related content may be removed once confirmed. Nothing changes until you confirm.`,
  ),
  sceneCreateStarting: def<{ message: string }>(
    p => `正在新增当前户型：${p.message}`,
    p => `間取りに追加しています：${p.message}`,
    p => `Adding to the current floor plan: ${p.message}`,
  ),
  sceneUpdateStarting: def<{ message: string }>(
    p => `正在修改当前户型：${p.message}`,
    p => `間取りを修正しています：${p.message}`,
    p => `Modifying the current floor plan: ${p.message}`,
  ),
} as const

export type MessageId = keyof typeof MESSAGES

export function t<K extends MessageId>(
  lang: Lang | undefined,
  id: K,
  ...args: Parameters<(typeof MESSAGES)[K]['zh']>
): string {
  const entry = MESSAGES[id][lang ?? 'en'] as (p: unknown) => string
  return entry(args[0])
}

// --- issue-line templates (方案 B1) ------------------------------------------
//
// Issue GENERATORS keep producing Chinese strings (fed to repair prompts and
// persisted in sceneResult). For the user-visible reply summary, agent.ts
// re-renders each issue from its structured source via these templates.

export const ISSUE = {
  collision: def<{ a: string; b: string; kind: string }>(
    p => `${p.a} 与 ${p.b} 存在 ${p.kind} 碰撞`,
    p => `${p.a} と ${p.b} が衝突しています（${p.kind}）`,
    p => `${p.a} collides with ${p.b} (${p.kind})`,
  ),
  doorlessRoom: def<{ room: string }>(
    p => `房间「${p.room}」没有任何门，是封闭空间`,
    p => `部屋「${p.room}」にドアがなく、閉じた空間になっています`,
    p => `Room "${p.room}" has no door and is sealed off`,
  ),
  isolatedBedroom: def<{ room: string }>(
    p => `卧室「${p.room}」只能经过卫生间/厨房/其他卧室到达，动线不合规`,
    p => `寝室「${p.room}」へは浴室・キッチン・他の寝室を通らないと行けず、動線が不適切です`,
    p => `Bedroom "${p.room}" can only be reached through a bathroom/kitchen/another bedroom — invalid circulation`,
  ),
  furnitureMissing: def<{ room: string; label: string; reason: string }>(
    p => `「${p.room}」缺少${p.label}：${p.reason}`,
    p => `「${p.room}」に${p.label}がありません：${p.reason}`,
    p => `"${p.room}" is missing ${p.label}: ${p.reason}`,
  ),
  placementOverlap: def<{ item: string; other: string }>(
    p => `家具「${p.item}」与「${p.other}」实际重叠，请移动其中一件到空位`,
    p => `家具「${p.item}」と「${p.other}」が重なっています。どちらかを空いた場所へ移動してください`,
    p => `Furniture "${p.item}" overlaps "${p.other}" — move one of them to open space`,
  ),
  placementOutOfBounds: def<{ item: string; room: string | null }>(
    p => p.room
      ? `家具「${p.item}」超出了房间「${p.room}」的边界（考虑旋转后的实际占地），请移入房间内部`
      : `家具「${p.item}」的中心不在任何房间内，请移到目标房间的多边形内部`,
    p => p.room
      ? `家具「${p.item}」が部屋「${p.room}」の境界からはみ出しています（回転後の占有面積を考慮）。部屋の内側へ移動してください`
      : `家具「${p.item}」の中心がどの部屋にもありません。対象の部屋の内側へ移動してください`,
    p => p.room
      ? `Furniture "${p.item}" extends beyond room "${p.room}" (accounting for its rotated footprint) — move it inside`
      : `Furniture "${p.item}" is not centered in any room — move it inside the target room`,
  ),
  placementDoorClearance: def<{ item: string }>(
    p => `家具「${p.item}」占用了房门的开启/通行空间，请移开让出门口净空`,
    p => `家具「${p.item}」がドアの開閉・通行スペースを塞いでいます。ドア前の空間を空けてください`,
    p => `Furniture "${p.item}" blocks a door's swing/clearance — move it away from the doorway`,
  ),
  strayWindow: def<{ wallId: string }>(
    p => `墙 ${p.wallId} 上的窗户不在建筑外边界附近，疑似开在了室内隔墙上`,
    p => `壁 ${p.wallId} の窓が建物の外周付近になく、室内の間仕切り壁に開けられている可能性があります`,
    p => `The window on wall ${p.wallId} is not near the building's exterior boundary — it may be on an interior partition`,
  ),
  bedroomShortfall: def<{ expected: number; actual: number }>(
    p => `卧室数量不足：需求 ${p.expected} 间，实际建了 ${p.actual} 间`,
    p => `寝室の数が不足しています：要件 ${p.expected} 室に対し、実際は ${p.actual} 室です`,
    p => `Not enough bedrooms: ${p.expected} required, ${p.actual} built`,
  ),
  missingSupportSpace: def<{ label: string }>(
    p => `缺少${p.label}：需求中明确要求了该空间但没有建`,
    p => `${p.label}がありません：要件で明示されていましたが作られていません`,
    p => `Missing ${p.label}: it was explicitly requested but was not built`,
  ),
  zoneOverlap: def<{ a: string; b: string; area: number }>(
    p => `房间「${p.a}」与「${p.b}」的地面区域重叠约 ${p.area}㎡，房间边界互相侵入，需要修正其中一间的轮廓`,
    p => `部屋「${p.a}」と「${p.b}」の床面積が約 ${p.area}㎡ 重なっています。どちらかの輪郭を修正してください`,
    p => `Rooms "${p.a}" and "${p.b}" overlap by ~${p.area}㎡ — one room's outline needs fixing`,
  ),
  gateMissingRoom: def<{ type: string; actual: number; expected: number }>(
    p => `房型「${p.type}」只有 ${p.actual} 间，brief 要求 ${p.expected} 间`,
    p => `部屋タイプ「${p.type}」が ${p.actual} 室しかありません（要件は ${p.expected} 室）`,
    p => `Only ${p.actual} room(s) of type "${p.type}" — the brief requires ${p.expected}`,
  ),
  gateTotalArea: def<{ actual: string; target: number; deviation: number }>(
    p => `实测总面积 ${p.actual}㎡ 偏离目标 ${p.target}㎡ 达 ${p.deviation}%`,
    p => `実測の延床面積 ${p.actual}㎡ が目標 ${p.target}㎡ から ${p.deviation}% 乖離しています`,
    p => `Measured total area ${p.actual}㎡ deviates ${p.deviation}% from the ${p.target}㎡ target`,
  ),
  gateNoEntryDoor: def<Record<string, never>>(
    () => '没有通向室外的入户门',
    () => '屋外へ通じる玄関ドアがありません',
    () => 'There is no entry door leading outside',
  ),
  gateIsolatedRoom: def<{ room: string }>(
    p => `房间「${p.room}」经门和开放边界都无法从入户门到达`,
    p => `部屋「${p.room}」へは、ドアや開放境界を通っても玄関から到達できません`,
    p => `Room "${p.room}" cannot be reached from the entry door through any door or open boundary`,
  ),
  gateMissingWindow: def<{ type: string }>(
    p => `用户要求的「${p.type}」外窗不存在于对应房间的外墙上`,
    p => `要件にある「${p.type}」の外窓が、該当する部屋の外壁にありません`,
    p => `The requested exterior window for "${p.type}" does not exist on that room's exterior wall`,
  ),
  gateBedroomAccess: def<{ room: string; noPublic: boolean }>(
    p => p.noPublic
      ? `卧室「${p.room}」无公共空间可达（户型中没有公共房型）`
      : `卧室「${p.room}」无法不穿过厨房/卫生间/其他卧室到达公共空间`,
    p => p.noPublic
      ? `寝室「${p.room}」から到達できる共用空間がありません（間取りに共用の部屋タイプがありません）`
      : `寝室「${p.room}」はキッチン・浴室・他の寝室を通らずに共用空間へ行けません`,
    p => p.noPublic
      ? `Bedroom "${p.room}" has no reachable public space (the layout has no public room type)`
      : `Bedroom "${p.room}" cannot reach public space without crossing a kitchen/bathroom/another bedroom`,
  ),
  gateMissingEquipment: def<{ roomKind: string; room: string; label: string }>(
    p => `${p.roomKind}「${p.room}」缺少必备设备：${p.label}`,
    p => `${p.roomKind}「${p.room}」に必須設備がありません：${p.label}`,
    p => `${p.roomKind} "${p.room}" is missing required equipment: ${p.label}`,
  ),
  gateMissingBedroomFurniture: def<{ room: string; label: string }>(
    p => `卧室「${p.room}」缺少必备家具：${p.label}`,
    p => `寝室「${p.room}」に必須の家具がありません：${p.label}`,
    p => `Bedroom "${p.room}" is missing required furniture: ${p.label}`,
  ),
  totalAreaOff: def<{ target: number; actual: number; deviation: number; tolerance: number }>(
    p => `总面积不符：需求约 ${p.target}㎡，当前所有房间实际覆盖约 ${p.actual}㎡（偏差 ${p.deviation}%，允许 ±${p.tolerance}%）。请整体调整建筑外轮廓和房间划分来贴近目标总面积，不要只微调单个房间`,
    p => `延床面積が要件と一致しません：要件は約 ${p.target}㎡、現在は約 ${p.actual}㎡（偏差 ${p.deviation}%、許容 ±${p.tolerance}%）。個々の部屋の微調整ではなく、外形と間取り全体を調整してください`,
    p => `Total area mismatch: ~${p.target}㎡ required, rooms currently cover ~${p.actual}㎡ (${p.deviation}% off, ±${p.tolerance}% allowed). Adjust the overall footprint and room partitioning, not just one room`,
  ),
} as const

export type IssueId = keyof typeof ISSUE

export function issueText<K extends IssueId>(
  lang: Lang | undefined,
  id: K,
  ...args: Parameters<(typeof ISSUE)[K]['zh']>
): string {
  const entry = ISSUE[id][lang ?? 'en'] as (p: unknown) => string
  return entry(args[0])
}
