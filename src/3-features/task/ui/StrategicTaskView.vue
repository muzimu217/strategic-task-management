<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Plus,
  View,
  Download,
  Delete,
  ArrowDown,
  Check,
  Loading,
  Timer,
  Upload
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import AppAvatar from '@/shared/ui/avatar/AppAvatar.vue'
import IndicatorMilestoneTimeline from '@/features/indicator/ui/IndicatorMilestoneTimeline.vue'
import { DistributionApprovalProgressDrawer } from '@/features/approval'
import BusinessImportDialog from '@/features/import/ui/BusinessImportDialog.vue'
import { resolveMilestoneDisplayState } from '@/shared/lib/utils/milestoneDisplay'
import { resolveIndicatorYear } from '@/shared/lib/utils/indicatorYear'
import type { StrategicIndicator } from '@/shared/types'
import {
  buildAttachmentCell,
  buildExportFileName,
  exportRowsToExcel,
  exportSheetsToExcel,
  formatProgress,
  type ExcelExportColumn,
  type ExcelExportSheet,
  type ExcelRowTone
} from '@/shared/lib/export/excel'
import type { ManualAlertSeverity } from '@/shared/api/monitoringApi'
import {
  useStrategicTaskView,
  type StrategicTaskViewProps
} from '@/features/task/model/useStrategicTaskView'
import { strategicApi } from '@/features/task/api/strategicApi'
import { useStrategicStore } from '@/features/task/model/strategic'
import {
  MANUAL_ALERT_LOCKED_HINT,
  MANUAL_ALERT_READONLY_HINT,
  canEditManualAlertLevel
} from '@/features/task/lib/warning-level'
import type { ImportCommitResponse } from '@/features/import/api/businessImport'

const props = defineProps<StrategicTaskViewProps>()
const strategicStore = useStrategicStore()

const {
  PLAN_APPROVAL_HISTORY_WORKFLOW_CODES,
  PLAN_APPROVAL_SUBMIT_WORKFLOW_CODE,
  _addIndicatorToCategory,
  _calculateMilestoneStatus,
  _currentDate,
  _currentTask,
  _deleteIndicator,
  _formatUpdateTime,
  _getMilestoneProgressText,
  _getProgressClass,
  _goToIndicator,
  _groupedBasicIndicators,
  _groupedDevelopmentIndicators,
  _handleBatchDeleteByTask,
  _handleBatchDistributeByTask,
  _handleBatchWithdrawByTask,
  _handleDoubleClick,
  _handleTableScroll,
  _handleViewMilestones,
  _handleWithdraw,
  _handleWithdrawTask,
  _hasPendingApprovalForDept,
  _openDistributeDialog,
  _saveEdit,
  _selectTask,
  _tableScrollRef,
  _toggleViewMode,
  addMilestone,
  addMilestoneInDialog,
  addNewRow,
  addRowFormRef,
  approvalEntryButtonText,
  approvalFlowStatusMeta,
  approvalIndicators,
  approvalPreviewLoading,
  approvalSetupDialogVisible,
  approvalSubmitComment,
  approvalStatusPopoverLoading,
  approvalStore,
  approvalSubmitting,
  approvalWorkflowPreview,
  approvalWorkflowReportSummary,
  approveIndicatorReview,
  assignmentMethod,
  assignmentTarget,
  authStore,
  backendTaskTypeMap,
  basicIndicators,
  buildTaskIdSet,
  buildTaskTypeMap,
  canCurrentUserHandleCurrentIndicatorWorkflow,
  canCurrentUserSubmitCurrentPlan,
  canDeleteIndicator,
  canDistribute,
  canEdit,
  canEditIndicators,
  canWithdrawPlan,
  cancelAdd,
  cancelEdit,
  cancelIndicatorEdit,
  cancelMilestoneEdit,
  closeDistributeDialog,
  confirmAssignment,
  confirmDistribute,
  confirmPlanApprovalSubmission,
  createTempMilestoneId,
  currentApprovalApproverName,
  currentApprovalCandidateNames,
  currentApprovalFlowName,
  currentApprovalStepName,
  currentApprovalStepPreview,
  currentApprovalWorkflowStatus,
  currentDepartmentOrgId,
  currentDetail,
  currentDistributeGroup,
  currentDistributeItem,
  currentIndicator,
  currentIndicatorIndex,
  currentIndicatorWorkflow,
  currentIndicatorWorkflowLoading,
  currentMilestoneIndicator,
  currentPlan,
  currentPlanReportSummary,
  currentPlanScopeLoading,
  currentPlanStatus,
  currentPlanTaskIdSet,
  currentPlanTaskIdSetSignature,
  currentPlanTaskTypeMap,
  currentTaskIndex,
  currentUserId,
  currentUserOrgId,
  currentUserPermissionCodes,
  currentUserRoleCodes,
  departmentAliasNameMap,
  departmentIdNameMap,
  departmentNameIdMap,
  departmentTotalWeight,
  departmentViewLoadingRequestId,
  departmentViewRequestId,
  detailDrawerVisible,
  developmentIndicators,
  distributeButtonDisabled,
  distributeButtonDisabledReason,
  distributeButtonIcon,
  distributeButtonText,
  distributeButtonType,
  distributeDialogVisible,
  distributeTarget,
  editingField,
  editingIndicatorField,
  editingIndicatorId,
  editingIndicatorValue,
  editingMilestoneIndicator,
  editingMilestones,
  editingValue,
  ensurePersistedTaskIdForIndicator,
  ensurePlanCanDistribute,
  existingTaskNames,
  extractMilestones,
  findCurrentPlanByDepartment,
  findCurrentPlanByOrgId,
  findExistingTaskIdByName,
  formatDetailDate,
  functionalDepartments,
  generateMonthlyMilestones,
  generateMonthlyMilestonesInDialog,
  getCategoryColor,
  getCategoryText,
  getDisplayedReportedProgress,
  getCurrentActorUserId,
  getCurrentScopeIndicatorsForMilestones,
  getIndicatorCategoryLabel,
  getIndicatorMappedTaskType,
  getIndicatorTaskId,
  getPersistedWithdrawableRows,
  getProgressColor,
  getProgressStatus,
  getPendingProgressDelta,
  getRouteQueryText,
  getSpanMethod,
  getTaskCategoryLabel,
  getTaskGroup,
  getTaskStatus,
  getTaskTypeForPersistence,
  hasPendingProgressContent,
  hasPendingProgressValue,
  goToNextIndicator,
  goToPrevIndicator,
  groupIndicatorsByTask,
  handleAddIndicatorToTask,
  handleApprovalRefresh,
  handleApprovalStatusPopoverShow,
  handleApproveCurrentIndicatorWorkflow,
  handleCancelAssignment,
  handleCloseApprovalSetupDialog,
  handleDeleteIndicator,
  handleDistributeAll,
  handleDistributeOrWithdraw,
  handleEditMilestones,
  handleEditingMilestoneProgressChange,
  handleGlobalClick,
  handleIndicatorDblClick,
  handleMilestoneDeadlineChange,
  handleNewRowMilestoneProgressChange,
  handleOpenApproval,
  handleRejectCurrentIndicatorWorkflow,
  handleSelectionChange,
  handleTaskSelect,
  handleTaskVisibleChange,
  handleViewDetail,
  handleWithdrawAll,
  hasApprovalPreview,
  hasApprovalStepCandidates,
  hasApprovalWorkflowReportBinding,
  hasDistributedIndicators,
  hasWorkflowBinding,
  hydrateCurrentPlanWorkflowState,
  hydratingPlanDetail,
  indicatorByIdMap,
  indicatorWorkflowCache,
  indicators,
  isDepartmentSwitching,
  isAddingOrEditing,
  isBasicIndicatorForCurrentRules,
  isBasicTaskType,
  isBootstrappingPage,
  isCurrentUserReporter,
  isDevelopmentTaskType,
  isIndicatorInCurrentPlanScope,
  isIndicatorInFlowStage,
  isInitialDataLoading,
  isPlanDistributed,
  isReadOnly,
  isSavingIndicatorCell,
  isSavingIndicatorEdit,
  isSavingMilestoneEdit,
  isStrategicDept,
  isTableScrolling,
  lastEditTime,
  latestPlanReportSummary,
  loadBackendTaskTypeMap,
  loadCurrentPlanTaskScope,
  loadIndicatorWorkflowSnapshot,
  loadMilestonePayloads,
  loadMilestonePayloadsIndividually,
  loadMilestonesForCurrentScope,
  loadPendingPlanApprovalCount,
  loadedMilestoneIds,
  loadingMilestoneIds,
  milestoneCache,
  milestoneDrawerVisible,
  milestoneEditDialogVisible,
  milestoneFallbackConcurrency,
  milestoneLoadRequestId,
  milestoneMap,
  newRow,
  normalizeDepartmentName,
  normalizeEditableText,
  normalizeMilestone,
  normalizePreviewCandidateDisplayName,
  normalizeTaskId,
  normalizeWorkflowStepName,
  normalizedIndicators,
  openApprovalSetupDialog,
  openNewRowDialog,
  orgStore,
  overallStatus,
  pageTransitionLoading,
  pendingApprovalCount,
  pendingPlanApprovalCount,
  permissionUtil,
  persistNewIndicatorMilestones,
  persistTaskContentEdit,
  planStore,
  planUiPhase,
  preloadApprovalWorkflowDetail,
  preloadedPlanWorkflowDetail,
  preservePrefilledTaskBindingOnce,
  primaryApprovalWorkflowEntityId,
  primaryApprovalWorkflowEntityType,
  secondaryApprovalWorkflowEntityId,
  secondaryApprovalWorkflowEntityType,
  refreshApprovalWorkflowSummaries,
  refreshCurrentDepartmentView,
  refreshIndicatorWorkflowContext,
  refreshTaskPageAfterIndicatorMutation,
  registerTaskLocally,
  rejectIndicatorReview,
  reloadMilestonesForIndicator,
  removeMilestone,
  removeMilestoneInDialog,
  resetApprovalSetupDialog,
  resetApprovalWorkflowStateCache,
  resetNewRow,
  resolveDepartmentIdByName,
  resolveExpectedApproverOrgIdForCurrentPlan,
  resolveExpectedApproverRoleCodesForCurrentPlan,
  resolvePlanYear,
  route,
  router,
  saveIndicatorEdit,
  saveMilestoneEdit,
  saveNewRow,
  savingIndicatorField,
  savingIndicatorId,
  selectedDepartment,
  selectedIndicators,
  selectDepartment,
  shouldShowReportedProgress,
  showAssignmentDialog,
  syncCurrentPlanReportSummaries,
  syncSelectedDepartmentFromRoute,
  tableRef,
  taskApprovalVisible,
  taskList,
  taskSelectRef,
  taskSpanMetaMap,
  taskTypeMap,
  taskTypeMapLoading,
  timeContext,
  toMilestoneDueDate,
  toMilestoneRequestStatus,
  toMilestoneStatus,
  triggerApprovalForDistribution,
  updateEditTime,
  viewMode
} = useStrategicTaskView(props)

type StrategicExportRow = StrategicIndicator & {
  exportDepartment: string
}

const strategicExporting = ref(false)
const strategicBatchExportDialogVisible = ref(false)
const selectedStrategicExportDepartments = ref<string[]>([])
const strategicImportDialogVisible = ref(false)
const savingManualAlertIndicatorId = ref<string | number | null>(null)
type ManualAlertSelectValue = Exclude<ManualAlertSeverity, null> | ''

const manualAlertOptions: Array<{
  label: string
  value: ManualAlertSelectValue
  type: 'success' | 'info' | 'warning' | 'danger'
}> = [
  { label: '无预警', value: '', type: 'success' },
  { label: '一般滞后', value: 'INFO', type: 'info' },
  { label: '严重滞后', value: 'WARNING', type: 'warning' },
  { label: '重大滞后', value: 'CRITICAL', type: 'danger' }
]

const getManualAlertOption = (severity?: ManualAlertSeverity) =>
  manualAlertOptions.find(option => option.value === (severity ?? '')) || manualAlertOptions[0]

const getManualAlertLabel = (severity?: ManualAlertSeverity) => getManualAlertOption(severity).label

const getManualAlertTagType = (severity?: ManualAlertSeverity) =>
  getManualAlertOption(severity).type

const handleManualAlertChange = async (
  row: StrategicIndicator,
  selectedSeverity: ManualAlertSelectValue
) => {
  const severity: ManualAlertSeverity = selectedSeverity === '' ? null : selectedSeverity
  const previousSeverity = row.manualAlertSeverity ?? null
  if (previousSeverity === severity) {
    return
  }

  const label = getManualAlertLabel(severity)
  try {
    await ElMessageBox.confirm(
      `确认将「${row.name || '该指标'}」的预警等级调整为「${label}」？确认后会通知对应下级部门。`,
      '调整预警等级',
      {
        confirmButtonText: '确认调整',
        cancelButtonText: '取消',
        type: severity ? 'warning' : 'info'
      }
    )

    savingManualAlertIndicatorId.value = row.id
    await strategicStore.updateManualAlertLevel(String(row.id), severity)
    ElMessage.success(severity ? '预警等级已调整，并已通知下级部门' : '预警已取消')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(error instanceof Error && error.message ? error.message : '预警等级调整失败')
    }
  } finally {
    savingManualAlertIndicatorId.value = null
  }
}

const allStrategicExportDepartmentsSelected = computed({
  get: () =>
    functionalDepartments.value.length > 0 &&
    selectedStrategicExportDepartments.value.length === functionalDepartments.value.length,
  set: checked => {
    selectedStrategicExportDepartments.value = checked ? [...functionalDepartments.value] : []
  }
})

const strategicExportDepartmentsIndeterminate = computed(
  () =>
    selectedStrategicExportDepartments.value.length > 0 &&
    selectedStrategicExportDepartments.value.length < functionalDepartments.value.length
)

const strategicExportColumns: ExcelExportColumn<StrategicExportRow>[] = [
  { header: '序号', width: 8, align: 'center', getValue: (_row, index) => index + 1 },
  { header: '部门', width: 18, getValue: row => row.exportDepartment },
  { header: '战略任务', width: 28, getValue: row => row.taskContent || '-' },
  { header: '核心指标', width: 32, getValue: row => row.name || '-' },
  { header: '指标类型', width: 12, align: 'center', getValue: row => row.type1 || '-' },
  {
    header: '任务类别',
    width: 12,
    align: 'center',
    getValue: row => getCategoryText(row.type2)
  },
  { header: '备注', width: 24, getValue: row => row.remark || '-' },
  { header: '权重', width: 10, align: 'center', getValue: row => Number(row.weight || 0) },
  {
    header: '进度',
    width: 24,
    getValue: row => formatProgress(row.progress, getDisplayedReportedProgress(row))
  },
  {
    header: '预警等级判定',
    width: 18,
    align: 'center',
    getValue: row => getManualAlertLabel(row.manualAlertSeverity)
  },
  {
    header: '附件',
    width: 42,
    getValue: row =>
      buildAttachmentCell(
        (row as StrategicIndicator & { pendingAttachmentDetails?: unknown[] })
          .pendingAttachmentDetails?.length
          ? (row as StrategicIndicator & { pendingAttachmentDetails?: unknown[] })
              .pendingAttachmentDetails
          : row.pendingAttachments
      )
  }
]

const findStrategicExportPlanByDepartment = (department: string) => {
  const normalizedDepartment = normalizeDepartmentName(department)
  const departmentOrgId = resolveDepartmentIdByName(department)
  const sourceOrgId = Number(
    (currentPlan.value as Record<string, unknown> | null)?.createdByOrgId ??
      (currentPlan.value as Record<string, unknown> | null)?.created_by_org_id ??
      35
  )

  const plans = planStore.plans.filter(plan => {
    const planRecord = plan as Record<string, unknown>
    const planYear = resolvePlanYear(planRecord)
    const planTargetOrgId = Number(planRecord.targetOrgId ?? planRecord.org_id ?? planRecord.orgId)
    const planTargetOrgName = normalizeDepartmentName(
      String(planRecord.targetOrgName || planRecord.orgName || '')
    )

    return (
      planYear === timeContext.currentYear &&
      ((departmentOrgId != null &&
        Number.isFinite(planTargetOrgId) &&
        planTargetOrgId === departmentOrgId) ||
        planTargetOrgName === normalizedDepartment)
    )
  })

  return (
    plans.find(plan => {
      const planRecord = plan as Record<string, unknown>
      const planCreatedByOrgId = Number(planRecord.createdByOrgId ?? planRecord.created_by_org_id)
      const planLevel = String(planRecord.planLevel || planRecord.plan_level || '')
        .trim()
        .toUpperCase()

      return (
        Number.isFinite(planCreatedByOrgId) &&
        planCreatedByOrgId === sourceOrgId &&
        planLevel === 'STRAT_TO_FUNC'
      )
    }) ||
    plans[0] ||
    null
  )
}

const loadStrategicExportTaskIdSetByDepartment = async (
  department: string
): Promise<Set<string>> => {
  const plan = findStrategicExportPlanByDepartment(department)
  const planId = plan?.id
  if (!planId) {
    return new Set()
  }

  const response = await strategicApi.getTasksByPlanId(planId)
  if (!response?.success || !Array.isArray(response.data)) {
    return new Set()
  }

  return new Set(buildTaskIdSet(response.data as Array<Record<string, unknown>>))
}

const getStrategicExportRowsByDepartment = (
  department: string,
  planTaskIdSet?: Set<string>
): StrategicExportRow[] => {
  const rows = normalizedIndicators.value
    .filter(
      indicator =>
        resolveIndicatorYear(indicator, timeContext.currentYear) === timeContext.currentYear
    )
    .filter(
      indicator =>
        indicator.ownerDept === '战略发展部' &&
        indicator.responsibleDept === department &&
        indicator.isStrategic === true &&
        (planTaskIdSet
          ? planTaskIdSet.has(getIndicatorTaskId(indicator))
          : isIndicatorInCurrentPlanScope(indicator))
    )
    .map(indicator => ({
      ...indicator,
      type2: getIndicatorCategoryLabel(indicator),
      exportDepartment: department
    }))

  return rows.sort((left, right) => {
    const leftRank = getStrategicTaskTypeRank(left)
    const rightRank = getStrategicTaskTypeRank(right)
    if (leftRank !== rightRank) {
      return leftRank - rightRank
    }
    return String(left.taskContent || '').localeCompare(String(right.taskContent || ''))
  })
}

const getStrategicTaskTypeRank = (indicator: StrategicIndicator): number => {
  const taskType = getIndicatorMappedTaskType(indicator)
  if (isDevelopmentTaskType(taskType)) {
    return 0
  }
  if (isBasicTaskType(taskType)) {
    return 1
  }
  return 2
}

const getStrategicExportRowTone = (row: StrategicExportRow): ExcelRowTone => {
  const category = getCategoryText(row.type2)
  if (category.includes('发展')) {
    return 'development'
  }
  if (category.includes('基础')) {
    return 'basic'
  }
  return 'default'
}

const getStrategicExportRowTextColor = (row: StrategicExportRow): string | undefined =>
  row.manualAlertSeverity === 'CRITICAL'
    ? '#f56c6c'
    : row.manualAlertSeverity === 'WARNING'
      ? '#e6a23c'
      : undefined

const buildStrategicExportSheet = (
  department: string,
  rows = getStrategicExportRowsByDepartment(department)
): ExcelExportSheet<StrategicExportRow> => ({
  sheetName: department || '当前部门',
  rows,
  columns: strategicExportColumns,
  emptyMessage: '当前部门暂无可导出的战略任务指标',
  getRowTone: getStrategicExportRowTone,
  getRowTextColor: getStrategicExportRowTextColor
})

const handleExportCurrentStrategicDepartment = async () => {
  const department = selectedDepartment.value
  if (!department) {
    ElMessage.warning('请先选择部门')
    return
  }

  const rows = getStrategicExportRowsByDepartment(department)
  if (rows.length === 0) {
    ElMessage.warning('当前部门暂无可导出的数据')
    return
  }

  strategicExporting.value = true
  try {
    await exportRowsToExcel(
      buildStrategicExportSheet(department, rows),
      buildExportFileName('战略任务指标总表', department)
    )
    ElMessage.success('导出成功')
  } catch {
    ElMessage.error('导出失败，请稍后重试')
  } finally {
    strategicExporting.value = false
  }
}

const openStrategicBatchExportDialog = () => {
  selectedStrategicExportDepartments.value = [...functionalDepartments.value]
  strategicBatchExportDialogVisible.value = true
}

const handleExportSelectedStrategicDepartments = async () => {
  const departments = selectedStrategicExportDepartments.value
  if (departments.length === 0) {
    ElMessage.warning('请选择要导出的部门')
    return
  }

  strategicExporting.value = true
  try {
    await Promise.all([
      planStore.loadPlans({ force: true, background: true }),
      strategicStore.loadIndicatorsByYear(timeContext.currentYear, { force: true })
    ])

    const sheets = await Promise.all(
      departments.map(async department => {
        const taskIdSet = await loadStrategicExportTaskIdSetByDepartment(department)
        return buildStrategicExportSheet(
          department,
          getStrategicExportRowsByDepartment(department, taskIdSet)
        ) as ExcelExportSheet<unknown>
      })
    )

    await exportSheetsToExcel(
      sheets,
      buildExportFileName('战略任务指标总表', departments.length === 1 ? departments[0] : '多部门')
    )
    strategicBatchExportDialogVisible.value = false
    ElMessage.success('导出成功')
  } catch {
    ElMessage.error('导出失败，请稍后重试')
  } finally {
    strategicExporting.value = false
  }
}

const currentStrategicImportOrgId = computed(
  () => currentDepartmentOrgId.value ?? resolveDepartmentIdByName(selectedDepartment.value) ?? null
)

const currentStrategicImportCycleId = computed(() => {
  const selectedPlan = currentPlan.value as {
    cycleId?: number | string
    cycle_id?: number | string
  } | null
  const directCycleId = selectedPlan?.cycleId ?? selectedPlan?.cycle_id
  const numericDirectCycleId = Number(directCycleId)
  if (Number.isFinite(numericDirectCycleId) && numericDirectCycleId > 0) {
    return numericDirectCycleId
  }

  const cycle = timeContext.cycles.find(item => Number(item.year) === timeContext.currentYear) as
    | { cycleId?: number | string; id?: number | string }
    | undefined
  const numericCycleId = Number(cycle?.cycleId ?? cycle?.id)
  return Number.isFinite(numericCycleId) && numericCycleId > 0 ? numericCycleId : null
})

const openStrategicImportDialog = () => {
  if (!selectedDepartment.value || !currentStrategicImportOrgId.value) {
    ElMessage.warning('请先选择要导入的职能部门')
    return
  }
  if (!currentStrategicImportCycleId.value) {
    ElMessage.warning('当前周期信息不可用，暂不能导入')
    return
  }
  strategicImportDialogVisible.value = true
}

const handleStrategicImportCommitted = async (result?: ImportCommitResponse) => {
  await refreshCurrentDepartmentView({ showLoading: true, force: true, reloadIndicators: true })

  if (result?.workflow?.autoSubmitAndApprove || result?.workflow?.instanceId) {
    resetApprovalWorkflowStateCache()
    await refreshApprovalWorkflowSummaries()
    await preloadApprovalWorkflowDetail()
  }
}
</script>

<template>
  <div class="strategic-task-container page-fade-enter">
    <!-- 侧边栏遮罩层 -->
    <div class="sidebar-backdrop"></div>

    <!-- 左侧任务列表 - 动态隐藏 -->
    <aside class="task-sidebar">
      <div class="sidebar-header">
        <div class="task-list-title">部门列表</div>
      </div>

      <ul class="task-list">
        <li
          v-for="dept in functionalDepartments"
          :key="dept"
          :class="['task-item', { active: selectedDepartment === dept }]"
          @click="selectDepartment(dept)"
        >
          {{ dept }}
        </li>
      </ul>
    </aside>
    <!-- 展开箭头独立于侧边栏 - 使用SVG图标 -->
    <div class="sidebar-toggle">
      <svg class="toggle-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M9 6L15 12L9 18"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          fill="none"
        />
      </svg>
      <span class="toggle-hint">{{ selectedDepartment || functionalDepartments[0] || '' }}</span>
    </div>

    <!-- 右侧详情区域 - Excel风格 -->
    <section
      :class="[
        'task-detail',
        'excel-style',
        'card-animate',
        { 'department-switching': isDepartmentSwitching }
      ]"
      style="animation-delay: 0.1s"
    >
      <!-- Excel标题头 -->
      <div class="excel-header">
        <h2 class="excel-title">战略任务指标总表</h2>
        <div class="excel-header-status">
          <el-button
            type="primary"
            plain
            size="small"
            :loading="strategicExporting"
            @click="openStrategicBatchExportDialog"
          >
            <el-icon><Download /></el-icon>
            全部导出
          </el-button>
          <el-tag :type="overallStatus.type" size="small">
            计划状态: {{ isInitialDataLoading ? '加载中...' : overallStatus.label }}
          </el-tag>
        </div>
      </div>

      <!-- Excel工具栏 -->
      <div class="excel-toolbar">
        <div class="toolbar-left">
          <el-button
            type="primary"
            size="small"
            :disabled="isReadOnly || hasDistributedIndicators"
            @click.stop="addNewRow"
          >
            <el-icon><Plus /></el-icon>
            新增行
          </el-button>
          <!-- 下发/撤回合并按钮 -->
          <el-button
            :type="distributeButtonType"
            size="small"
            :disabled="distributeButtonDisabled"
            :title="distributeButtonDisabledReason"
            @click.stop="handleDistributeOrWithdraw"
          >
            <el-icon><component :is="distributeButtonIcon" /></el-icon>
            {{ distributeButtonText }}
          </el-button>
          <div class="approval-entry-wrapper">
            <!-- 审批进度按钮（带徽章） -->
            <el-badge v-if="pendingApprovalCount > 0" is-dot class="approval-badge">
              <el-button
                size="small"
                type="warning"
                class="approval-entry-action"
                @click="handleOpenApproval"
              >
                <el-icon><Check /></el-icon>
                {{ approvalEntryButtonText }}
              </el-button>
            </el-badge>
            <el-button
              v-else
              size="small"
              class="approval-entry-action"
              @click="handleOpenApproval"
            >
              <el-icon><Check /></el-icon>
              {{ approvalEntryButtonText }}
            </el-button>
          </div>
          <el-button
            size="small"
            :loading="strategicExporting"
            @click="handleExportCurrentStrategicDepartment"
          >
            <el-icon><Download /></el-icon>
            导出
          </el-button>
          <el-button size="small" :icon="Upload" @click="openStrategicImportDialog">
            导入
          </el-button>
          <!-- 视图切换按钮 -->
          <el-button-group style="margin-left: 16px">
            <el-button
              :type="viewMode === 'table' ? 'primary' : ''"
              size="small"
              @click="viewMode = 'table'"
            >
              <el-icon><View /></el-icon>
              表格视图
            </el-button>
            <el-button
              :type="viewMode === 'card' ? 'primary' : ''"
              size="small"
              @click="viewMode = 'card'"
            >
              <el-icon><View /></el-icon>
              卡片视图
            </el-button>
          </el-button-group>
        </div>
        <div class="toolbar-right">
          <el-popover
            placement="top-end"
            trigger="hover"
            :width="320"
            popper-class="approval-status-popper"
            @show="handleApprovalStatusPopoverShow"
          >
            <template #reference>
              <el-tag
                :type="approvalFlowStatusMeta.tagType"
                effect="light"
                class="approval-status-tag"
                @click.stop="handleOpenApproval"
              >
                审批状态: {{ approvalFlowStatusMeta.label }}
              </el-tag>
            </template>

            <div class="approval-status-card" @click.stop="handleOpenApproval">
              <div class="approval-status-card__header">
                <span class="approval-status-card__title">流程状态</span>
              </div>
              <div class="approval-status-card__body">
                <div class="approval-status-card__row">
                  <span class="approval-status-card__label">说明</span>
                  <span class="approval-status-card__value">
                    {{ approvalFlowStatusMeta.description }}
                  </span>
                </div>
                <div
                  v-if="approvalStatusPopoverLoading || currentApprovalFlowName"
                  class="approval-status-card__row"
                >
                  <span class="approval-status-card__label">审批流</span>
                  <span class="approval-status-card__value">
                    {{ approvalStatusPopoverLoading ? '加载中...' : currentApprovalFlowName }}
                  </span>
                </div>
                <div v-if="currentApprovalStepName" class="approval-status-card__row">
                  <span class="approval-status-card__label">当前节点</span>
                  <span class="approval-status-card__value">{{ currentApprovalStepName }}</span>
                </div>
                <div
                  v-if="currentApprovalCandidateNames.length > 0"
                  class="approval-status-card__row"
                >
                  <span class="approval-status-card__label">可审批人</span>
                  <span class="approval-status-card__value">
                    {{ currentApprovalCandidateNames.join('、') }}
                  </span>
                </div>
              </div>
              <div class="approval-status-card__footer">点击可进入审批中心</div>
            </div>
          </el-popover>
          <el-tag
            :type="
              departmentTotalWeight > 100
                ? 'danger'
                : departmentTotalWeight === 100
                  ? 'success'
                  : 'info'
            "
            :class="{ 'weight-tag--overlimit': departmentTotalWeight > 100 }"
            size="small"
            style="margin-right: 12px"
          >
            基础性权重合计: {{ departmentTotalWeight }} / 100
          </el-tag>
          <el-tag v-if="isReadOnly" type="warning" size="small" style="margin-right: 12px">
            历史快照 (只读)
          </el-tag>
        </div>
      </div>

      <!-- 待审批进度警告提示 -->
      <el-alert
        v-if="pendingApprovalCount > 0 && !hasDistributedIndicators"
        type="warning"
        :closable="false"
        style="margin: 12px 16px"
      >
        <template #title> 当前计划已进入审批流程，请先完成整体计划审批后再继续下发或编辑 </template>
      </el-alert>

      <!-- Excel表格 -->
      <div class="excel-table-wrapper">
        <div v-if="isInitialDataLoading" class="page-loading-state">
          <div class="loading-header">
            <el-icon class="is-loading"><Loading /></el-icon>
            <span>正在加载指标数据，请稍候...</span>
          </div>
          <el-skeleton :rows="8" animated />
        </div>

        <template v-else>
          <!-- 表格视图 -->
          <div v-if="viewMode === 'table'" class="table-container">
            <el-table
              ref="tableRef"
              :data="indicators"
              :span-method="getSpanMethod"
              border
              highlight-current-row
              class="unified-table"
              @selection-change="handleSelectionChange"
            >
              <el-table-column prop="taskContent" label="战略任务" width="180">
                <template #default="{ row }">
                  <div class="task-cell-wrapper">
                    <div
                      class="indicator-name-cell"
                      @dblclick="handleIndicatorDblClick(row, 'taskContent')"
                    >
                      <el-input
                        v-if="
                          editingIndicatorId === row.id && editingIndicatorField === 'taskContent'
                        "
                        v-model="editingIndicatorValue"
                        v-focus
                        type="textarea"
                        :autosize="{ minRows: 2, maxRows: 6 }"
                        @blur="saveIndicatorEdit(row, 'taskContent')"
                        @keyup.esc="cancelIndicatorEdit"
                      />
                      <span
                        v-else-if="isSavingIndicatorCell(row, 'taskContent')"
                        class="cell-saving-text"
                      >
                        保存中...
                      </span>
                      <el-tooltip
                        v-else
                        :content="`${getCategoryText(row.type2)}任务`"
                        placement="top"
                      >
                        <span
                          class="indicator-name-text task-content-colored"
                          :style="{ color: getCategoryColor(row.type2) }"
                          >{{ row.taskContent || '未关联任务' }}</span
                        >
                      </el-tooltip>
                    </div>

                    <!-- 右下角新增指标三角形按钮 -->
                    <div
                      v-if="!isReadOnly && getTaskStatus(row).canWithdraw"
                      class="add-indicator-trigger"
                      @click="handleAddIndicatorToTask(row)"
                    >
                      <span class="trigger-icon">+</span>
                    </div>
                  </div>
                </template>
              </el-table-column>
              <el-table-column prop="name" label="核心指标" min-width="150">
                <template #default="{ row }">
                  <div class="indicator-name-cell" @dblclick="handleIndicatorDblClick(row, 'name')">
                    <el-input
                      v-if="editingIndicatorId === row.id && editingIndicatorField === 'name'"
                      v-model="editingIndicatorValue"
                      v-focus
                      type="textarea"
                      :autosize="{ minRows: 2, maxRows: 6 }"
                      @blur="saveIndicatorEdit(row, 'name')"
                    />
                    <span v-else-if="isSavingIndicatorCell(row, 'name')" class="cell-saving-text">
                      保存中...
                    </span>
                    <template v-else>
                      <template v-if="row.name">
                        <el-tooltip
                          :content="
                            row.type1 === '定性'
                              ? '定性指标'
                              : row.type1 === '定量'
                                ? '定量指标'
                                : '未设置类型'
                          "
                          placement="top"
                        >
                          <span
                            class="indicator-name-text"
                            :class="
                              row.type1 === '定性'
                                ? 'indicator-qualitative'
                                : row.type1 === '定量'
                                  ? 'indicator-quantitative'
                                  : ''
                            "
                            >{{ row.name }}</span
                          >
                        </el-tooltip>
                      </template>
                      <span v-else class="indicator-name-text placeholder-text">双击编辑指标</span>
                    </template>
                  </div>
                </template>
              </el-table-column>
              <el-table-column prop="remark" label="备注" width="130">
                <template #default="{ row }">
                  <div
                    class="indicator-name-cell"
                    @dblclick="handleIndicatorDblClick(row, 'remark')"
                  >
                    <el-input
                      v-if="editingIndicatorId === row.id && editingIndicatorField === 'remark'"
                      v-model="editingIndicatorValue"
                      v-focus
                      type="textarea"
                      :autosize="{ minRows: 2, maxRows: 6 }"
                      @blur="saveIndicatorEdit(row, 'remark')"
                      @keyup.esc="cancelIndicatorEdit"
                    />
                    <span v-else-if="isSavingIndicatorCell(row, 'remark')" class="cell-saving-text">
                      保存中...
                    </span>
                    <span v-else class="indicator-name-text remark-text-wrap">{{
                      row.remark || '样例：双击编辑说明'
                    }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column prop="weight" label="权重" width="100" align="center">
                <template #default="{ row }">
                  <div class="weight-cell" @dblclick="handleIndicatorDblClick(row, 'weight')">
                    <el-input
                      v-if="editingIndicatorId === row.id && editingIndicatorField === 'weight'"
                      v-model="editingIndicatorValue"
                      v-focus
                      size="small"
                      style="width: 50px"
                      @blur="saveIndicatorEdit(row, 'weight')"
                      @keyup.enter="saveIndicatorEdit(row, 'weight')"
                    />
                    <span v-else-if="isSavingIndicatorCell(row, 'weight')" class="cell-saving-text">
                      保存中...
                    </span>
                    <span v-else class="weight-text">{{ row.weight }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column prop="progress" label="进度" width="120" align="center">
                <template #default="{ row }">
                  <div class="progress-cell" @dblclick="handleIndicatorDblClick(row, 'progress')">
                    <div
                      v-if="editingIndicatorId === row.id && editingIndicatorField === 'progress'"
                      class="progress-edit-field"
                    >
                      <el-input
                        v-model="editingIndicatorValue"
                        v-focus
                        size="small"
                        style="width: 54px"
                        @blur="saveIndicatorEdit(row, 'progress')"
                        @keyup.enter="saveIndicatorEdit(row, 'progress')"
                      />
                      <span class="progress-suffix">%</span>
                    </div>
                    <span
                      v-else-if="isSavingIndicatorCell(row, 'progress')"
                      class="cell-saving-text"
                    >
                      保存中...
                    </span>
                    <!-- 始终显示已审批通过的进度（progress），不显示待审批进度 -->
                    <template v-else>
                      <span class="progress-number">{{ row.progress || 0 }}%</span>
                      <el-tooltip
                        v-if="shouldShowReportedProgress(row)"
                        content="填报进度"
                        placement="top"
                      >
                        <span class="reported-progress"
                          >({{ getDisplayedReportedProgress(row) }}%)</span
                        >
                      </el-tooltip>
                    </template>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="预警等级判定" width="150" align="center">
                <template #default="{ row }">
                  <div class="manual-alert-cell">
                    <el-tooltip
                      v-if="isStrategicDept"
                      :disabled="
                        canEditManualAlertLevel(currentPlanStatus, { readOnly: isReadOnly })
                      "
                      :content="isReadOnly ? MANUAL_ALERT_READONLY_HINT : MANUAL_ALERT_LOCKED_HINT"
                      placement="top"
                    >
                      <div
                        class="manual-alert-select-wrapper"
                        :class="{
                          'manual-alert-select-wrapper--locked': !canEditManualAlertLevel(
                            currentPlanStatus,
                            { readOnly: isReadOnly }
                          )
                        }"
                      >
                        <el-select
                          :model-value="row.manualAlertSeverity ?? ''"
                          size="small"
                          class="manual-alert-select"
                          :disabled="
                            !canEditManualAlertLevel(currentPlanStatus, { readOnly: isReadOnly }) ||
                            savingManualAlertIndicatorId === row.id
                          "
                          :loading="savingManualAlertIndicatorId === row.id"
                          @change="
                            value => handleManualAlertChange(row, value as ManualAlertSelectValue)
                          "
                        >
                          <el-option
                            v-for="option in manualAlertOptions"
                            :key="option.value || 'NONE'"
                            :label="option.label"
                            :value="option.value"
                          />
                        </el-select>
                      </div>
                    </el-tooltip>
                    <el-tag
                      v-else
                      :type="getManualAlertTagType(row.manualAlertSeverity)"
                      size="small"
                    >
                      {{ getManualAlertLabel(row.manualAlertSeverity) }}
                    </el-tag>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="240" align="center">
                <template #default="{ row }">
                  <div class="action-buttons-inline">
                    <!-- 查看按钮 - 始终显示 -->
                    <el-button link type="primary" size="small" @click="handleViewDetail(row)"
                      >查看</el-button
                    >

                    <!-- 里程碑按钮 - 仅草稿状态可编辑 -->
                    <el-button
                      v-if="canEditIndicators"
                      link
                      type="primary"
                      size="small"
                      @click="handleEditMilestones(row)"
                      >里程碑</el-button
                    >

                    <!-- 删除按钮 - 仅草稿状态可删除 -->
                    <el-button
                      v-if="canDeleteIndicator(row)"
                      link
                      type="danger"
                      size="small"
                      @click="handleDeleteIndicator(row)"
                      >删除</el-button
                    >
                  </div>
                </template>
              </el-table-column>
            </el-table>
          </div>

          <!-- 卡片视图 -->
          <div v-else-if="viewMode === 'card'" class="card-container">
            <!-- 卡片导航栏 -->
            <div v-if="indicators.length > 0" class="card-navigation">
              <div class="nav-left">
                <el-button
                  :disabled="currentIndicatorIndex === 0"
                  size="small"
                  @click="goToPrevIndicator"
                >
                  <el-icon><ArrowDown style="transform: rotate(90deg)" /></el-icon>
                  上一个
                </el-button>
                <span class="nav-info">
                  {{ currentIndicatorIndex + 1 }} / {{ indicators.length }}
                </span>
                <el-button
                  :disabled="currentIndicatorIndex === indicators.length - 1"
                  size="small"
                  @click="goToNextIndicator"
                >
                  下一个
                  <el-icon><ArrowDown style="transform: rotate(-90deg)" /></el-icon>
                </el-button>
              </div>
              <div class="nav-right">
                <el-select
                  v-model="currentIndicatorIndex"
                  placeholder="快速跳转"
                  size="small"
                  style="width: 200px"
                >
                  <el-option
                    v-for="(indicator, index) in indicators"
                    :key="indicator.id"
                    :label="`${index + 1}. ${indicator.name || '未命名指标'}`"
                    :value="index"
                  />
                </el-select>
              </div>
            </div>

            <!-- 指标卡片 -->
            <div v-if="currentIndicator" class="indicator-card">
              <!-- 卡片头部 -->
              <div class="card-header">
                <div class="card-title-section">
                  <h3 class="card-title">{{ currentIndicator.name || '未命名指标' }}</h3>
                  <div class="card-tags">
                    <el-tag
                      size="small"
                      :class="
                        currentIndicator.type1 === '定性' ? 'tag-qualitative' : 'tag-quantitative'
                      "
                    >
                      {{ currentIndicator.type1 }}
                    </el-tag>
                    <el-tag
                      size="small"
                      :style="{
                        backgroundColor: getCategoryColor(currentIndicator.type2),
                        color: '#fff',
                        border: 'none'
                      }"
                    >
                      {{ getCategoryText(currentIndicator.type2) }}任务
                    </el-tag>
                    <el-tag v-if="currentPlanStatus === 'PENDING'" type="warning" size="small">
                      计划审批中
                    </el-tag>
                  </div>
                </div>
                <div class="card-actions">
                  <el-button
                    type="primary"
                    size="small"
                    @click="handleViewDetail(currentIndicator)"
                  >
                    <el-icon><View /></el-icon>
                    详情
                  </el-button>
                  <el-button
                    v-if="canDeleteIndicator(currentIndicator)"
                    type="danger"
                    size="small"
                    @click="handleDeleteIndicator(currentIndicator)"
                  >
                    <el-icon><Delete /></el-icon>
                    删除
                  </el-button>
                </div>
              </div>

              <!-- 卡片内容 -->
              <div class="card-content">
                <!-- 基础信息 -->
                <div class="info-section">
                  <h4 class="section-title">基础信息</h4>
                  <div class="info-grid">
                    <div class="info-item">
                      <span class="info-label">战略任务：</span>
                      <span class="info-value">{{
                        currentIndicator.taskContent || '未关联任务'
                      }}</span>
                    </div>
                    <div class="info-item">
                      <span class="info-label">权重：</span>
                      <span class="info-value">{{ currentIndicator.weight }}</span>
                    </div>
                    <div class="info-item">
                      <span class="info-label">责任部门：</span>
                      <span class="info-value">{{ currentIndicator.responsibleDept }}</span>
                    </div>
                    <div class="info-item">
                      <span class="info-label">责任人：</span>
                      <span class="info-value">{{ currentIndicator.responsiblePerson }}</span>
                    </div>
                    <div class="info-item full-width">
                      <span class="info-label">备注：</span>
                      <span class="info-value">{{ currentIndicator.remark || '无备注' }}</span>
                    </div>
                  </div>
                </div>

                <!-- 进度信息 -->
                <div class="progress-section">
                  <h4 class="section-title">进度信息</h4>
                  <div class="progress-display">
                    <div class="progress-main">
                      <div class="progress-text">
                        <span class="current-progress">{{ currentIndicator.progress || 0 }}%</span>
                        <span class="progress-label">当前进度</span>
                      </div>
                      <el-progress
                        :percentage="currentIndicator.progress || 0"
                        :stroke-width="12"
                        :color="getProgressColor(currentIndicator)"
                        class="progress-bar"
                      />
                    </div>
                    <!-- 待审批进度显示 -->
                    <div
                      v-if="hasPendingProgressContent(currentIndicator)"
                      class="pending-progress"
                    >
                      <div v-if="hasPendingProgressValue(currentIndicator)" class="pending-info">
                        <span class="pending-label">申请进度：</span>
                        <span class="pending-value">{{ currentIndicator.pendingProgress }}%</span>
                        <span class="progress-change">
                          ({{ getPendingProgressDelta(currentIndicator) > 0 ? '+' : ''
                          }}{{ getPendingProgressDelta(currentIndicator) }}%)
                        </span>
                      </div>
                      <div v-if="currentIndicator.pendingRemark" class="pending-remark">
                        <span class="remark-label">填报备注：</span>
                        <span class="remark-text">{{ currentIndicator.pendingRemark }}</span>
                      </div>
                    </div>

                    <div
                      v-if="currentIndicatorWorkflowLoading"
                      class="workflow-progress-card is-loading"
                    >
                      <span class="workflow-progress-hint">正在加载该指标的审批流信息...</span>
                    </div>

                    <div v-else-if="currentIndicatorWorkflow" class="workflow-progress-card">
                      <div class="workflow-progress-header">
                        <span class="workflow-progress-title">报告审批流</span>
                        <el-tag
                          size="small"
                          :type="getIndicatorWorkflowTagType(currentIndicatorWorkflow)"
                        >
                          {{ getIndicatorWorkflowStatusLabel(currentIndicatorWorkflow) }}
                        </el-tag>
                      </div>
                      <div class="workflow-progress-grid">
                        <div class="workflow-progress-item">
                          <span class="workflow-progress-label">当前节点</span>
                          <span class="workflow-progress-value">{{
                            currentIndicatorWorkflow.currentStepName || '审批'
                          }}</span>
                        </div>
                        <div class="workflow-progress-item">
                          <span class="workflow-progress-label">当前审批人</span>
                          <span class="workflow-progress-value">{{
                            currentIndicatorWorkflow.currentApproverName || '待分配'
                          }}</span>
                        </div>
                      </div>
                      <div
                        v-if="canCurrentUserHandleCurrentIndicatorWorkflow"
                        class="workflow-progress-actions"
                      >
                        <el-button
                          size="small"
                          type="success"
                          @click="handleApproveCurrentIndicatorWorkflow"
                        >
                          审批通过
                        </el-button>
                        <el-button
                          size="small"
                          type="danger"
                          plain
                          @click="handleRejectCurrentIndicatorWorkflow"
                        >
                          审批驳回
                        </el-button>
                      </div>
                      <div
                        v-else-if="currentIndicatorWorkflow.currentApproverName"
                        class="workflow-progress-hint"
                      >
                        当前节点审批人为
                        {{ currentIndicatorWorkflow.currentApproverName }}，你当前仅可查看。
                      </div>
                    </div>
                  </div>
                </div>

                <!-- 里程碑信息 -->
                <div
                  v-if="currentIndicator.milestones && currentIndicator.milestones.length > 0"
                  class="milestone-section"
                >
                  <h4 class="section-title">里程碑节点</h4>
                  <div class="milestone-list">
                    <div
                      v-for="(milestone, index) in currentIndicator.milestones"
                      :key="milestone.id"
                      class="milestone-item-card"
                    >
                      <div class="milestone-header">
                        <span class="milestone-index">{{ index + 1 }}.</span>
                        <span class="milestone-name">{{ milestone.name }}</span>
                        <el-tag
                          size="small"
                          :type="
                            resolveMilestoneDisplayState(milestone, currentIndicator.progress)
                              .tagType
                          "
                        >
                          {{
                            resolveMilestoneDisplayState(milestone, currentIndicator.progress).label
                          }}
                        </el-tag>
                      </div>
                      <div class="milestone-details">
                        <span class="milestone-progress"
                          >目标进度: {{ milestone.targetProgress }}%</span
                        >
                        <span class="milestone-deadline">截止日期: {{ milestone.deadline }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 空状态 -->
            <div v-else class="empty-state">
              <el-empty description="当前部门暂无指标数据" :image-size="120">
                <el-button v-if="!isReadOnly" type="primary" @click="addNewRow">
                  <el-icon><Plus /></el-icon>
                  新增指标
                </el-button>
              </el-empty>
            </div>
          </div>
        </template>

        <!-- 新增行表单 -->
        <div v-if="isAddingOrEditing" ref="addRowFormRef" class="add-row-form">
          <h3 class="form-title">新增任务指标</h3>
          <div class="add-form-content">
            <el-form label-width="80px">
              <el-row :gutter="16">
                <el-col :span="4">
                  <el-form-item class="required-form-item">
                    <template #label><span class="required-asterisk">*</span>任务类型</template>
                    <el-select
                      v-model="newRow.type2"
                      style="width: 100%"
                      :disabled="!!taskTypeMap[newRow.taskContent]"
                    >
                      <el-option label="发展性" value="发展性" />
                      <el-option label="基础性" value="基础性" />
                    </el-select>
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item class="required-form-item">
                    <template #label><span class="required-asterisk">*</span>战略任务</template>
                    <el-select
                      ref="taskSelectRef"
                      v-model="newRow.taskContent"
                      filterable
                      allow-create
                      default-first-option
                      placeholder="选择或输入战略任务名称"
                      style="width: 100%"
                      :teleported="false"
                      @change="handleTaskSelect"
                      @visible-change="handleTaskVisibleChange"
                    >
                      <el-option
                        v-for="task in existingTaskNames"
                        :key="task"
                        :label="task"
                        :value="task"
                      />
                    </el-select>
                  </el-form-item>
                </el-col>
              </el-row>
              <el-row :gutter="16">
                <el-col :span="4">
                  <el-form-item class="required-form-item">
                    <template #label><span class="required-asterisk">*</span>指标类型</template>
                    <el-select
                      v-model="newRow.type1"
                      style="width: 100%"
                      @change="
                        (val: string) => {
                          if (val === '定量') generateMonthlyMilestones()
                        }
                      "
                    >
                      <el-option label="定性" value="定性" />
                      <el-option label="定量" value="定量" />
                    </el-select>
                  </el-form-item>
                </el-col>
                <el-col :span="4">
                  <el-form-item class="required-form-item">
                    <template #label><span class="required-asterisk">*</span>权重</template>
                    <el-input-number
                      v-model="newRow.weight"
                      :min="0"
                      placeholder="权重"
                      :controls="false"
                      style="width: 100%"
                    />
                  </el-form-item>
                </el-col>
              </el-row>
              <el-row :gutter="16">
                <el-col :span="24">
                  <el-form-item class="required-form-item">
                    <template #label><span class="required-asterisk">*</span>核心指标</template>
                    <el-input
                      v-model="newRow.name"
                      type="textarea"
                      :autosize="{ minRows: 2, maxRows: 10 }"
                      placeholder="设置核心指标内容"
                    />
                  </el-form-item>
                </el-col>
              </el-row>
              <el-row :gutter="16">
                <el-col :span="24">
                  <el-form-item label="备注">
                    <el-input
                      v-model="newRow.remark"
                      type="textarea"
                      :autosize="{ minRows: 3, maxRows: 15 }"
                      placeholder="输入指标备注"
                    />
                  </el-form-item>
                </el-col>
              </el-row>
              <el-row :gutter="16">
                <el-col :span="24">
                  <el-form-item class="required-form-item">
                    <template #label><span class="required-asterisk">*</span>里程碑</template>
                    <div class="milestone-form-area">
                      <el-button
                        v-if="newRow.type1 === '定性'"
                        size="small"
                        type="primary"
                        plain
                        @click="addMilestone"
                      >
                        <el-icon><Plus /></el-icon> 添加里程碑
                      </el-button>
                      <div v-if="newRow.milestones.length > 0" class="milestone-list">
                        <div
                          v-for="(ms, idx) in newRow.milestones"
                          :key="ms.id"
                          class="milestone-form-item"
                        >
                          <span class="milestone-index">{{ idx + 1 }}.</span>
                          <el-input
                            v-model="ms.name"
                            placeholder="里程碑名称"
                            style="width: 160px"
                            size="small"
                          />
                          <el-input-number
                            :model-value="ms.targetProgress"
                            :min="0"
                            :max="100"
                            placeholder="目标进度%"
                            size="small"
                            style="width: 110px"
                            @update:model-value="
                              value => handleNewRowMilestoneProgressChange(ms, value)
                            "
                          />
                          <el-date-picker
                            v-model="ms.deadline"
                            type="date"
                            placeholder="截止日期"
                            size="small"
                            style="width: 130px"
                            value-format="YYYY-MM-DD"
                          />
                          <el-button type="danger" size="small" text @click="removeMilestone(idx)">
                            <el-icon><Delete /></el-icon>
                          </el-button>
                        </div>
                      </div>
                      <span v-else class="milestone-hint">{{
                        newRow.type1 === '定量'
                          ? '选择定量后自动生成12月里程碑'
                          : '暂无里程碑，点击添加'
                      }}</span>
                    </div>
                  </el-form-item>
                </el-col>
              </el-row>
            </el-form>
          </div>
          <div class="add-form-actions">
            <el-button type="primary" @click="saveNewRow">保存</el-button>
            <el-button @click="cancelAdd">取消</el-button>
          </div>
        </div>
      </div>

      <!-- Excel状态栏 -->
      <div class="excel-status-bar">
        <div class="status-left">
          {{ isInitialDataLoading ? '正在加载数据...' : `共 ${indicators.length} 条记录` }}
        </div>
        <div class="status-right">
          {{ isInitialDataLoading ? '最后编辑: --' : `最后编辑: ${lastEditTime}` }}
        </div>
      </div>
    </section>

    <!-- 任务下发对话框 -->
    <el-dialog
      v-model="showAssignmentDialog"
      title="任务下发"
      width="600px"
      :before-close="
        () => {
          showAssignmentDialog = false
          assignmentTarget = ''
          assignmentMethod = 'self'
        }
      "
    >
      <div class="assignment-dialog">
        <div class="selected-indicators">
          <h4>选中的指标 ({{ selectedIndicators.length }}项)</h4>
          <ul>
            <li v-for="indicator in selectedIndicators" :key="indicator.id">
              {{ indicator.name }}
            </li>
          </ul>
        </div>

        <el-form :model="{ assignmentMethod, assignmentTarget }" label-width="120px">
          <el-form-item :label="props.selectedRole === '战略发展部' ? '下发方式' : '下发方式'">
            <el-radio-group v-model="assignmentMethod">
              <el-radio v-if="props.selectedRole === '战略发展部'" value="self"
                >职能部门完成</el-radio
              >
              <el-radio v-if="props.selectedRole === '战略发展部'" value="college">
                分解到职能部门
              </el-radio>
              <el-radio
                v-else-if="props.selectedRole === '教务处' || props.selectedRole === '科研处'"
                value="self"
              >
                自己完成
              </el-radio>
              <el-radio
                v-if="props.selectedRole === '教务处' || props.selectedRole === '科研处'"
                value="college"
              >
                下发给学院
              </el-radio>
            </el-radio-group>
          </el-form-item>

          <el-form-item v-if="assignmentMethod === 'college'" label="目标部门">
            <el-select v-model="assignmentTarget" placeholder="选择学院" style="width: 100%">
              <el-option label="计算机学院" value="计算机学院" />
              <el-option label="艺术与科技学院" value="艺术与科技学院" />
            </el-select>
          </el-form-item>
        </el-form>
      </div>

      <template #footer>
        <el-button @click="handleCancelAssignment"> 取消 </el-button>
        <el-button
          type="primary"
          :disabled="assignmentMethod === 'college' && !assignmentTarget"
          @click="confirmAssignment"
        >
          确认下发
        </el-button>
      </template>
    </el-dialog>

    <!-- 指标详情抽屉 -->
    <el-drawer v-model="detailDrawerVisible" title="指标详情" size="45%">
      <div v-if="currentDetail" class="detail-container">
        <!-- 基础信息 -->
        <div class="detail-header">
          <h3>{{ currentDetail.name }}</h3>
          <div class="detail-tags">
            <el-tag
              size="small"
              :class="currentDetail.type1 === '定性' ? 'tag-qualitative' : 'tag-quantitative'"
              >{{ currentDetail.type1 }}</el-tag
            >
            <el-tag
              size="small"
              :style="{
                backgroundColor: getCategoryColor(currentDetail.type2),
                color: '#fff',
                border: 'none'
              }"
            >
              {{ getCategoryText(currentDetail.type2) }}任务
            </el-tag>
          </div>
        </div>

        <el-descriptions :column="2" border class="detail-desc">
          <el-descriptions-item label="战略任务" :span="2">{{
            currentDetail.taskContent
          }}</el-descriptions-item>
          <el-descriptions-item label="任务类别"
            >{{ getCategoryText(currentDetail.type2) }}任务</el-descriptions-item
          >
          <el-descriptions-item label="指标类型">{{ currentDetail.type1 }}</el-descriptions-item>
          <el-descriptions-item label="权重">{{ currentDetail.weight }}</el-descriptions-item>
          <el-descriptions-item label="当前进度"
            >{{ currentDetail.progress }}%</el-descriptions-item
          >
          <el-descriptions-item label="填报进度">
            <template v-if="shouldShowReportedProgress(currentDetail)">
              <el-tooltip content="已提交但尚未审批通过的填报进度" placement="top">
                <span style="color: #e6a23c; font-weight: 600"
                  >{{ getDisplayedReportedProgress(currentDetail) }}%</span
                >
              </el-tooltip>
            </template>
            <span v-else style="color: #909399">暂无填报</span>
          </el-descriptions-item>
          <el-descriptions-item label="预警等级判定">
            <el-tag :type="getManualAlertTagType(currentDetail.manualAlertSeverity)" size="small">
              {{ getManualAlertLabel(currentDetail.manualAlertSeverity) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="责任部门">{{
            currentDetail.responsibleDept
          }}</el-descriptions-item>
          <el-descriptions-item label="责任人">{{
            currentDetail.responsiblePerson
          }}</el-descriptions-item>
          <el-descriptions-item label="创建时间" :span="2">{{
            formatDetailDate(currentDetail.createTime)
          }}</el-descriptions-item>
          <el-descriptions-item label="备注" :span="2">{{
            currentDetail.remark
          }}</el-descriptions-item>
        </el-descriptions>

        <!-- 里程碑信息 -->
        <div
          v-if="currentDetail.milestones && currentDetail.milestones.length > 0"
          class="milestone-section"
        >
          <div class="divider"></div>
          <h4>里程碑节点</h4>
          <IndicatorMilestoneTimeline
            :milestones="currentDetail.milestones"
            :current-progress="currentDetail.progress"
          />
        </div>
      </div>
    </el-drawer>

    <!-- 下发弹窗（支持单个和整体下发） -->
    <el-dialog
      v-model="distributeDialogVisible"
      :title="currentDistributeGroup ? '整体下发' : '指标下发'"
      width="500px"
      :close-on-click-modal="false"
    >
      <div class="distribute-dialog">
        <!-- 单个指标下发 -->
        <div v-if="currentDistributeItem" class="indicator-info">
          <p><strong>指标名称：</strong>{{ currentDistributeItem.name }}</p>
          <p><strong>任务类别：</strong>{{ getCategoryText(currentDistributeItem.type2) }}任务</p>
          <p><strong>权重：</strong>{{ currentDistributeItem.weight }}</p>
        </div>
        <!-- 整体下发 -->
        <div v-else-if="currentDistributeGroup" class="indicator-info">
          <p><strong>任务名称：</strong>{{ currentDistributeGroup.taskContent }}</p>
          <p>
            <strong>待下发指标数：</strong
            >{{ currentDistributeGroup.rows.filter(r => r.canWithdraw).length }} 个
          </p>
          <div class="indicator-list">
            <p><strong>包含指标：</strong></p>
            <ul>
              <li
                v-for="row in currentDistributeGroup.rows.filter(r => r.canWithdraw)"
                :key="row.id"
              >
                {{ row.name }}
              </li>
            </ul>
          </div>
        </div>
        <el-form label-width="100px" style="margin-top: 20px">
          <el-form-item label="下发目标">
            <el-select
              v-model="distributeTarget"
              multiple
              placeholder="选择下发目标部门（可多选）"
              style="width: 100%"
            >
              <el-option
                v-for="dept in functionalDepartments"
                :key="dept"
                :label="dept"
                :value="dept"
              />
            </el-select>
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="closeDistributeDialog">取消</el-button>
        <el-button type="primary" @click="confirmDistribute">确认下发</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="strategicBatchExportDialogVisible"
      title="选择导出部门"
      width="520px"
      :close-on-click-modal="!strategicExporting"
    >
      <div class="export-dialog-body">
        <el-checkbox
          v-model="allStrategicExportDepartmentsSelected"
          :indeterminate="strategicExportDepartmentsIndeterminate"
        >
          全选部门
        </el-checkbox>
        <el-checkbox-group
          v-model="selectedStrategicExportDepartments"
          class="export-selection-list"
        >
          <el-checkbox v-for="dept in functionalDepartments" :key="dept" :value="dept">
            {{ dept }}
          </el-checkbox>
        </el-checkbox-group>
      </div>
      <template #footer>
        <el-button
          :disabled="strategicExporting"
          @click="strategicBatchExportDialogVisible = false"
        >
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="strategicExporting"
          @click="handleExportSelectedStrategicDepartments"
        >
          导出
        </el-button>
      </template>
    </el-dialog>

    <BusinessImportDialog
      v-model:visible="strategicImportDialogVisible"
      type="strategic-task"
      :target-org-id="currentStrategicImportOrgId"
      :target-org-name="selectedDepartment"
      :cycle-id="currentStrategicImportCycleId"
      @committed="handleStrategicImportCommitted"
    />

    <el-dialog
      v-model="approvalSetupDialogVisible"
      title="确认审批流程"
      width="640px"
      :close-on-click-modal="false"
      @close="handleCloseApprovalSetupDialog"
    >
      <div v-loading="approvalPreviewLoading" class="approval-setup-dialog">
        <div v-if="currentPlan" class="approval-setup-summary">
          <div class="summary-row">
            <span class="summary-label">当前计划：</span>
            <span class="summary-value">{{
              currentPlan.name || currentPlan.taskName || selectedDepartment || '当前计划'
            }}</span>
          </div>
          <div class="summary-row">
            <span class="summary-label">审批流程：</span>
            <span class="summary-value">
              {{ approvalWorkflowPreview?.workflowName || PLAN_APPROVAL_SUBMIT_WORKFLOW_CODE }}
            </span>
          </div>
        </div>

        <div v-if="hasApprovalPreview" class="approval-step-list">
          <div
            v-for="step in approvalWorkflowPreview?.steps || []"
            :key="step.stepDefId"
            class="approval-step-card"
          >
            <div class="approval-step-header">
              <div class="approval-step-order">步骤 {{ step.stepOrder }}</div>
              <div class="approval-step-name">{{ step.stepName }}</div>
            </div>
            <div class="approval-step-users">
              <span class="approval-step-users-label">可审批用户：</span>
              <div
                v-if="hasApprovalStepCandidates(step.candidateApprovers)"
                class="approval-step-user-list"
              >
                <div
                  v-for="candidate in step.candidateApprovers"
                  :key="candidate.userId"
                  class="approval-step-user-item"
                >
                  <AppAvatar
                    :size="32"
                    :name="normalizePreviewCandidateDisplayName(candidate)"
                    class="approval-step-user-avatar"
                  />
                  <span class="approval-step-user-name">
                    {{ normalizePreviewCandidateDisplayName(candidate) }}
                  </span>
                </div>
              </div>
              <span v-else class="approval-step-users-value">系统自动分配</span>
            </div>
          </div>
        </div>

        <el-form label-position="top" class="approval-setup-form">
          <el-form-item label="提交说明">
            <el-input
              v-model="approvalSubmitComment"
              type="textarea"
              :rows="4"
              maxlength="500"
              show-word-limit
              placeholder="请输入提交说明；如果留空，后端会自动生成默认提交文案并落库。"
            />
          </el-form-item>
        </el-form>

        <el-empty
          v-if="!approvalPreviewLoading && !hasApprovalPreview"
          description="暂未加载到审批流程定义"
          :image-size="88"
        />
      </div>

      <template #footer>
        <el-button @click="handleCloseApprovalSetupDialog">取消</el-button>
        <el-button
          type="primary"
          :loading="approvalSubmitting"
          :disabled="approvalPreviewLoading || !hasApprovalPreview || departmentTotalWeight !== 100"
          @click="confirmPlanApprovalSubmission"
        >
          确认发起审批
        </el-button>
      </template>
    </el-dialog>

    <!-- 任务审批抽屉 -->
    <DistributionApprovalProgressDrawer
      v-model="taskApprovalVisible"
      :indicators="approvalIndicators"
      :plan="currentPlan"
      :initial-plan-workflow-detail="preloadedPlanWorkflowDetail"
      :department-name="selectedDepartment"
      :plan-name="currentPlan?.taskName || currentPlan?.name || selectedDepartment"
      :show-plan-approvals="true"
      :show-approval-section="true"
      :workflow-code="PLAN_APPROVAL_HISTORY_WORKFLOW_CODES"
      :workflow-entity-type="primaryApprovalWorkflowEntityType"
      :workflow-entity-id="primaryApprovalWorkflowEntityId"
      :secondary-workflow-entity-type="secondaryApprovalWorkflowEntityType"
      :secondary-workflow-entity-id="secondaryApprovalWorkflowEntityId"
      approval-type="submission"
      @close="taskApprovalVisible = false"
      @refresh="handleApprovalRefresh"
    />

    <!-- 里程碑编辑弹窗 -->
    <el-dialog
      v-model="milestoneEditDialogVisible"
      title="编辑里程碑"
      width="700px"
      :close-on-click-modal="false"
      :close-on-press-escape="!isSavingMilestoneEdit"
      :show-close="!isSavingMilestoneEdit"
      @close="cancelMilestoneEdit"
    >
      <div v-if="editingMilestoneIndicator" class="milestone-edit-dialog">
        <!-- 指标信息 -->
        <div class="indicator-info-header">
          <div class="info-item">
            <span class="label">指标名称：</span>
            <span class="value">{{ editingMilestoneIndicator.name }}</span>
          </div>
          <div class="info-item">
            <span class="label">指标类型：</span>
            <el-tag
              size="small"
              :type="editingMilestoneIndicator.type1 === '定量' ? 'primary' : 'warning'"
            >
              {{ editingMilestoneIndicator.type1 }}
            </el-tag>
          </div>
        </div>

        <el-divider />

        <!-- 操作按钮 -->
        <div class="milestone-actions">
          <el-button size="small" type="primary" :icon="Plus" @click="addMilestoneInDialog">
            添加里程碑
          </el-button>
          <el-button
            v-if="editingMilestoneIndicator.type1 === '定量'"
            size="small"
            type="success"
            :icon="Timer"
            @click="generateMonthlyMilestonesInDialog"
          >
            生成12个月里程碑
          </el-button>
          <span class="milestone-count-hint"> 当前共 {{ editingMilestones.length }} 个里程碑 </span>
        </div>

        <!-- 里程碑列表 -->
        <div class="milestone-edit-list">
          <el-empty
            v-if="editingMilestones.length === 0"
            description="暂无里程碑，点击上方按钮添加"
            :image-size="80"
          />

          <!-- 里程碑编辑表单 -->
          <div v-for="(ms, idx) in editingMilestones" :key="ms.id" class="milestone-edit-item">
            <div class="milestone-index">{{ idx + 1 }}.</div>
            <div class="milestone-fields">
              <el-input
                v-model="ms.name"
                placeholder="里程碑名称"
                size="small"
                class="field-name"
              />
              <el-input-number
                :model-value="ms.targetProgress"
                :min="0"
                :max="100"
                placeholder="目标进度%"
                size="small"
                class="field-progress"
                @update:model-value="value => handleEditingMilestoneProgressChange(ms, value)"
              />
              <el-date-picker
                v-model="ms.deadline"
                type="date"
                placeholder="截止日期"
                size="small"
                value-format="YYYY-MM-DD"
                class="field-date"
                @change="handleMilestoneDeadlineChange"
              />
              <el-button
                type="danger"
                size="small"
                :icon="Delete"
                circle
                @click="removeMilestoneInDialog(idx)"
              />
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <el-button :disabled="isSavingMilestoneEdit" @click="cancelMilestoneEdit">取消</el-button>
        <el-button type="primary" :loading="isSavingMilestoneEdit" @click="saveMilestoneEdit">
          保存
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped src="./StrategicTaskView.css"></style>

<style scoped>
/* 计划未正式下发时锁定预警等级判定 */
.manual-alert-select-wrapper--locked {
  cursor: not-allowed;
}
</style>
