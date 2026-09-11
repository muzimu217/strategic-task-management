import { describe, expect, it } from 'vitest'
import type { BusinessImportType } from '@/features/import/api/businessImport'
import {
  buildImportTemplateFileName,
  buildImportTemplateSheet,
  getImportTemplateGuide
} from '@/features/import/lib/importTemplate'

const importTypes: BusinessImportType[] = ['strategic-task', 'distribution']

const expectedHeaders: Record<BusinessImportType, string[]> = {
  'strategic-task': [
    '职能部门',
    '任务类型',
    '战略任务',
    '核心指标',
    '指标类型',
    '权重',
    '里程碑明细',
    '备注'
  ],
  distribution: [
    '学院',
    '父级战略任务',
    '父级核心指标',
    '子指标名称',
    '指标类型',
    '权重',
    '里程碑明细',
    '备注'
  ]
}

const expectedSheetNames: Record<BusinessImportType, string> = {
  'strategic-task': '职能部门指标模板',
  distribution: '学院子指标模板'
}

describe('import/lib/importTemplate', () => {
  it.each(importTypes)('%s 模板表头与后端可解析列名完全一致且不含预警等级', type => {
    const sheet = buildImportTemplateSheet(type)
    const headers = sheet.columns.map(column => column.header)

    expect(headers).toEqual(expectedHeaders[type])
    expect(headers).not.toContain('预警等级')
  })

  it.each(importTypes)('%s 模板 sheet 名称正确且包含示例行', type => {
    const sheet = buildImportTemplateSheet(type)

    expect(sheet.sheetName).toBe(expectedSheetNames[type])
    expect(sheet.rows.length).toBeGreaterThan(0)
  })

  it.each(importTypes)('%s 模板列能从示例行取到单元格值', type => {
    const sheet = buildImportTemplateSheet(type)
    const guide = getImportTemplateGuide(type)
    const firstRow = guide.rows[0]

    guide.columns.forEach((column, index) => {
      expect(String(sheet.columns[index].getValue(firstRow, index))).toBe(
        firstRow[column.key] || ''
      )
    })
  })

  it.each(importTypes)('%s 模板文件名包含导入模板并以 .xlsx 结尾', type => {
    const fileName = buildImportTemplateFileName(type)

    expect(fileName).toContain('导入模板')
    expect(fileName.endsWith('.xlsx')).toBe(true)
  })

  it.each(importTypes)('%s 填写说明规则非空且明确列出必填列', type => {
    const guide = getImportTemplateGuide(type)

    expect(guide.rules.length).toBeGreaterThan(0)
    expect(guide.rules.every(rule => rule.trim().length > 0)).toBe(true)
    // 模板表头不能带星号（后端解析器按列名精确匹配），必填信息必须在文字规则中列明
    expect(guide.rules.some(rule => rule.includes('必填列'))).toBe(true)
    expect(guide.rules.some(rule => rule.includes('带 * 的列'))).toBe(false)
  })
})
