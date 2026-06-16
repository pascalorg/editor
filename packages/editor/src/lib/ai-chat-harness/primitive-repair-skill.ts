export type PrimitiveRepairIssueKind =
  | 'missing_semantic_roles'
  | 'missing_parts'
  | 'tool_schema'
  | 'stagnant_repair'
  | 'invalid_geometry'
  | 'empty_geometry'
  | 'unknown'

export type PrimitiveRepairClassification = {
  kind: PrimitiveRepairIssueKind
  title: string
  reason: string
  nextAction: string
}

function hasAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term))
}

export function classifyPrimitiveRepairIssue(content: string): PrimitiveRepairClassification {
  const text = content.toLowerCase()

  if (hasAny(text, ['required semantic role', 'semantic role', 'requiredroles'])) {
    return {
      kind: 'missing_semantic_roles',
      title: '缺少必需语义部件',
      reason: '模型调用的工具参数没有包含校验器要求的关键语义角色。',
      nextAction:
        '重新生成一个完整蓝图：补齐缺失语义部件，或改用能自动生成这些语义部件的 compose_parts/compose_recipe 路线。',
    }
  }

  if (hasAny(text, ['requires one', 'requires at least', 'got 0', 'missing part'])) {
    return {
      kind: 'missing_parts',
      title: '缺少关键部件',
      reason: '蓝图没有生成当前物体必须可读的主体部件，例如轴、轮、孔、叶片、管口或连接件。',
      nextAction:
        '保持同一对象族，改为完整 part blueprint；例如轴+轮毂+叶片类对象使用 vertical_pole + circular_base + propeller_blade_set。',
    }
  }

  if (hasAny(text, ['invalid geometry tool call', 'fix the arguments', 'json', 'schema'])) {
    return {
      kind: 'tool_schema',
      title: '工具参数格式不合法',
      reason: '工具调用不符合 schema，或者字段名/结构与当前 primitive 工具不匹配。',
      nextAction:
        '使用严格 JSON 重新调用一次正确工具；不要混用多个工具，也不要输出解释文字替代工具参数。',
    }
  }

  if (hasAny(text, ['nothing was created', 'no geometry was created', 'empty', '0 shapes'])) {
    return {
      kind: 'empty_geometry',
      title: '没有创建几何体',
      reason: '工具调用没有产出可保存的 shape，场景保持不变。',
      nextAction: '改用更小的完整蓝图重试：先生成主体轮廓和 2-5 个关键识别部件，再逐步修订细节。',
    }
  }

  if (hasAny(text, ['validation failed', 'non-manifold', 'self-intersect', 'invalid geometry'])) {
    return {
      kind: 'invalid_geometry',
      title: '几何校验失败',
      reason: '生成的形体可能存在自相交、非流形、零厚度、尺寸比例冲突或连接错误。',
      nextAction:
        '降低几何复杂度并保留识别特征：减少布尔/裁剪/密集细节，优先使用已有 part kernel 或 recipe 的布局计算。',
    }
  }

  return {
    kind: 'unknown',
    title: '生成未完成',
    reason: '系统未能从失败日志中识别出单一原因。',
    nextAction:
      '把本次失败日志交给模型重新规划路线：优先换成支持的 recipe/parts 蓝图，而不是继续重复同一参数。',
  }
}

export function buildPrimitiveRepairStopMessage(options: {
  failureContent: string
  stagnantLimit: number
  compressedMemoryKept?: boolean
}) {
  const issue = classifyPrimitiveRepairIssue(options.failureContent)
  const lines = [
    `生成已停止：修复 harness 已连续 ${options.stagnantLimit} 轮没有减少校验问题。`,
    `错误分类：${issue.title}。`,
    `原因：${issue.reason}`,
    '当前状态：没有创建新的几何体，场景保持不变。',
  ]
  if (options.compressedMemoryKept) {
    lines.push('已保留压缩修复记忆：后续可以基于最近失败点重新规划完整蓝图。')
  }
  lines.push(`下一步方案：${issue.nextAction}`)
  return lines.join('\n')
}
