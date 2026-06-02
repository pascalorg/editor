import { describe, expect, test } from 'bun:test'
import { getRejectSuggestions } from './DxfValidationFeedback'

describe('getRejectSuggestions', () => {
  test('mechanical drawing → suggests checking file type', () => {
    const s = getRejectSuggestions([
      'CIRCLE + SPLINE 实体占比 71%（17/21），超过 60% 阈值（疑似机械图纸）',
    ])
    expect(s.some(x => x.includes('机械') || x.includes('建筑平面图'))).toBe(true)
  })

  test('small bbox → suggests checking units', () => {
    const s = getRejectSuggestions([
      'BBox 对角线 0.048m，小于最小建筑尺度 3m（疑似机械零件图）',
    ])
    expect(s.some(x => x.includes('单位') || x.includes('高级设置'))).toBe(true)
  })

  test('large bbox / site map → suggests exporting floor plan', () => {
    const s = getRejectSuggestions([
      'BBox 对角线 820.0m，超过最大建筑尺度 500m（疑似场地图或坐标系错误）',
    ])
    expect(s.some(x => x.includes('场地') || x.includes('楼层平面图'))).toBe(true)
  })

  test('no parallel pairs → suggests checking layers or thickness', () => {
    const s = getRejectSuggestions([
      '在 42 条线段中未发现平行线对（墙体间距 80–400mm），缺少墙体特征',
    ])
    expect(s.some(x => x.includes('图层') || x.includes('厚度'))).toBe(true)
  })

  test('disconnected lines → suggests checking layers', () => {
    const s = getRejectSuggestions([
      '42 条线段中无法形成封闭多边形（线段孤立，无连通区域）',
    ])
    expect(s.some(x => x.includes('图层') || x.includes('厚度'))).toBe(true)
  })

  test('too few lines → suggests checking file completeness', () => {
    const s = getRejectSuggestions([
      'LINE + LWPOLYLINE 实体仅 3 个，低于最小值 10（疑似纯注释文件或空文件）',
    ])
    expect(s.some(x => x.includes('线条') || x.includes('完整'))).toBe(true)
  })

  test('file too large → suggests exporting smaller region', () => {
    const s = getRejectSuggestions([
      '文件大小 12.3MB，超过最大限制 10MB',
    ])
    expect(s.some(x => x.includes('合并') || x.includes('导出') || x.includes('区域'))).toBe(true)
  })

  test('unknown reason → returns at least one generic suggestion', () => {
    const s = getRejectSuggestions(['某个未知的拒绝原因'])
    expect(s.length).toBeGreaterThanOrEqual(1)
  })

  test('multiple reasons → may produce multiple suggestions', () => {
    const s = getRejectSuggestions([
      'CIRCLE + SPLINE 实体占比 71%',
      'BBox 对角线 0.048m，小于最小建筑尺度 3m（疑似机械零件图）',
    ])
    expect(s.length).toBeGreaterThanOrEqual(1)
  })

  test('empty reasons array → returns generic fallback', () => {
    const s = getRejectSuggestions([])
    expect(s.length).toBe(1)
    expect(s[0]).toContain('建筑平面图')
  })
})
