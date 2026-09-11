import type { BusinessImportType } from '@/features/import/api/businessImport'
import {
  buildExportFileName,
  type ExcelExportColumn,
  type ExcelExportSheet
} from '@/shared/lib/export/excel'

export interface ImportTemplateGuideColumn {
  key: string
  label: string
  required?: boolean
}

export interface ImportTemplateGuide {
  title: string
  targetName: string
  columns: ImportTemplateGuideColumn[]
  rows: Record<string, string>[]
  rules: string[]
}

const strategicImportGuide: ImportTemplateGuide = {
  title: '职能部门指标表示例',
  targetName: '职能部门',
  columns: [
    { key: 'department', label: '职能部门' },
    { key: 'taskType', label: '任务类型', required: true },
    { key: 'strategicTask', label: '战略任务', required: true },
    { key: 'indicatorName', label: '核心指标', required: true },
    { key: 'indicatorType', label: '指标类型', required: true },
    { key: 'weight', label: '权重' },
    { key: 'milestones', label: '里程碑明细' },
    { key: 'remark', label: '备注' }
  ],
  rows: [
    {
      department: '教务处',
      taskType: '发展性',
      strategicTask: '推进本科教育教学改革',
      indicatorName: '建设智慧教学质量监测体系',
      indicatorType: '定量',
      weight: '20%',
      milestones:
        '1. 完成方案设计（2026-03-31，30%）\n2. 完成平台试运行（2026-06-30，70%）\n3. 完成年度评估（2026-12-31，100%）',
      remark: '可填写说明'
    },
    {
      department: '教务处',
      taskType: '基础性',
      strategicTask: '完善专业建设质量保障机制',
      indicatorName: '完成重点专业年度质量报告',
      indicatorType: '定性',
      weight: '15',
      milestones: '质量报告初稿（2026-09-30，60%）\n正式提交（2026-12-31，100%）',
      remark: ''
    }
  ],
  rules: [
    '表头建议放在第一行，列顺序可以调整，系统会按列名识别。',
    '必填列：任务类型、战略任务、核心指标、指标类型；如果填写职能部门，必须和当前选择的职能部门一致。',
    '权重支持 10、10%、0.1 三种写法，系统会统一换算为百分制。',
    '里程碑可以放在一个单元格内多行填写，日期支持 2026-03-31 或 2026-03-31 00:00。'
  ]
}

const distributionImportGuide: ImportTemplateGuide = {
  title: '学院子指标表示例',
  targetName: '学院',
  columns: [
    { key: 'college', label: '学院' },
    { key: 'parentStrategicTask', label: '父级战略任务' },
    { key: 'parentIndicator', label: '父级核心指标', required: true },
    { key: 'indicatorName', label: '子指标名称', required: true },
    { key: 'indicatorType', label: '指标类型', required: true },
    { key: 'weight', label: '权重' },
    { key: 'milestones', label: '里程碑明细' },
    { key: 'remark', label: '备注' }
  ],
  rows: [
    {
      college: '计算机学院',
      parentStrategicTask: '推进本科教育教学改革',
      parentIndicator: '建设智慧教学质量监测体系',
      indicatorName: '完成学院课程质量数据接入',
      indicatorType: '定量',
      weight: '40%',
      milestones:
        '1. 完成课程清单梳理（2026-04-30，40%）\n2. 完成数据接入与核验（2026-09-30，80%）\n3. 完成年度归档（2026-12-31，100%）',
      remark: '按父级指标拆分'
    },
    {
      college: '计算机学院',
      parentStrategicTask: '完善专业建设质量保障机制',
      parentIndicator: '完成重点专业年度质量报告',
      indicatorName: '提交学院专业质量分析报告',
      indicatorType: '定性',
      weight: '60',
      milestones: '报告初稿（2026-10-31，70%）\n正式提交（2026-12-20，100%）',
      remark: ''
    }
  ],
  rules: [
    '表头建议放在第一行，列顺序可以调整，系统会按列名识别。',
    '必填列：父级核心指标、子指标名称、指标类型；如果填写学院，必须和当前选择的学院一致。',
    '父级核心指标必须能匹配当前职能部门已接收或可拆分的父级指标。',
    '权重按同一父级指标下的学院子指标合计检查，合计不是 100 会给出警告。'
  ]
}

export function getImportTemplateGuide(type: BusinessImportType): ImportTemplateGuide {
  return type === 'strategic-task' ? strategicImportGuide : distributionImportGuide
}

export function buildImportTemplateSheet(
  type: BusinessImportType
): ExcelExportSheet<Record<string, string>> {
  const guide = getImportTemplateGuide(type)

  const columns: ExcelExportColumn<Record<string, string>>[] = guide.columns.map(column => ({
    header: column.label,
    width: column.key === 'milestones' ? 30 : 22,
    getValue: row => row[column.key] || ''
  }))

  return {
    sheetName: type === 'strategic-task' ? '职能部门指标模板' : '学院子指标模板',
    rows: guide.rows,
    columns
  }
}

export function buildImportTemplateFileName(type: BusinessImportType): string {
  return buildExportFileName(
    type === 'strategic-task' ? '职能部门指标导入模板' : '学院子指标导入模板'
  )
}
