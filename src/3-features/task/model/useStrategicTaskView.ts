import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Plus,
  View,
  Download,
  Delete,
  ArrowDown,
  Promotion,
  RefreshLeft,
  Check,
  Close,
  Upload,
  Edit,
  Refresh,
  Loading,
  Timer
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox, ElLoading } from 'element-plus'
import type { ElTable } from 'element-plus'
// eslint-disable-next-line no-restricted-syntax -- Backend-aligned types
import type { StrategicTask as _StrategicTask, StrategicIndicator } from '@/shared/types'
import { IndicatorStatus } from '@/shared/types/entities'
import { useStrategicStore } from '@/features/task/model/strategic'
import { useAuthStore } from '@/features/auth/model/store'
import { useTimeContextStore } from '@/shared/lib/timeContext'
import { useOrgStore } from '@/features/organization/model/store'
import { usePermission } from '@/5-shared/lib/permissions'
import AppAvatar from '@/shared/ui/avatar/AppAvatar.vue'
import { logger } from '@/shared/lib/utils/logger'
import { resolveIndicatorYear } from '@/shared/lib/utils/indicatorYear'
import { sortMilestonesByProgress } from '@/shared/lib/utils/milestoneSort'
import { buildQueryKey, fetchWithCache, invalidateQueries } from '@/shared/lib/utils/cache'
import { resolveMilestoneDisplayState } from '@/shared/lib/utils/milestoneDisplay'
import strategicApi, { approvalApi as taskApprovalApi } from '@/features/task/api/strategicApi'
import {
  getWorkflowDefinitionPreviewByCode,
  startWorkflow,
  getWorkflowInstanceDetail,
  getWorkflowInstanceDetailByBusiness,
  approveTask,
  rejectTask
} from '@/features/workflow/api'
import { milestoneApi } from '@/entities/milestone/api/milestoneApi'
import {
  getStatusText as _getStatusText,
  getStatusType as _getStatusType,
  getStatusIcon as _getStatusIcon
} from '@/shared/lib/utils/indicatorStatus'
import { getPlanStatusDisplay, normalizePlanStatus } from '@/features/task/lib'
import { ApprovalProgressDrawer } from '@/features/approval'
import {
  canCurrentUserHandleWorkflowApproval,
  notifyApprovalStateRefresh
} from '@/features/approval/lib'
import { useApprovalRouteAutopen } from '@/features/approval/lib'
import { useApprovalStore } from '@/features/approval/model/store'
import _MilestoneList from '@/features/milestone/ui/MilestoneList.vue'
import { indicatorApi } from '@/features/indicator/api'
import { usePlanStore } from '@/features/plan/model/store'
import { indicatorFillApi } from '@/features/plan/api/planApi'
import { getUsersByOrgId } from '@/features/user/api/query'
import { sleep } from '@/5-shared/api/retry'
import {
  GLOBAL_DATA_REFRESH_REQUEST_EVENT,
  type GlobalDataRefreshDetail
} from '@/5-shared/lib/dataFreshness'
import {
  canCurrentUserHandleIndicatorWorkflow,
  getIndicatorWorkflowStatusLabel,
  getIndicatorWorkflowTagType,
  resolveLatestIndicatorWorkflowSnapshot,
  type IndicatorWorkflowSnapshot
} from '@/features/plan/lib/indicatorWorkflow'
import type {
  WorkflowDefinitionPreviewResponse,
  WorkflowHistoryItem,
  WorkflowInstanceDetailResponse,
  WorkflowTaskResponse
} from '@/features/workflow/api/types'

export interface StrategicTaskViewProps {
  selectedRole: string
}

export function useStrategicTaskView(props: StrategicTaskViewProps) {
  // 使用共享 Store
  const strategicStore = useStrategicStore()
  const authStore = useAuthStore()
  const timeContext = useTimeContextStore()
  const orgStore = useOrgStore()
  const planStore = usePlanStore()
  const approvalStore = useApprovalStore()
  const route = useRoute()
  const router = useRouter()
  const currentUserId = computed(() => Number(authStore.user?.userId ?? 0))
  const currentUserPermissionCodes = computed(() => {
    const permissions = (authStore.user as { permissions?: unknown[] } | null)?.permissions
    if (!Array.isArray(permissions)) {
      return []
    }
    return permissions
      .map(permission => (typeof permission === 'string' ? permission.trim() : ''))
      .filter(Boolean)
  })
  const currentUserRoleCodes = computed(() => {
    const roles = (authStore.user as { roles?: unknown[] } | null)?.roles
    if (!Array.isArray(roles)) {
      return []
    }
    return roles.map(role => (typeof role === 'string' ? role.trim() : '')).filter(Boolean)
  })

  const isCurrentUserReporter = computed(() => {
    const roles = Array.isArray(authStore.user?.roles)
      ? authStore.user.roles
          .map(role => (typeof role === 'string' ? role.trim().toUpperCase() : ''))
          .filter(Boolean)
      : []

    return roles.includes('ROLE_REPORTER')
  })

  // 使用统一的权限管理工具
  const permissionUtil = usePermission()

  const currentUserOrgId = computed(() => {
    const rawOrgId = Number((authStore.user as { orgId?: string | number } | null)?.orgId ?? NaN)
    return Number.isFinite(rawOrgId) && rawOrgId > 0 ? rawOrgId : null
  })

  // 只读模式（历史年份为只读）
  const isReadOnly = computed(() => timeContext.isReadOnly)

  // 判断是否可以编辑（只有战略发展部可以编辑，且非只读模式）
  const canEdit = computed(() => {
    if (isReadOnly.value) {
      return false
    }
    return authStore.userRole === 'strategic_dept' || props.selectedRole === 'strategic_dept'
  })

  // 首屏加载态：接口未返回前展示骨架，避免先渲染"暂无数据"造成误判
  const taskTypeMapLoading = ref(false)
  const currentPlanScopeLoading = ref(false)
  const pageTransitionLoading = ref(false)
  const isDepartmentSwitching = ref(false)
  let departmentSwitchingTimer: ReturnType<typeof setTimeout> | null = null
  let globalDataRefreshPromise: Promise<void> | null = null
  let lastLightRefreshAt = 0
  let lightRefreshBackoffUntil = 0
  const LIGHT_REFRESH_MIN_INTERVAL_MS = 45 * 1000
  const LIGHT_REFRESH_BACKOFF_MS = 90 * 1000

  const isInitialDataLoading = computed(() => {
    return isBootstrappingPage.value || pageTransitionLoading.value
  })

  // 当前选中任务索引
  const currentTaskIndex = ref(0)
  const isAddingOrEditing = ref(false)
  const addRowFormRef = ref<HTMLElement | null>(null)

  // 视图模式：table（表格视图）或 card（卡片视图）
  const viewMode = ref<'table' | 'card'>('table')

  // 卡片视图当前指标索引
  const currentIndicatorIndex = ref(0)
  const isBootstrappingPage = ref(true)

  // 职能部门列表（从 orgStore 动态获取）
  const functionalDepartments = computed(() => orgStore.getAllFunctionalDepartmentNames())
  const selectedDepartmentStorageKey = computed(() => {
    const userId = String(authStore.user?.userId ?? authStore.user?.id ?? '').trim()
    const role = String(props.selectedRole || authStore.userRole || '').trim()
    const orgId = String(authStore.user?.orgId ?? '').trim()
    const scope = [userId, role, orgId].filter(Boolean).join(':') || 'anonymous'
    return `strategic-task-management:selected-department:${scope}`
  })

  // 选中的部门 - 默认选中第一个
  const selectedDepartment = ref('')

  const getRouteQueryText = (value: unknown): string => {
    const candidate = Array.isArray(value) ? value[0] : value
    return String(candidate ?? '').trim()
  }

  function normalizeDepartmentName(value?: string | null): string {
    if (!value) {
      return ''
    }

    const trimmed = String(value).trim()
    if (!trimmed) {
      return ''
    }

    return (
      departmentAliasNameMap.value.get(trimmed) || departmentIdNameMap.value.get(trimmed) || trimmed
    )
  }

  const readPersistedSelectedDepartment = (): string => {
    if (typeof window === 'undefined') {
      return ''
    }

    try {
      return normalizeDepartmentName(
        window.localStorage.getItem(selectedDepartmentStorageKey.value)
      )
    } catch (error) {
      logger.warn('[StrategicTaskView] 读取持久化部门选择失败:', error)
      return ''
    }
  }

  const persistSelectedDepartment = (dept: string): void => {
    if (typeof window === 'undefined') {
      return
    }

    try {
      if (dept) {
        window.localStorage.setItem(selectedDepartmentStorageKey.value, dept)
      } else {
        window.localStorage.removeItem(selectedDepartmentStorageKey.value)
      }
    } catch (error) {
      logger.warn('[StrategicTaskView] 持久化部门选择失败:', error)
    }
  }

  const departmentIdNameMap = computed(() => {
    const map = new Map<string, string>()
    orgStore.departments.forEach(dept => {
      map.set(String(dept.id), dept.name)
    })
    return map
  })

  const departmentAliasNameMap = computed(() => {
    const map = new Map<string, string>()
    orgStore.departments.forEach(dept => {
      const canonical = String(dept.name || '').trim()
      const id = String(dept.id || '').trim()
      if (!canonical) {
        return
      }

      map.set(canonical, canonical)
      if (id) {
        map.set(id, canonical)
      }

      canonical
        .split('|')
        .map(part => part.trim())
        .filter(Boolean)
        .forEach(part => {
          map.set(part, canonical)
        })
    })
    return map
  })

  const departmentNameIdMap = computed(() => {
    const map = new Map<string, number>()
    orgStore.departments.forEach(dept => {
      map.set(dept.name, Number(dept.id))
    })
    return map
  })

  const resolveDepartmentIdByName = (departmentName?: string | null): number | null => {
    const normalized = normalizeDepartmentName(departmentName)
    if (!normalized) {
      return null
    }
    return departmentNameIdMap.value.get(normalized) ?? null
  }

  const ensureInitialSelectedDepartment = (departments: string[]): void => {
    if (departments.length === 0 || selectedDepartment.value) {
      return
    }

    const persistedDepartment = readPersistedSelectedDepartment()
    const matchedPersistedDepartment = departments.find(
      dept => normalizeDepartmentName(dept) === persistedDepartment
    )

    if (matchedPersistedDepartment) {
      selectedDepartment.value = matchedPersistedDepartment
      persistSelectedDepartment(matchedPersistedDepartment)
      return
    }

    selectedDepartment.value = departments[0] ?? ''
    if (selectedDepartment.value) {
      persistSelectedDepartment(selectedDepartment.value)
    }
  }

  // 初始化选中部门 - 默认选中第一个职能部门
  watch(
    functionalDepartments,
    newDeps => {
      ensureInitialSelectedDepartment(newDeps)
    },
    { immediate: true }
  )

  const resolvePlanYear = (plan: Record<string, unknown>): number | null => {
    const explicitYear = plan?.cycle?.year ?? plan?.year
    if (explicitYear != null && explicitYear !== '') {
      return Number(explicitYear)
    }

    const cycleId = Number(plan?.cycleId)
    if (cycleId === 4 || cycleId === 90) {
      return 2026
    }
    if (cycleId === 7) {
      return 2025
    }

    return null
  }

  const findCurrentPlanByDepartment = () => {
    if (!selectedDepartment.value) {
      return null
    }

    const selectedDepartmentId = resolveDepartmentIdByName(selectedDepartment.value)
    const normalizedDepartmentName = normalizeDepartmentName(selectedDepartment.value)

    const sameDepartment = (planAny: Record<string, unknown>) => {
      const planTargetOrgId = Number(planAny.targetOrgId ?? planAny.org_id ?? planAny.orgId ?? NaN)
      const orgName = normalizeDepartmentName(
        String(planAny.targetOrgName || planAny.orgName || '')
      )
      return (
        (selectedDepartmentId != null &&
          Number.isFinite(planTargetOrgId) &&
          planTargetOrgId === selectedDepartmentId) ||
        orgName === normalizedDepartmentName
      )
    }

    const plans = planStore.plans.filter(p => {
      const planAny = p as Record<string, unknown>
      const planYear = resolvePlanYear(planAny)
      return sameDepartment(planAny) && planYear === timeContext.currentYear
    })

    const strictMatch =
      plans.find(p => {
        const planAny = p as Record<string, unknown>
        const candidateCreatedByOrgId = Number(
          planAny.createdByOrgId ?? planAny.created_by_org_id ?? NaN
        )
        const candidatePlanLevel = String(planAny.planLevel || planAny.plan_level || '')
          .trim()
          .toUpperCase()

        return candidateCreatedByOrgId === 35 && candidatePlanLevel === 'STRAT_TO_FUNC'
      }) || null

    return strictMatch || plans[0] || null
  }

  const findCurrentPlanByOrgId = (orgId?: number | null) => {
    if (!orgId || !Number.isFinite(orgId)) {
      return null
    }

    return (
      planStore.plans.find(p => {
        const planAny = p as Record<string, unknown>
        const planYear = resolvePlanYear(planAny)
        const planCreatedByOrgId = Number(
          planAny.createdByOrgId ?? planAny.created_by_org_id ?? NaN
        )

        return (
          planYear === timeContext.currentYear &&
          Number.isFinite(planCreatedByOrgId) &&
          planCreatedByOrgId === orgId
        )
      }) || null
    )
  }

  // 后端任务类型映射：taskId -> taskType（BASIC/DEVELOPMENT/...）
  const backendTaskTypeMap = ref<Record<string, string>>({})
  const currentPlanTaskTypeMap = ref<Record<string, string>>({})
  const currentPlanTaskIdSet = ref<Set<string>>(new Set())

  const currentPlanTaskIdSetSignature = computed(() =>
    Array.from(currentPlanTaskIdSet.value).sort().join(',')
  )

  const milestoneCache = ref<Record<string, Record<string, Array<Record<string, unknown>>>>>({}) // key: "部门名_指标ID"

  const normalizeTaskId = (value: unknown): string => {
    const normalized = String(value ?? '').trim()
    return normalized
  }

  const indicatorByIdMap = computed(() => {
    const map = new Map<string, StrategicIndicator>()
    strategicStore.indicators.forEach(item => {
      map.set(String(item.id), item)
    })
    return map
  })

  const getIndicatorTaskId = (indicator: StrategicIndicator): string => {
    const raw = indicator as StrategicIndicator & {
      taskId?: string | number
      task_id?: string | number
      planId?: string | number
      strategicTaskId?: string | number
      parentIndicatorId?: string | number
    }

    const directTaskId = normalizeTaskId(raw.taskId ?? raw.task_id ?? raw.strategicTaskId)
    if (directTaskId) {
      return directTaskId
    }

    const visited = new Set<string>()
    let currentParentId = normalizeTaskId(raw.parentIndicatorId)

    // 子指标 task_id 为空时，沿父指标链回溯 task_id
    while (currentParentId && !visited.has(currentParentId)) {
      visited.add(currentParentId)
      const parent = indicatorByIdMap.value.get(currentParentId)
      if (!parent) {
        break
      }
      const parentRaw = parent as StrategicIndicator & {
        taskId?: string | number
        task_id?: string | number
        planId?: string | number
        strategicTaskId?: string | number
        parentIndicatorId?: string | number
      }
      const parentTaskId = normalizeTaskId(
        parentRaw.taskId ?? parentRaw.task_id ?? parentRaw.strategicTaskId
      )
      if (parentTaskId) {
        return parentTaskId
      }
      currentParentId = normalizeTaskId(parentRaw.parentIndicatorId)
    }

    return ''
  }

  const isBasicTaskType = (taskType?: string): boolean => {
    const normalized = String(taskType || '')
      .trim()
      .toUpperCase()
    return normalized === 'BASIC'
  }

  const isDevelopmentTaskType = (taskType?: string): boolean => {
    const normalized = String(taskType || '')
      .trim()
      .toUpperCase()
    return normalized === 'DEVELOPMENT'
  }

  const getIndicatorMappedTaskType = (indicator: StrategicIndicator): string => {
    const indicatorTaskId = getIndicatorTaskId(indicator)
    if (!indicatorTaskId) {
      return ''
    }
    return (
      currentPlanTaskTypeMap.value[indicatorTaskId] ||
      backendTaskTypeMap.value[indicatorTaskId] ||
      ''
    )
  }

  const getTaskCategoryLabel = (taskType?: string): '基础性' | '发展性' => {
    if (isBasicTaskType(taskType)) {
      return '基础性'
    }
    return '发展性'
  }

  const getIndicatorCategoryLabel = (indicator: StrategicIndicator): '基础性' | '发展性' => {
    return getTaskCategoryLabel(getIndicatorMappedTaskType(indicator))
  }

  const isBasicIndicatorForCurrentRules = (indicator: StrategicIndicator): boolean => {
    const mappedTaskType = getIndicatorMappedTaskType(indicator)
    if (mappedTaskType) {
      return isBasicTaskType(mappedTaskType)
    }

    // 兜底：任务类型映射尚未返回时，回退到当前展示标签，避免页面临时显示 0 / 100。
    return String(indicator.type2 || '').trim() === '基础性'
  }

  const buildTaskTypeMap = (tasks: Array<Record<string, unknown>>): Record<string, string> => {
    const map: Record<string, string> = {}
    tasks.forEach(task => {
      const taskId = normalizeTaskId(
        (task as { taskId?: string | number; id?: string | number }).taskId
      )
      const fallbackTaskId = normalizeTaskId((task as { id?: string | number }).id)
      const taskType = String((task as { taskType?: string }).taskType || '').trim()
      const key = taskId || fallbackTaskId
      if (key && taskType) {
        map[key] = taskType
      }
    })
    return map
  }

  const buildTaskIdSet = (tasks: Array<Record<string, unknown>>): string[] => {
    return tasks
      .map(
        task =>
          normalizeTaskId((task as { taskId?: string | number; id?: string | number }).taskId) ||
          normalizeTaskId((task as { id?: string | number }).id)
      )
      .filter(Boolean)
  }

  const loadBackendTaskTypeMap = async (options: { force?: boolean } = {}) => {
    taskTypeMapLoading.value = true
    try {
      const byYearResponse = await strategicApi.getTasksByYear(timeContext.currentYear, {
        force: options.force
      })
      if (
        byYearResponse?.success &&
        Array.isArray(byYearResponse.data) &&
        byYearResponse.data.length > 0
      ) {
        backendTaskTypeMap.value = buildTaskTypeMap(
          byYearResponse.data as Array<Record<string, unknown>>
        )
        return
      }

      // 兼容回退：部分环境按年查询任务为空（周期口径不一致），改用全量任务建立映射
      const allTasksResponse = await strategicApi.getAllTasks({ force: options.force })
      if (allTasksResponse?.success && Array.isArray(allTasksResponse.data)) {
        backendTaskTypeMap.value = buildTaskTypeMap(
          allTasksResponse.data as Array<Record<string, unknown>>
        )
        return
      }

      backendTaskTypeMap.value = {}
    } catch (error) {
      backendTaskTypeMap.value = {}
      logger.error('[StrategicTaskView] 加载后端任务类型失败:', error)
    } finally {
      taskTypeMapLoading.value = false
    }
  }

  const loadCurrentPlanTaskScope = async (options: { force?: boolean } = {}) => {
    const dept = selectedDepartment.value
    if (!dept) {
      currentPlanScopeLoading.value = false
      return
    }

    currentPlanScopeLoading.value = true
    const currentPlan = findCurrentPlanByDepartment()
    const planId = currentPlan?.id

    if (!planId) {
      currentPlanTaskTypeMap.value = {}
      currentPlanTaskIdSet.value = new Set()
      currentPlanScopeLoading.value = false
      return
    }

    try {
      const scope = await fetchWithCache({
        key: buildQueryKey('task', 'scope', {
          department: dept,
          planId: String(planId),
          year: timeContext.currentYear
        }),
        policy: {
          ttlMs: 2 * 60 * 1000,
          scope: 'memory',
          dedupeWindowMs: 1000,
          tags: ['task.scope', `task.scope.${planId}`, 'plan.detail']
        },
        force: options.force === true,
        fetcher: async () => {
          const response = await strategicApi.getTasksByPlanId(planId)
          if (!response?.success || !Array.isArray(response.data)) {
            return {
              taskTypeMap: {} as Record<string, string>,
              taskIdSet: [] as string[]
            }
          }
          const planTaskMap = buildTaskTypeMap(response.data as Array<Record<string, unknown>>)
          const planTaskIds = buildTaskIdSet(response.data as Array<Record<string, unknown>>)
          return {
            taskTypeMap: planTaskMap,
            // 计划范围判断只依赖 task 主键，不应被 taskType 缺失误伤。
            taskIdSet: planTaskIds
          }
        }
      })

      currentPlanTaskTypeMap.value = scope.taskTypeMap
      currentPlanTaskIdSet.value = new Set(scope.taskIdSet)
    } catch (error) {
      currentPlanTaskTypeMap.value = {}
      currentPlanTaskIdSet.value = new Set()
      logger.error('[StrategicTaskView] 加载当前计划任务范围失败:', error)
    } finally {
      currentPlanScopeLoading.value = false
    }
  }

  const isIndicatorInCurrentPlanScope = (indicator: StrategicIndicator): boolean => {
    const indicatorTaskId = getIndicatorTaskId(indicator)
    if (!indicatorTaskId) {
      return false
    }
    if (currentPlanTaskIdSet.value.size === 0) {
      // 存在当前计划但任务列表为空时，按严格口径不计入当前计划范围。
      const hasCurrentPlan = Boolean(findCurrentPlanByDepartment()?.id)
      return !hasCurrentPlan
    }
    return currentPlanTaskIdSet.value.has(indicatorTaskId)
  }

  const matchFunctionalDepartmentName = (candidate?: string | null): string => {
    const normalized = normalizeDepartmentName(candidate)
    if (!normalized) {
      return ''
    }

    return (
      functionalDepartments.value.find(dept => normalizeDepartmentName(dept) === normalized) || ''
    )
  }

  const resolveRouteApprovalDepartment = async (): Promise<string> => {
    if (!orgStore.loaded || orgStore.departments.length === 0) {
      await orgStore.loadDepartments()
    }

    const queryDepartment = matchFunctionalDepartmentName(
      getRouteQueryText(route.query.approvalDepartment)
    )
    if (queryDepartment) {
      return queryDepartment
    }

    const approvalEntityType = getRouteQueryText(route.query.approvalEntityType).toUpperCase()
    const approvalEntityId = getRouteQueryText(route.query.approvalEntityId)
    if (approvalEntityType !== 'PLAN' || !approvalEntityId) {
      return ''
    }

    const cachedPlan =
      planStore.plans.find(
        plan => String((plan as Record<string, unknown>).id) === approvalEntityId
      ) || null
    const plan =
      cachedPlan ||
      (await planStore.loadPlanDetails(approvalEntityId, {
        force: true,
        background: true
      }))

    const planRecord = (plan || {}) as Record<string, unknown>
    const directDepartment = matchFunctionalDepartmentName(
      String(planRecord.targetOrgName || planRecord.orgName || '')
    )
    if (directDepartment) {
      return directDepartment
    }

    const planOrgId = Number(
      planRecord.targetOrgId ??
        planRecord.target_org_id ??
        planRecord.orgId ??
        planRecord.org_id ??
        NaN
    )
    if (!Number.isFinite(planOrgId) || planOrgId <= 0) {
      return ''
    }

    return matchFunctionalDepartmentName(departmentIdNameMap.value.get(String(planOrgId)) || '')
  }

  async function syncSelectedDepartmentFromRoute(): Promise<void> {
    const routeApprovalDepartment = await resolveRouteApprovalDepartment()
    if (!routeApprovalDepartment) {
      return
    }

    if (selectedDepartment.value !== routeApprovalDepartment) {
      selectedDepartment.value = routeApprovalDepartment
      persistSelectedDepartment(routeApprovalDepartment)
    }

    if (getRouteQueryText(route.query.approvalDepartment)) {
      const nextQuery = { ...route.query }
      delete nextQuery.approvalDepartment
      await router.replace({ query: nextQuery })
    }
  }

  watch(
    () => [
      route.query.approvalDepartment,
      route.query.approvalEntityType,
      route.query.approvalEntityId,
      functionalDepartments.value.length
    ],
    () => {
      if (
        getRouteQueryText(route.query.approvalDepartment) ||
        (getRouteQueryText(route.query.approvalEntityType).toUpperCase() === 'PLAN' &&
          getRouteQueryText(route.query.approvalEntityId))
      ) {
        void syncSelectedDepartmentFromRoute()
      }
    },
    { immediate: true }
  )

  const milestoneMap = ref<Record<string, Array<Record<string, unknown>>>>({})
  const loadedMilestoneIds = ref(new Set<string>())
  const loadingMilestoneIds = ref(new Set<string>())
  const milestoneLoadRequestId = ref(0)
  const milestoneFallbackConcurrency = 4

  const toMilestoneStatus = (status?: string): 'pending' | 'completed' | 'overdue' => {
    const normalized = String(status || '').toUpperCase()
    if (normalized === 'COMPLETED') {
      return 'completed'
    }
    if (normalized === 'DELAYED' || normalized === 'CANCELED' || normalized === 'OVERDUE') {
      return 'overdue'
    }
    return 'pending'
  }

  const normalizeMilestone = (raw: Record<string, unknown>, index: number) => ({
    id: String(raw.id ?? raw.milestoneId ?? `milestone-${index}`),
    name: String(raw.name ?? raw.milestoneName ?? `里程碑${index + 1}`),
    targetProgress: Number(raw.targetProgress ?? raw.weightPercent ?? 0),
    deadline: String(raw.deadline ?? raw.dueDate ?? ''),
    status: toMilestoneStatus(String(raw.status ?? '')),
    isPaired: Boolean(raw.isPaired ?? false),
    weightPercent: Number(raw.weightPercent ?? 0),
    sortOrder: Number(raw.sortOrder ?? index)
  })

  const toMilestoneRequestStatus = (status: unknown): string => {
    const normalized = String(status || '')
      .trim()
      .toUpperCase()
    if (
      normalized === 'COMPLETED' ||
      normalized === 'IN_PROGRESS' ||
      normalized === 'NOT_STARTED'
    ) {
      return normalized
    }
    if (normalized === 'OVERDUE' || normalized === 'DELAYED') {
      return 'DELAYED'
    }
    return 'NOT_STARTED'
  }

  const toMilestoneDueDate = (deadline: unknown): string | null => {
    const text = String(deadline || '').trim()
    if (!text) {
      return null
    }

    if (text.includes('T')) {
      return text
    }

    return `${text}T23:59:59`
  }

  const extractMilestones = (payload: unknown): Array<Record<string, unknown>> => {
    if (Array.isArray(payload)) {
      return payload as Array<Record<string, unknown>>
    }
    if (payload && typeof payload === 'object') {
      const record = payload as Record<string, unknown>
      if (Array.isArray(record.items)) {
        return record.items as Array<Record<string, unknown>>
      }
    }
    return []
  }

  const normalizedIndicators = computed(() =>
    strategicStore.indicators.map(i => {
      const indicatorId = String(i.id)
      const mappedMilestones = milestoneMap.value[indicatorId]
      return {
        ...i,
        ownerDept: normalizeDepartmentName(i.ownerDept),
        responsibleDept: normalizeDepartmentName(i.responsibleDept),
        milestones: mappedMilestones ?? i.milestones ?? []
      }
    })
  )

  const getCurrentScopeIndicatorsForMilestones = () => indicators.value

  const loadMilestonePayloadsIndividually = async (indicatorIds: string[]) => {
    const payloadMap: Record<string, unknown> = {}
    const concurrency = Math.min(milestoneFallbackConcurrency, indicatorIds.length)
    let currentIndex = 0

    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (currentIndex < indicatorIds.length) {
          const indicatorId = indicatorIds[currentIndex]
          currentIndex += 1

          try {
            const response = await milestoneApi.getMilestonesByIndicator(indicatorId)
            payloadMap[indicatorId] = response.success ? response.data : []
          } catch (error) {
            logger.warn(`[StrategicTaskView] 加载指标 ${indicatorId} 里程碑失败`, error)
            payloadMap[indicatorId] = []
          }
        }
      })
    )

    return payloadMap
  }

  const loadMilestonePayloads = async (indicatorIds: string[]) => {
    const payloadMap: Record<string, unknown> = {}
    const persistedIndicatorIds = indicatorIds
      .filter(id => /^\d+$/.test(id))
      .map(id => Number(id))
      .sort((a, b) => a - b)
    const transientIndicatorIds = indicatorIds.filter(id => !/^\d+$/.test(id))

    transientIndicatorIds.forEach(id => {
      payloadMap[id] = []
    })

    if (persistedIndicatorIds.length === 0) {
      return payloadMap
    }

    if (persistedIndicatorIds.length === 1) {
      const indicatorId = String(persistedIndicatorIds[0])
      const response = await milestoneApi.getMilestonesByIndicator(indicatorId)
      payloadMap[indicatorId] = response.success ? response.data : []
      return payloadMap
    }

    try {
      const response = await milestoneApi.getMilestonesByIndicatorIds(persistedIndicatorIds)
      if (!response.success || !response.data || typeof response.data !== 'object') {
        throw new Error(response.message || '批量加载里程碑返回异常')
      }

      const batchPayload = response.data as Record<string, unknown>
      persistedIndicatorIds.forEach(indicatorId => {
        payloadMap[String(indicatorId)] = batchPayload[String(indicatorId)] ?? []
      })

      return payloadMap
    } catch (error) {
      logger.warn('[StrategicTaskView] 批量加载里程碑失败，回退逐个加载', error)
      const fallbackPayloadMap = await loadMilestonePayloadsIndividually(
        persistedIndicatorIds.map(indicatorId => String(indicatorId))
      )
      return {
        ...payloadMap,
        ...fallbackPayloadMap
      }
    }
  }

  const loadMilestonesForCurrentScope = async () => {
    const dept = selectedDepartment.value
    if (!dept) {
      return
    }

    const requestId = milestoneLoadRequestId.value + 1
    milestoneLoadRequestId.value = requestId

    const indicatorsToLoad = getCurrentScopeIndicatorsForMilestones()

    // 当前部门的里程碑缓存
    const deptMilestoneCache = milestoneCache.value[dept] || {}

    // 分离需要请求的指标和可以直接从缓存读取的指标
    const needRequestIds: string[] = []

    indicatorsToLoad.forEach(i => {
      const id = String(i.id ?? '').trim()
      if (!id) return

      if (deptMilestoneCache[id]) {
        // 从缓存读取
        milestoneMap.value[id] = deptMilestoneCache[id]
        loadedMilestoneIds.value.add(id)
      } else if (!loadedMilestoneIds.value.has(id) && !loadingMilestoneIds.value.has(id)) {
        needRequestIds.push(id)
      }
    })

    // 处理需要请求的指标
    if (needRequestIds.length === 0) {
      return
    }

    needRequestIds.forEach(indicatorId => {
      loadingMilestoneIds.value.add(indicatorId)
    })

    try {
      const payloadMap = await loadMilestonePayloads(needRequestIds)
      const nextMilestoneMap = { ...milestoneMap.value }
      const nextDeptMilestoneCache = {
        ...(milestoneCache.value[dept] || {})
      }

      needRequestIds.forEach(indicatorId => {
        const rawMilestones = extractMilestones(payloadMap[indicatorId] ?? [])
        const normalizedMilestones = rawMilestones.map((m, idx) => normalizeMilestone(m, idx))
        nextMilestoneMap[indicatorId] = normalizedMilestones
        nextDeptMilestoneCache[indicatorId] = normalizedMilestones
      })

      milestoneCache.value = {
        ...milestoneCache.value,
        [dept]: nextDeptMilestoneCache
      }

      if (milestoneLoadRequestId.value === requestId && selectedDepartment.value === dept) {
        milestoneMap.value = nextMilestoneMap
      }
    } catch (error) {
      logger.warn('[StrategicTaskView] 加载当前范围里程碑失败', error)

      const nextMilestoneMap = { ...milestoneMap.value }
      const nextDeptMilestoneCache = {
        ...(milestoneCache.value[dept] || {})
      }

      needRequestIds.forEach(indicatorId => {
        nextMilestoneMap[indicatorId] = []
        nextDeptMilestoneCache[indicatorId] = []
      })

      milestoneCache.value = {
        ...milestoneCache.value,
        [dept]: nextDeptMilestoneCache
      }

      if (milestoneLoadRequestId.value === requestId && selectedDepartment.value === dept) {
        milestoneMap.value = nextMilestoneMap
      }
    } finally {
      needRequestIds.forEach(indicatorId => {
        loadingMilestoneIds.value.delete(indicatorId)
        loadedMilestoneIds.value.add(indicatorId)
      })
    }
  }

  const reloadMilestonesForIndicator = async (indicatorId: string, dept: string) => {
    const response = await milestoneApi.getMilestonesByIndicator(indicatorId)
    const rawMilestones = response.success ? extractMilestones(response.data) : []
    const normalizedMilestones = rawMilestones.map((m, idx) => normalizeMilestone(m, idx))

    milestoneMap.value[indicatorId] = normalizedMilestones
    milestoneCache.value[dept] = milestoneCache.value[dept] || {}
    milestoneCache.value[dept][indicatorId] = normalizedMilestones
    loadedMilestoneIds.value.add(indicatorId)

    return normalizedMilestones
  }

  const isMilestoneLoading = (indicatorId: string | number): boolean =>
    loadingMilestoneIds.value.has(String(indicatorId))

  watch(
    [
      selectedDepartment,
      () => strategicStore.indicators.length,
      () => orgStore.departments.length,
      () => timeContext.currentYear,
      currentPlanTaskIdSetSignature
    ],
    () => {
      if (isBootstrappingPage.value) {
        return
      }
      void loadMilestonesForCurrentScope()
    }
    // 移除 immediate: true，因为初始执行时 selectedDepartment 为空会导致加载错误的指标范围
    // 里程碑加载改为在 onMounted 中显式调用，确保与主数据同时加载
  )

  watch(
    () => timeContext.currentYear,
    () => {
      milestoneMap.value = {}
      loadedMilestoneIds.value = new Set<string>()
      loadingMilestoneIds.value = new Set<string>()
      milestoneCache.value = {}
      invalidateQueries(['task.scope'])
      if (isBootstrappingPage.value) {
        return
      }
      void loadMilestonesForCurrentScope()
    }
  )

  // 计算当前选中部门的基础性任务指标权重总和（用于下发验证）
  // 基础性判定以“后端真实 task_type=BASIC”为准
  const departmentTotalWeight = computed(() => {
    if (!selectedDepartment.value) {
      return 0
    }

    const deptIndicators = indicators.value.filter(i => isBasicIndicatorForCurrentRules(i))

    // 计算权重之和
    return deptIndicators.reduce((sum, i) => sum + Number(i.weight || 0), 0)
  })

  const ensurePlanCanDistribute = (): boolean => {
    if (departmentTotalWeight.value !== 100) {
      ElMessage.warning(`基础性任务指标权重合计必须为100%，当前为${departmentTotalWeight.value}`)
      return false
    }
    return true
  }

  // 整体状态：直接使用 Plan 的状态，不再根据指标状态混合计算
  // 兼容后端大写状态和 Plan 模块的小写状态
  const overallStatus = computed(() => {
    const planStatus = currentPlanStatus.value
    if (!planStatus) {
      return { label: '暂无指标', type: 'info' }
    }

    return getPlanStatusDisplay(planStatus) || { label: String(planStatus), type: 'info' }
  })

  // 获取当前选中部门对应的 Plan（包含审批实例信息）
  const currentPlan = computed(() => {
    return findCurrentPlanByDepartment()
  })

  const currentDepartmentOrgId = computed(() => resolveDepartmentIdByName(selectedDepartment.value))

  const currentPlanReportSummary = ref<{
    id: number
    workflowInstanceId?: number | null
    currentTaskId?: number | null
    workflowStatus?: string | null
    currentStepName?: string | null
    currentApproverName?: string | null
    canWithdraw?: boolean
    status?: string | null
  } | null>(null)
  const latestPlanReportSummary = ref<{ id: number } | null>(null)

  const approvalWorkflowReportSummary = computed(() => {
    const currentWorkflowInstanceId = Number(
      currentPlanReportSummary.value?.workflowInstanceId ?? NaN
    )
    const currentStatus = String(
      currentPlanReportSummary.value?.workflowStatus || currentPlanReportSummary.value?.status || ''
    )
      .trim()
      .toUpperCase()

    if (
      currentPlanReportSummary.value?.id &&
      Number.isFinite(currentWorkflowInstanceId) &&
      currentWorkflowInstanceId > 0 &&
      currentStatus !== 'DRAFT'
    ) {
      return currentPlanReportSummary.value
    }

    // 当前轮次摘要即使还没拿到完整 workflow 绑定，也应该优先用于页面态展示，
    // 避免旧的 latest 记录把刚提交/刚撤回的当前状态覆盖掉。
    if (currentPlanReportSummary.value) {
      return currentPlanReportSummary.value
    }

    return latestPlanReportSummary.value
  })

  function hasWorkflowBinding(
    summary:
      | {
          id?: number | null
          workflowInstanceId?: number | null
          currentTaskId?: number | null
          workflowStatus?: string | null
          status?: string | null
          currentStepName?: string | null
        }
      | null
      | undefined
  ): boolean {
    if (!summary?.id) {
      return false
    }

    const workflowInstanceId = Number(summary.workflowInstanceId ?? NaN)
    if (Number.isFinite(workflowInstanceId) && workflowInstanceId > 0) {
      return true
    }

    const currentTaskId = Number(summary.currentTaskId ?? NaN)
    if (Number.isFinite(currentTaskId) && currentTaskId > 0) {
      return true
    }

    const workflowStatus = String(summary.workflowStatus || summary.status || '')
      .trim()
      .toUpperCase()
    if (workflowStatus && workflowStatus !== 'DRAFT') {
      return true
    }

    return Boolean(String(summary.currentStepName || '').trim())
  }

  const hasApprovalWorkflowReportBinding = computed(() =>
    hasWorkflowBinding(
      approvalWorkflowReportSummary.value as
        | {
            id?: number | null
            workflowInstanceId?: number | null
            currentTaskId?: number | null
            workflowStatus?: string | null
            status?: string | null
            currentStepName?: string | null
          }
        | null
        | undefined
    )
  )

  const shouldPreferCurrentReportWorkflow = computed(() => {
    const reportWorkflowStatus = String(
      approvalWorkflowReportSummary.value?.workflowStatus ||
        approvalWorkflowReportSummary.value?.status ||
        ''
    )
      .trim()
      .toUpperCase()

    return (
      hasApprovalWorkflowReportBinding.value &&
      (['PENDING', 'IN_REVIEW', 'SUBMITTED'].includes(reportWorkflowStatus) ||
        Boolean(approvalWorkflowReportSummary.value?.currentTaskId) ||
        Boolean(String(approvalWorkflowReportSummary.value?.currentStepName || '').trim()))
    )
  })

  // 获取当前选中部门对应的 Plan 状态
  const currentPlanStatus = computed(() => {
    return normalizePlanStatus(currentPlan.value?.status)
  })

  const currentApprovalWorkflowStatus = computed(() => {
    if (shouldPreferCurrentReportWorkflow.value) {
      return String(
        approvalWorkflowReportSummary.value?.workflowStatus ||
          approvalWorkflowReportSummary.value?.status ||
          preloadedPlanWorkflowDetail.value?.status ||
          currentPlan.value?.workflowStatus ||
          currentPlan.value?.status ||
          ''
      )
        .trim()
        .toUpperCase()
    }

    return String(
      preloadedPlanWorkflowDetail.value?.status ||
        currentPlan.value?.workflowStatus ||
        currentPlan.value?.status ||
        approvalWorkflowReportSummary.value?.workflowStatus ||
        approvalWorkflowReportSummary.value?.status ||
        ''
    )
      .trim()
      .toUpperCase()
  })

  const currentApprovalStepName = computed(() => {
    if (shouldPreferCurrentReportWorkflow.value) {
      return String(
        approvalWorkflowReportSummary.value?.currentStepName ||
          preloadedPlanWorkflowDetail.value?.currentStepName ||
          (currentPlan.value as { currentStepName?: string } | null)?.currentStepName ||
          ''
      ).trim()
    }

    return String(
      preloadedPlanWorkflowDetail.value?.currentStepName ||
        (currentPlan.value as { currentStepName?: string } | null)?.currentStepName ||
        approvalWorkflowReportSummary.value?.currentStepName ||
        ''
    ).trim()
  })

  const currentApprovalApproverName = computed(() => {
    if (shouldPreferCurrentReportWorkflow.value) {
      return String(
        (approvalWorkflowReportSummary.value as { currentApproverName?: string | null } | null)
          ?.currentApproverName ||
          preloadedPlanWorkflowDetail.value?.currentApproverName ||
          ((currentPlan.value as { currentApproverName?: string } | null)?.currentApproverName ??
            '') ||
          ''
      ).trim()
    }

    return String(
      preloadedPlanWorkflowDetail.value?.currentApproverName ||
        ((currentPlan.value as { currentApproverName?: string } | null)?.currentApproverName ??
          '') ||
        (approvalWorkflowReportSummary.value as { currentApproverName?: string | null } | null)
          ?.currentApproverName ||
        ''
    ).trim()
  })

  const currentApprovalFlowName = computed(() => {
    return String(
      preloadedPlanWorkflowDetail.value?.flowName ||
        preloadedPlanWorkflowDetail.value?.definitionName ||
        approvalWorkflowPreview.value?.workflowName ||
        ''
    ).trim()
  })

  const currentApprovalStepPreview = computed(() => {
    const stepName = normalizeWorkflowStepName(currentApprovalStepName.value)
    if (!stepName || !approvalWorkflowPreview.value?.steps?.length) {
      return null
    }

    return (
      approvalWorkflowPreview.value.steps.find(
        step => normalizeWorkflowStepName(step.stepName) === stepName
      ) || null
    )
  })

  const preloadedPlanWorkflowDetail = ref<WorkflowInstanceDetailResponse | null>(null)
  const approvalStatusPopoverLoading = ref(false)
  const currentApprovalRuntimeCandidateNames = ref<string[]>([])
  const approvalCandidateCache = new Map<string, string[]>()
  const canLookupWorkflowUsers = computed(() => authStore.userRole === 'strategic_dept')

  const normalizeOrgRoleUserDisplayName = (user: {
    realName?: unknown
    name?: unknown
    username?: unknown
  }): string => {
    return String(user.realName || user.name || user.username || '').trim()
  }

  async function loadCurrentApprovalRuntimeCandidateNames(): Promise<void> {
    const orgId = resolveExpectedApproverOrgIdForCurrentPlan()
    const roleCodes = resolveExpectedApproverRoleCodesForCurrentPlan()
    if (!canLookupWorkflowUsers.value || !orgId || roleCodes.length === 0) {
      currentApprovalRuntimeCandidateNames.value = []
      return
    }

    const cacheKey = `${orgId}::${roleCodes.slice().sort().join(',')}`
    const cached = approvalCandidateCache.get(cacheKey)
    if (cached) {
      currentApprovalRuntimeCandidateNames.value = cached
      return
    }

    try {
      const users = await getUsersByOrgId(orgId)
      const names = users
        .filter(user => user.isActive !== false)
        .filter(user => {
          const userRoles = Array.isArray(user.roles) ? user.roles.filter(Boolean) : []
          return roleCodes.some(roleCode => userRoles.includes(roleCode))
        })
        .map(user => normalizeOrgRoleUserDisplayName(user))
        .filter(Boolean)

      const uniqueNames = [...new Set(names)]
      approvalCandidateCache.set(cacheKey, uniqueNames)
      currentApprovalRuntimeCandidateNames.value = uniqueNames
    } catch (error) {
      currentApprovalRuntimeCandidateNames.value = []
      logger.warn('[StrategicTaskView] 加载页面级审批候选人失败:', {
        orgId,
        roleCodes,
        error
      })
    }
  }

  const currentApprovalCandidateNames = computed(() => {
    if (currentApprovalRuntimeCandidateNames.value.length > 0) {
      return currentApprovalRuntimeCandidateNames.value
    }

    const candidates = currentApprovalStepPreview.value?.candidateApprovers
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return []
    }

    return candidates
      .map(candidate => normalizePreviewCandidateDisplayName(candidate))
      .filter(Boolean)
  })

  watch(
    () => [
      currentApprovalStepName.value,
      resolveExpectedApproverOrgIdForCurrentPlan(),
      resolveExpectedApproverRoleCodesForCurrentPlan().join('|')
    ],
    () => {
      void loadCurrentApprovalRuntimeCandidateNames()
    },
    { immediate: true }
  )

  const approvalFlowStatusMeta = computed(() => {
    const workflowStatus = currentApprovalWorkflowStatus.value
    const stepName = currentApprovalStepName.value
    const approverName = currentApprovalApproverName.value
    const candidateNames = currentApprovalCandidateNames.value

    if (
      workflowStatus === 'APPROVED' ||
      workflowStatus === 'COMPLETED' ||
      workflowStatus === 'FINISHED'
    ) {
      return {
        label: '已完成审批',
        tagType: 'success' as const,
        description: '当前计划审批流程已完成。'
      }
    }

    if (
      workflowStatus === 'REJECTED' ||
      workflowStatus === 'RETURNED' ||
      workflowStatus === 'WITHDRAWN' ||
      workflowStatus === 'CANCELLED'
    ) {
      return {
        label: '已退回',
        tagType: 'danger' as const,
        description: stepName ? `当前流程已在“${stepName}”环节退回。` : '当前计划审批流程已退回。'
      }
    }

    if (
      stepName ||
      approverName ||
      workflowStatus === 'PENDING' ||
      workflowStatus === 'IN_REVIEW'
    ) {
      const label = stepName ? `待${stepName}审批` : '审批中'

      return {
        label,
        tagType: 'warning' as const,
        description:
          candidateNames.length > 0
            ? `当前节点有 ${candidateNames.length} 位可审批人。`
            : stepName
              ? `当前节点：${stepName}`
              : '当前计划正在审批中。'
      }
    }

    if (hasApprovalWorkflowReportBinding.value) {
      return {
        label: '查看流程',
        tagType: 'info' as const,
        description: '当前计划已有审批记录，可进入审批中心查看。'
      }
    }

    return {
      label: '未发起流程',
      tagType: 'info' as const,
      description: '当前计划还未发起审批流程。'
    }
  })

  function resolveExpectedApproverRoleCodesForCurrentPlan(): string[] {
    const stepName = String(
      approvalWorkflowReportSummary.value?.currentStepName ||
        preloadedPlanWorkflowDetail.value?.currentStepName ||
        (currentPlan.value as { currentStepName?: string } | null)?.currentStepName ||
        ''
    ).trim()

    if (!stepName) {
      return []
    }

    if (
      stepName.includes('职能部门审批') ||
      stepName.includes('职能部门终审') ||
      stepName.includes('二级学院审批')
    ) {
      return ['ROLE_APPROVER']
    }

    if (stepName.includes('战略发展部')) {
      return ['ROLE_STRATEGY_DEPT_HEAD']
    }

    if (stepName.includes('分管校领导') || stepName.includes('学院院长')) {
      return ['ROLE_VICE_PRESIDENT']
    }

    return []
  }

  function resolveExpectedApproverOrgIdForCurrentPlan(): number | null {
    const plan = currentPlan.value as
      | ({
          currentStepName?: string
          createdByOrgId?: string | number
          targetOrgId?: string | number
        } & Record<string, unknown>)
      | null

    const stepName = String(
      approvalWorkflowReportSummary.value?.currentStepName ||
        preloadedPlanWorkflowDetail.value?.currentStepName ||
        plan?.currentStepName ||
        ''
    ).trim()
    if (!stepName) {
      return null
    }

    if (stepName.includes('战略发展部')) {
      const sourceOrgId = Number(
        preloadedPlanWorkflowDetail.value?.sourceOrgId ?? plan?.createdByOrgId ?? NaN
      )
      return Number.isFinite(sourceOrgId) && sourceOrgId > 0 ? sourceOrgId : null
    }

    if (
      stepName.includes('职能部门审批') ||
      stepName.includes('职能部门终审') ||
      stepName.includes('二级学院审批')
    ) {
      const targetOrgId = Number(
        preloadedPlanWorkflowDetail.value?.targetOrgId ?? plan?.targetOrgId ?? NaN
      )
      return Number.isFinite(targetOrgId) && targetOrgId > 0 ? targetOrgId : null
    }

    return null
  }

  const hydratingPlanDetail = ref(false)
  const departmentViewRequestId = ref(0)
  const departmentViewLoadingRequestId = ref(0)
  let currentPlanReportSummaryPromise: Promise<{
    currentReport: Awaited<ReturnType<typeof indicatorFillApi.getCurrentMonthPlanReport>>
    latestReport: Awaited<ReturnType<typeof indicatorFillApi.getLatestCurrentMonthPlanReport>>
  }> | null = null
  let currentPlanReportSummaryKey = ''

  async function syncCurrentPlanReportSummaries(options: { force?: boolean } = {}): Promise<void> {
    const planId = Number(currentPlan.value?.id ?? NaN)
    const reportOrgId = Number(currentDepartmentOrgId.value ?? NaN)
    if (
      !(Number.isFinite(planId) && planId > 0 && Number.isFinite(reportOrgId) && reportOrgId > 0)
    ) {
      currentPlanReportSummary.value = null
      latestPlanReportSummary.value = null
      return
    }

    const cacheKey = `${planId}:${reportOrgId}:${timeContext.currentYear}`
    if (
      !options.force &&
      currentPlanReportSummaryPromise &&
      currentPlanReportSummaryKey === cacheKey
    ) {
      logger.debug('[StrategicTaskView] reuse plan report summaries request', { cacheKey })
      const summaries = await currentPlanReportSummaryPromise
      currentPlanReportSummary.value = summaries.currentReport
      latestPlanReportSummary.value = summaries.latestReport
      return
    }

    currentPlanReportSummaryKey = cacheKey
    logger.debug('[StrategicTaskView] load plan report summaries', {
      planId,
      reportOrgId,
      year: timeContext.currentYear,
      force: options.force === true
    })
    currentPlanReportSummaryPromise = indicatorFillApi.getCurrentMonthPlanReportSummaries(
      planId,
      reportOrgId
    )

    try {
      const summaries = await currentPlanReportSummaryPromise
      currentPlanReportSummary.value = summaries.currentReport
      latestPlanReportSummary.value = summaries.latestReport
    } finally {
      currentPlanReportSummaryPromise = null
    }
  }

  const hydrateCurrentPlanWorkflowState = async (options: { force?: boolean } = {}) => {
    const planId = Number(currentPlan.value?.id ?? NaN)
    if (!Number.isFinite(planId) || planId <= 0) {
      return
    }

    const status = currentPlanStatus.value
    if (status !== 'PENDING' && status !== 'DISTRIBUTED') {
      return
    }

    const plan = currentPlan.value as
      | (typeof currentPlan.value & {
          canWithdraw?: boolean
          workflowInstanceId?: number
          currentTaskId?: number
        })
      | null

    const needHydration =
      options.force ||
      (status === 'PENDING' && typeof plan?.canWithdraw !== 'boolean') ||
      plan?.workflowInstanceId == null ||
      plan?.currentTaskId == null

    if (!needHydration || hydratingPlanDetail.value) {
      return
    }

    hydratingPlanDetail.value = true
    try {
      await planStore.loadPlanDetails(planId, { force: true, background: true })
    } catch (error) {
      logger.warn('[StrategicTaskView] 预加载 Plan 工作流详情失败:', { planId, error })
    } finally {
      hydratingPlanDetail.value = false
    }
  }

  const refreshCurrentDepartmentView = async (
    options: { showLoading?: boolean; force?: boolean; reloadIndicators?: boolean } = {}
  ) => {
    const requestId = departmentViewRequestId.value + 1
    departmentViewRequestId.value = requestId
    logger.debug('[StrategicTaskView] refresh department view', {
      requestId,
      department: selectedDepartment.value,
      planId: currentPlan.value?.id ?? null,
      year: timeContext.currentYear,
      force: options.force === true
    })

    if (options.showLoading) {
      pageTransitionLoading.value = true
      departmentViewLoadingRequestId.value = requestId
    }

    try {
      await planStore.loadPlans({ force: options.force, background: true })
      await hydrateCurrentPlanWorkflowState()
      if (options.reloadIndicators === true || strategicStore.indicators.length === 0) {
        await strategicStore.loadIndicatorsByYear(timeContext.currentYear, {
          force: options.force
        })
      }
      await loadCurrentPlanTaskScope({ force: options.force })
      await syncCurrentPlanReportSummaries({ force: options.force })
      if (
        currentPlanStatus.value === 'PENDING' ||
        currentPlanStatus.value === 'DISTRIBUTED' ||
        hasApprovalWorkflowReportBinding.value
      ) {
        await preloadApprovalWorkflowDetail()
      }
    } finally {
      if (options.showLoading && departmentViewLoadingRequestId.value === requestId) {
        pageTransitionLoading.value = false
        departmentViewLoadingRequestId.value = 0
      }
    }
  }

  const PLAN_APPROVAL_SUBMIT_WORKFLOW_CODE = 'PLAN_DISPATCH_STRATEGY'
  const PLAN_APPROVAL_HISTORY_WORKFLOW_CODES = [
    'PLAN_DISPATCH_STRATEGY',
    'PLAN_DISPATCH_FUNCDEPT',
    'PLAN_APPROVAL_FUNCDEPT',
    'PLAN_APPROVAL_COLLEGE'
  ] as const

  const approvalSetupDialogVisible = ref(false)
  const approvalPreviewLoading = ref(false)
  const approvalSubmitting = ref(false)
  const approvalSubmitComment = ref('')
  const approvalWorkflowPreview = ref<WorkflowDefinitionPreviewResponse | null>(null)

  const hasApprovalPreview = computed(() => {
    return (approvalWorkflowPreview.value?.steps?.length || 0) > 0
  })

  const normalizePreviewCandidateDisplayName = (
    candidate: WorkflowDefinitionPreviewResponse['steps'][number]['candidateApprovers'][number]
  ) => {
    return candidate.realName || candidate.username || `用户${candidate.userId}`
  }

  const hasApprovalStepCandidates = (
    candidates?: WorkflowDefinitionPreviewResponse['steps'][number]['candidateApprovers']
  ) => {
    return Array.isArray(candidates) && candidates.length > 0
  }

  const normalizeWorkflowStepName = (value?: string | null) => {
    return String(value || '')
      .replace(/\s+/g, '')
      .trim()
  }

  const getCurrentCycleId = async (): Promise<number> => {
    const cycleResponse = await strategicApi.getCycleByYear(timeContext.currentYear)
    const cycleId =
      (cycleResponse.data as { cycleId?: number; id?: number } | null)?.cycleId ||
      (cycleResponse.data as { id?: number } | null)?.id

    if (!cycleResponse.success || !cycleId) {
      throw new Error(`未找到 ${timeContext.currentYear} 年对应的考核周期`)
    }

    return Number(cycleId)
  }

  const canCurrentUserSubmitCurrentPlan = computed(() => {
    const plan = currentPlan.value as
      | (typeof currentPlan.value & {
          createdByOrgId?: string | number
          createdByOrgName?: string
          targetOrgId?: string | number
          orgId?: string | number
          targetOrgName?: string
          orgName?: string
        })
      | null

    if (!plan || !currentUserOrgId.value || !isCurrentUserReporter.value) {
      return false
    }

    const planOrgId = Number(plan.createdByOrgId ?? NaN)
    if (Number.isFinite(planOrgId) && planOrgId > 0) {
      return currentUserOrgId.value === planOrgId
    }

    const planOrgName = normalizeDepartmentName(plan.createdByOrgName || '')
    const currentUserOrgName = normalizeDepartmentName(
      departmentIdNameMap.value.get(String(currentUserOrgId.value)) || ''
    )

    return Boolean(planOrgName) && planOrgName === currentUserOrgName
  })

  const getTaskTypeForPersistence = (taskCategory?: string): 'BASIC' | 'DEVELOPMENT' => {
    return String(taskCategory || '').trim() === '基础性' ? 'BASIC' : 'DEVELOPMENT'
  }

  const findExistingTaskIdByName = async (
    planId: number,
    taskName: string
  ): Promise<number | null> => {
    const existingTasksResponse = await strategicApi.getTasksByPlanId(planId)
    if (!existingTasksResponse.success || !Array.isArray(existingTasksResponse.data)) {
      return null
    }

    const matchedTask = existingTasksResponse.data.find(
      task => String(task.taskName || '').trim() === taskName
    )
    const matchedTaskId = Number(matchedTask?.taskId ?? matchedTask?.id ?? NaN)
    return Number.isFinite(matchedTaskId) ? matchedTaskId : null
  }

  const ensurePersistedTaskIdForIndicator = async (
    indicator: Pick<
      StrategicIndicator,
      'taskContent' | 'type2' | 'remark' | 'responsibleDept' | 'ownerDept'
    > & {
      taskId?: string | number | null
    }
  ): Promise<number> => {
    const trimmedTaskName = String(indicator.taskContent || '').trim()
    if (!trimmedTaskName) {
      throw new Error('请先填写战略任务')
    }

    const explicitTaskId = Number(indicator.taskId ?? NaN)
    if (Number.isFinite(explicitTaskId) && explicitTaskId > 0) {
      return explicitTaskId
    }

    const plan = currentPlan.value as Record<string, unknown> | null
    const planId = Number(plan?.id ?? plan?.taskId ?? NaN)
    if (!Number.isFinite(planId)) {
      throw new Error('未找到当前部门对应的计划，无法创建战略任务')
    }

    const existingTaskId = await findExistingTaskIdByName(planId, trimmedTaskName)
    if (existingTaskId) {
      return existingTaskId
    }

    const cycleId = await getCurrentCycleId()
    const targetOrgId =
      Number(plan?.targetOrgId ?? plan?.orgId ?? NaN) ||
      resolveDepartmentIdByName(indicator.responsibleDept || selectedDepartment.value) ||
      null
    const createdByOrgId =
      Number(plan?.createdByOrgId ?? NaN) ||
      resolveDepartmentIdByName(indicator.ownerDept || '战略发展部') ||
      null

    if (!targetOrgId || !createdByOrgId) {
      throw new Error('缺少任务归属部门信息，无法创建战略任务')
    }

    const createTaskResponse = await strategicApi.createBackendTask({
      taskName: trimmedTaskName,
      taskType: getTaskTypeForPersistence(indicator.type2),
      planId,
      cycleId,
      orgId: targetOrgId,
      createdByOrgId,
      sortOrder: 0,
      taskDesc: trimmedTaskName,
      remark: indicator.remark || null
    })

    const persistedTaskId = Number(
      createTaskResponse.data?.taskId ?? createTaskResponse.data?.id ?? NaN
    )
    if (!Number.isFinite(persistedTaskId)) {
      throw new Error('创建战略任务成功，但未返回任务ID')
    }

    return persistedTaskId
  }

  const registerTaskLocally = (taskId: string | number, taskType: 'BASIC' | 'DEVELOPMENT') => {
    const normalizedTaskId = String(taskId).trim()
    if (!normalizedTaskId) {
      return
    }

    backendTaskTypeMap.value = {
      ...backendTaskTypeMap.value,
      [normalizedTaskId]: taskType
    }

    currentPlanTaskTypeMap.value = {
      ...currentPlanTaskTypeMap.value,
      [normalizedTaskId]: taskType
    }

    const nextTaskIds = new Set(currentPlanTaskIdSet.value)
    nextTaskIds.add(normalizedTaskId)
    currentPlanTaskIdSet.value = nextTaskIds
  }

  const normalizeEditableText = (value: unknown): string => {
    const trimmed = String(value ?? '').trim()
    if (!trimmed) {
      return ''
    }

    const normalized = trimmed.toLowerCase()
    if (normalized === 'null' || normalized === 'undefined') {
      return ''
    }

    return trimmed
  }

  const persistTaskContentEdit = async (row: StrategicIndicator, taskName: string) => {
    const trimmedTaskName = normalizeEditableText(taskName)
    if (!trimmedTaskName) {
      throw new Error('战略任务名称不能为空')
    }

    const existingTaskId = getIndicatorTaskId(row)
    if (existingTaskId) {
      await strategicApi.updateTaskName(existingTaskId, trimmedTaskName)
      strategicStore.patchIndicatorsByTaskId(existingTaskId, {
        taskContent: trimmedTaskName
      })
      return
    }

    const taskType = getTaskTypeForPersistence(row.type2)
    const persistedTaskId = await ensurePersistedTaskIdForIndicator({
      taskContent: trimmedTaskName,
      type2: row.type2,
      remark: row.remark,
      responsibleDept: row.responsibleDept,
      ownerDept: row.ownerDept
    })

    await strategicStore.updateIndicator(row.id.toString(), {
      taskId: persistedTaskId
    })
    strategicStore.patchIndicator(row.id.toString(), {
      taskId: String(persistedTaskId),
      taskContent: trimmedTaskName
    })
    registerTaskLocally(persistedTaskId, taskType)
  }

  // 判断 Plan 是否已下发（已审批通过，不能撤回）
  const isPlanDistributed = computed(() => {
    const status = currentPlanStatus.value
    return status === 'DISTRIBUTED'
  })

  const normalizeWorkflowRuntimeValue = (value: unknown): string =>
    String(value || '')
      .trim()
      .toUpperCase()

  const isSubmitLikeWorkflowTask = (task: WorkflowTaskResponse | null | undefined): boolean => {
    const stepNo = Number(task?.stepNo ?? NaN)
    if (Number.isFinite(stepNo) && stepNo === 1) {
      return true
    }

    const stepType = normalizeWorkflowRuntimeValue(task?.stepType)
    if (stepType === 'SUBMIT' || stepType === 'START') {
      return true
    }

    const taskText = normalizeWorkflowRuntimeValue(
      [task?.taskKey, task?.taskName, task?.currentStepName].filter(Boolean).join(' ')
    )
    return (
      taskText.includes('SUBMIT') ||
      taskText.includes('START') ||
      taskText.includes('提交') ||
      taskText.includes('发起')
    )
  }

  const isSubmitLikeWorkflowHistoryItem = (
    item: WorkflowHistoryItem | null | undefined
  ): boolean => {
    const stepText = normalizeWorkflowRuntimeValue(
      [item?.taskName, item?.stepName].filter(Boolean).join(' ')
    )
    return (
      stepText.includes('SUBMIT') ||
      stepText.includes('START') ||
      stepText.includes('提交') ||
      stepText.includes('发起')
    )
  }

  const isCompletedWorkflowTask = (task: WorkflowTaskResponse): boolean => {
    const status = normalizeWorkflowRuntimeValue(task.status)
    return ['APPROVED', 'COMPLETED', 'PASSED'].includes(status) || Boolean(task.approvedAt)
  }

  const isWorkflowHistoryDecision = (item: WorkflowHistoryItem): boolean => {
    const action = normalizeWorkflowRuntimeValue(item.action)
    return action.includes('APPROVE') || action.includes('PASS') || action.includes('REJECT')
  }

  const resolvePreviousCompletedWorkflowTask = (
    pendingTask: WorkflowTaskResponse,
    tasks: WorkflowTaskResponse[]
  ): WorkflowTaskResponse | null => {
    const pendingStepNo = Number(pendingTask.stepNo ?? NaN)
    if (!Number.isFinite(pendingStepNo)) {
      return null
    }

    return (
      tasks
        .filter(task => {
          const taskStepNo = Number(task.stepNo ?? NaN)
          return (
            Number.isFinite(taskStepNo) &&
            taskStepNo < pendingStepNo &&
            isCompletedWorkflowTask(task)
          )
        })
        .sort((left, right) => {
          const leftStepNo = Number(left.stepNo ?? Number.MIN_SAFE_INTEGER)
          const rightStepNo = Number(right.stepNo ?? Number.MIN_SAFE_INTEGER)
          if (leftStepNo !== rightStepNo) {
            return rightStepNo - leftStepNo
          }
          return String(right.approvedAt || right.createdTime || '').localeCompare(
            String(left.approvedAt || left.createdTime || '')
          )
        })[0] || null
    )
  }

  const resolveLatestWorkflowHistoryDecision = (
    history: WorkflowHistoryItem[]
  ): WorkflowHistoryItem | null => {
    return history.filter(isWorkflowHistoryDecision).at(-1) || null
  }

  const isPlanPreviousNodeSubmitterWithdrawStage = computed(() => {
    const detail = preloadedPlanWorkflowDetail.value
    if (!detail) {
      return true
    }

    const tasks = Array.isArray(detail.tasks) ? detail.tasks : []
    const pendingTask = currentPendingPlanWorkflowTask.value
    if (tasks.length > 0 && !pendingTask) {
      return false
    }

    if (pendingTask && isSubmitLikeWorkflowTask(pendingTask)) {
      return false
    }

    if (pendingTask) {
      const previousTask = resolvePreviousCompletedWorkflowTask(pendingTask, tasks)
      if (previousTask) {
        return isSubmitLikeWorkflowTask(previousTask)
      }
    }

    const history = Array.isArray(detail.history) ? detail.history : []
    const latestHistoryDecision = resolveLatestWorkflowHistoryDecision(history)
    if (latestHistoryDecision) {
      return isSubmitLikeWorkflowHistoryItem(latestHistoryDecision)
    }

    return true
  })

  const hasPlanWorkflowNodeEvidence = computed(() => {
    const detail = preloadedPlanWorkflowDetail.value
    const hasTaskEvidence = Array.isArray(detail?.tasks) && detail.tasks.length > 0
    const hasHistoryEvidence = Array.isArray(detail?.history) && detail.history.length > 0
    return hasTaskEvidence || hasHistoryEvidence
  })

  // 判断 Plan 是否可以撤回
  // 业务口径：只允许“上一个已完成节点是填报/提交节点”时撤回。
  // 上一个节点一旦变成审批人节点，后续审批中即使后端 canWithdraw 仍为 true，前端也必须置灰。
  // 撤回权限只跟当前部门填报人走，不在前端额外放宽跨部门管理权限。
  const canWithdrawPlan = computed(() => {
    const status = currentPlanStatus.value
    const workflowStatus = currentApprovalWorkflowStatus.value
    const canWithdrawFlag =
      preloadedPlanWorkflowDetail.value?.canWithdraw ??
      (approvalWorkflowReportSummary.value as { canWithdraw?: boolean } | null)?.canWithdraw ??
      currentPlan.value?.canWithdraw

    if (status === 'DISTRIBUTED') {
      return false
    }

    const isPendingWorkflow =
      status === 'PENDING' || ['PENDING', 'IN_REVIEW', 'SUBMITTED'].includes(workflowStatus)
    const isSubmitterWithdrawStage = isPlanPreviousNodeSubmitterWithdrawStage.value
    const isWorkflowNodeWithdrawable = hasPlanWorkflowNodeEvidence.value
      ? isSubmitterWithdrawStage
      : Boolean(canWithdrawFlag)

    return isPendingWorkflow && isCurrentUserReporter.value && isWorkflowNodeWithdrawable
  })

  // 判断当前页面指标是否已进入“不可编辑”的流程阶段
  // @requirement: Plan-centric status - 使用 Plan 状态判断指标是否在流程中
  // 统一使用 Plan 状态作为口径，一个 Plan 下的所有指标共享同一个状态
  const isIndicatorInFlowStage = (_indicator: StrategicIndicator): boolean => {
    // Plan 处于待审核或已下发状态时，指标都处于流程中
    return currentPlanStatus.value === 'DISTRIBUTED' || currentPlanStatus.value === 'PENDING'
  }

  // 判断是否可以编辑（未下发状态才能编辑）
  const canEditIndicators = computed(() => {
    if (isReadOnly.value) {
      return false
    }
    if (!canEdit.value) {
      return false
    }
    return !hasDistributedIndicators.value
  })

  // @requirement: Plan-centric status - 使用 Plan 状态判断是否可以删除指标
  // 只有 Plan 处于草稿状态时才能删除指标
  const canDeleteIndicator = (indicator: StrategicIndicator): boolean => {
    if (isReadOnly.value) {
      return false
    }
    if (!canEdit.value) {
      return false
    }

    // 必须是有真实ID的指标行（排除分组/汇总等无ID行）
    if (!indicator || indicator.id === null || indicator.id === undefined || indicator.id === '') {
      return false
    }

    // Plan 必须处于草稿状态才能删除指标
    const isPlanDraft = currentPlanStatus.value === 'DRAFT' || !currentPlanStatus.value
    return isPlanDraft
  }

  const currentPendingPlanWorkflowTask = computed(() => {
    const detail = preloadedPlanWorkflowDetail.value
    if (!detail || !Array.isArray(detail.tasks) || detail.tasks.length === 0) {
      return null
    }

    const currentTaskId = String(detail.currentTaskId || '').trim()
    if (currentTaskId) {
      const matchedCurrentTask = detail.tasks.find(
        task => String(task.taskId || '') === currentTaskId
      )
      if (
        matchedCurrentTask &&
        String(matchedCurrentTask.status || '')
          .trim()
          .toUpperCase() === 'PENDING'
      ) {
        return matchedCurrentTask
      }
    }

    return (
      detail.tasks.find(
        task =>
          String(task.status || '')
            .trim()
            .toUpperCase() === 'PENDING'
      ) || null
    )
  })

  const hasCurrentPlanApprovalPermission = computed(() => {
    const workflowStatus = currentApprovalWorkflowStatus.value
    const isPendingApproval = ['PENDING', 'IN_REVIEW', 'SUBMITTED'].includes(workflowStatus)

    return canCurrentUserHandleWorkflowApproval({
      currentUserId: currentUserId.value,
      currentUserOrgId: currentUserOrgId.value,
      currentUserRoleCodes: currentUserRoleCodes.value,
      hasApprovalPermission: true,
      isPendingApproval,
      expectedApproverRoleCodes: resolveExpectedApproverRoleCodesForCurrentPlan(),
      expectedApproverOrgId: resolveExpectedApproverOrgIdForCurrentPlan()
    })
  })

  const canHandleCurrentPlanApproval = computed(() => {
    const workflowStatus = currentApprovalWorkflowStatus.value
    const isPendingApproval = ['PENDING', 'IN_REVIEW', 'SUBMITTED'].includes(workflowStatus)
    if (!isPendingApproval || !hasCurrentPlanApprovalPermission.value) {
      return false
    }

    const explicitApproverId = Number(
      preloadedPlanWorkflowDetail.value?.currentApproverId ??
        approvalWorkflowReportSummary.value?.currentApproverId ??
        currentPlan.value?.currentApproverId ??
        0
    )
    const currentUserIdValue = Number(currentUserId.value ?? 0)
    if (
      Number.isFinite(explicitApproverId) &&
      explicitApproverId > 0 &&
      Number.isFinite(currentUserIdValue) &&
      currentUserIdValue > 0
    ) {
      if (explicitApproverId === currentUserIdValue) {
        return true
      }
    }

    const pendingTaskAssigneeId = Number(currentPendingPlanWorkflowTask.value?.assigneeId ?? 0)
    if (
      Number.isFinite(pendingTaskAssigneeId) &&
      pendingTaskAssigneeId > 0 &&
      Number.isFinite(currentUserIdValue) &&
      currentUserIdValue > 0
    ) {
      if (pendingTaskAssigneeId === currentUserIdValue) {
        return true
      }
    }

    // 工具栏按钮与审批中心保持一致：
    // 只要当前用户具备处理当前待审节点的权限，就显示“处理审批”与红点，
    // 不再强依赖 currentTask/assignee 字段必须已经完整回填到首页状态。
    return true
  })

  // @requirement: Plan-centric status - 使用 Plan 状态判断待审批数量
  // Plan 处于 PENDING 状态时，表示有待审批的内容
  const pendingApprovalCount = computed(() => {
    return canHandleCurrentPlanApproval.value ? 1 : 0
  })

  const planUiPhase = computed<'draft' | 'pending_withdrawable' | 'pending_locked' | 'distributed'>(
    () => {
      const status = currentPlanStatus.value
      const workflowStatus = currentApprovalWorkflowStatus.value

      if (status === 'DISTRIBUTED') {
        return 'distributed'
      }

      if (status === 'PENDING' || ['PENDING', 'IN_REVIEW', 'SUBMITTED'].includes(workflowStatus)) {
        return canWithdrawPlan.value ? 'pending_withdrawable' : 'pending_locked'
      }

      if (workflowStatus === 'APPROVED') {
        return 'distributed'
      }

      return 'draft'
    }
  )

  const approvalEntryButtonText = computed(() => {
    if (canHandleCurrentPlanApproval.value) {
      return '处理审批'
    }
    return '查看审批'
  })

  // 任务审批抽屉状态
  const taskApprovalVisible = ref(false)
  const retainedRouteApprovalEntityType = ref<'PLAN' | 'PLAN_REPORT' | undefined>(undefined)
  const retainedRouteApprovalEntityId = ref<string | undefined>(undefined)
  watch(taskApprovalVisible, visible => {
    if (visible) {
      return
    }

    retainedRouteApprovalEntityType.value = undefined
    retainedRouteApprovalEntityId.value = undefined
  })

  const { routeApprovalEntityType, routeApprovalEntityId } = useApprovalRouteAutopen({
    supportedEntityTypes: ['PLAN', 'PLAN_REPORT'] as const,
    onAutoOpen: async () => {
      retainedRouteApprovalEntityType.value = routeApprovalEntityType.value
      retainedRouteApprovalEntityId.value = routeApprovalEntityId.value
      try {
        await syncSelectedDepartmentFromRoute()
        await nextTick()
        await refreshCurrentDepartmentView({ showLoading: true, force: true })
        await preloadApprovalWorkflowDetail()
      } catch (error) {
        logger.warn('[StrategicTaskView] 自动打开审批前刷新失败，降级使用当前页面数据:', error)
      } finally {
        await nextTick()
        taskApprovalVisible.value = true
      }
    },
    onClearFailure: error => {
      logger.warn('[StrategicTaskView] 清理审批自动打开参数失败:', error)
    }
  })

  const effectiveRouteApprovalEntityType = computed<'PLAN' | 'PLAN_REPORT' | undefined>(() => {
    return routeApprovalEntityType.value || retainedRouteApprovalEntityType.value
  })

  const effectiveRouteApprovalEntityId = computed<string | undefined>(() => {
    return routeApprovalEntityId.value || retainedRouteApprovalEntityId.value
  })

  const primaryApprovalWorkflowEntityType = computed<'PLAN' | 'PLAN_REPORT'>(() => {
    if (effectiveRouteApprovalEntityType.value) {
      return effectiveRouteApprovalEntityType.value
    }

    if (shouldPreferCurrentReportWorkflow.value) {
      return 'PLAN_REPORT'
    }

    const planWorkflowStatus = String(
      preloadedPlanWorkflowDetail.value?.status ||
        currentPlan.value?.workflowStatus ||
        currentPlan.value?.status ||
        ''
    )
      .trim()
      .toUpperCase()
    const hasPlanWorkflowBinding =
      Boolean(preloadedPlanWorkflowDetail.value?.instanceId) ||
      Boolean(currentPlan.value?.workflowInstanceId) ||
      Boolean(currentPlan.value?.currentTaskId) ||
      ['PENDING', 'IN_REVIEW', 'SUBMITTED', 'APPROVED', 'WITHDRAWN', 'REJECTED'].includes(
        planWorkflowStatus
      )

    return hasPlanWorkflowBinding
      ? 'PLAN'
      : hasApprovalWorkflowReportBinding.value
        ? 'PLAN_REPORT'
        : 'PLAN'
  })

  const primaryApprovalWorkflowEntityId = computed<number | string | undefined>(() => {
    if (primaryApprovalWorkflowEntityType.value === 'PLAN') {
      return effectiveRouteApprovalEntityId.value ?? currentPlan.value?.id
    }

    return (
      effectiveRouteApprovalEntityId.value ??
      (hasApprovalWorkflowReportBinding.value
        ? approvalWorkflowReportSummary.value?.id
        : undefined) ??
      currentPlan.value?.id
    )
  })

  const secondaryApprovalWorkflowEntityType = computed<'PLAN' | 'PLAN_REPORT' | undefined>(() => {
    // 战略任务页主流程固定优先展示 PLAN；若存在当前月 PLAN_REPORT，再作为补充历史展示。
    if (
      primaryApprovalWorkflowEntityType.value === 'PLAN' &&
      hasApprovalWorkflowReportBinding.value
    ) {
      return 'PLAN_REPORT'
    }

    if (primaryApprovalWorkflowEntityType.value === 'PLAN_REPORT' && currentPlan.value?.id) {
      return 'PLAN'
    }

    return undefined
  })

  const secondaryApprovalWorkflowEntityId = computed<number | string | undefined>(() => {
    if (secondaryApprovalWorkflowEntityType.value === 'PLAN_REPORT') {
      return approvalWorkflowReportSummary.value?.id ?? latestPlanReportSummary.value?.id
    }

    if (secondaryApprovalWorkflowEntityType.value === 'PLAN') {
      return currentPlan.value?.id
    }

    return undefined
  })

  const currentApprovalWorkflowCode = computed(() => {
    return String(preloadedPlanWorkflowDetail.value?.flowCode || '').trim()
  })

  // ==================== 下发/撤回按钮逻辑 ====================
  // 判断是否有已下发的指标
  const hasDistributedIndicators = computed(() => {
    const list = indicators.value
    if (list.length === 0) {
      return false
    }

    return list.some(isIndicatorInFlowStage)
  })

  // 判断是否处于"可以下发"状态（Plan 是草稿状态）
  const canDistribute = computed(() => {
    if (isReadOnly.value) {
      return false
    }
    if (!canEdit.value) {
      return false
    }

    // Plan 必须处于草稿状态才能下发
    const canSubmitPlan = currentPlanStatus.value === 'DRAFT' || !currentPlanStatus.value
    if (!canSubmitPlan) {
      return false
    }

    // 有指标且 Plan 处于草稿状态时可以下发
    return indicators.value.length > 0
  })

  // 下发/撤回按钮文本
  // 基于 Plan 状态：
  // - 草稿状态 → 下发
  // - 待审批/已下发状态 → 撤回
  const distributeButtonText = computed(() => {
    if (planUiPhase.value === 'draft') {
      return '发起审批'
    }
    return '撤回'
  })

  // 下发/撤回按钮类型
  const distributeButtonType = computed(() => {
    if (planUiPhase.value === 'draft') {
      return 'success'
    }
    return planUiPhase.value === 'pending_withdrawable' ? 'warning' : 'info'
  })

  // 下发/撤回按钮图标
  const distributeButtonIcon = computed(() => {
    if (planUiPhase.value === 'draft') {
      return Promotion
    }
    return RefreshLeft
  })

  const distributeButtonDisabledReason = computed(() => {
    if (isReadOnly.value) {
      return '历史快照为只读状态'
    }

    if (planUiPhase.value === 'draft' && !canCurrentUserSubmitCurrentPlan.value) {
      return '只有当前计划归属部门的填报人才可以发起审批'
    }

    if (planUiPhase.value === 'draft' && departmentTotalWeight.value !== 100) {
      return '权重未等于百分之百'
    }

    if (planUiPhase.value === 'pending_locked') {
      return isCurrentUserReporter.value
        ? '当前审批进度不支持撤回'
        : '当前登录身份不是填报人，不能撤回'
    }

    if (planUiPhase.value === 'distributed') {
      return '当前状态不可操作'
    }

    return ''
  })

  // 下发/撤回按钮是否禁用
  // 基于 Plan 状态：
  // - 只读状态：禁用
  // - 草稿状态：启用（下发）
  // - 待审批状态：检查是否在第一个节点
  // - 已下发状态：禁用（不可撤回）
  const distributeButtonDisabled = computed(() => {
    return Boolean(distributeButtonDisabledReason.value)
  })

  const resetApprovalSetupDialog = () => {
    approvalWorkflowPreview.value = null
    approvalSubmitComment.value = ''
  }

  const openApprovalSetupDialog = async () => {
    const planId = Number(currentPlan.value?.id ?? NaN)
    if (!Number.isFinite(planId) || planId <= 0) {
      ElMessage.warning('当前部门还没有可提交审批的计划')
      return
    }

    approvalPreviewLoading.value = true
    approvalSetupDialogVisible.value = true

    try {
      const response = await getWorkflowDefinitionPreviewByCode(PLAN_APPROVAL_SUBMIT_WORKFLOW_CODE)
      if (!response.success || !response.data) {
        throw new Error(response.message || '加载审批流程失败')
      }

      approvalWorkflowPreview.value = response.data
    } catch (error) {
      approvalSetupDialogVisible.value = false
      resetApprovalSetupDialog()
      logger.error('[StrategicTaskView] Failed to load workflow preview:', error)
      const message = error instanceof Error ? error.message : '加载审批流程失败'
      if (message.includes('Workflow definition not found')) {
        ElMessage.error('当前环境未配置审批流程定义，无法发起审批')
        return
      }
      if (message.includes('No available approver candidates')) {
        ElMessage.error('当前审批节点未匹配到可用审批人，无法发起审批')
        return
      }
      if (message.includes('missing role assignment')) {
        ElMessage.error('当前审批流程配置不完整，无法发起审批')
        return
      }
      ElMessage.error(message)
    } finally {
      approvalPreviewLoading.value = false
    }
  }

  const handleCloseApprovalSetupDialog = () => {
    approvalSetupDialogVisible.value = false
    resetApprovalSetupDialog()
  }

  const refreshApprovalCenterLiveView = async () => {
    await refreshApprovalWorkflowSummaries()
    await preloadApprovalWorkflowDetail()
  }

  const applyLocalPlanWorkflowUiPatch = (target: 'submitted' | 'withdrawn') => {
    const nextStatus = target === 'withdrawn' ? 'WITHDRAWN' : 'IN_REVIEW'
    const nextBusinessStatus = target === 'withdrawn' ? 'DRAFT' : 'SUBMITTED'
    const nextCanWithdraw = target === 'submitted'

    currentPlanReportSummary.value = {
      ...(currentPlanReportSummary.value || {}),
      status: nextBusinessStatus,
      workflowStatus: nextStatus,
      canWithdraw: nextCanWithdraw
    }

    if (target === 'submitted') {
      preloadedPlanWorkflowDetail.value = null
      return
    }

    if (preloadedPlanWorkflowDetail.value) {
      preloadedPlanWorkflowDetail.value = {
        ...preloadedPlanWorkflowDetail.value,
        status: nextStatus,
        canWithdraw: nextCanWithdraw
      }
    }
  }

  const confirmPlanApprovalSubmission = async () => {
    if (!ensurePlanCanDistribute()) {
      return
    }

    const planId = Number(currentPlan.value?.id ?? NaN)
    if (!Number.isFinite(planId) || planId <= 0) {
      ElMessage.warning('当前计划不存在，无法发起审批')
      return
    }

    const preview = approvalWorkflowPreview.value
    if (!preview || !Array.isArray(preview.steps) || preview.steps.length === 0) {
      ElMessage.warning('审批流程尚未准备完成')
      return
    }

    approvalSubmitting.value = true
    try {
      await planStore.submitPlanForApproval(planId, {
        workflowCode: preview.workflowCode || PLAN_APPROVAL_SUBMIT_WORKFLOW_CODE,
        comment: approvalSubmitComment.value.trim() || undefined
      })
      applyLocalPlanWorkflowUiPatch('submitted')
      notifyApprovalStateRefresh({ source: 'strategic-task-plan-submit-start' })
      await waitForPlanWorkflowReady()
      await refreshCurrentDepartmentView({ force: true })
      await refreshApprovalCenterLiveView()
      await preloadApprovalWorkflowDetail()
      await loadPendingPlanApprovalCount()
      notifyApprovalStateRefresh({ source: 'strategic-task-plan-submit' })
      handleCloseApprovalSetupDialog()
      ElMessage.success('已发起整体计划审批')
    } catch (error) {
      logger.error('[StrategicTaskView] Failed to submit plan approval:', error)
    } finally {
      approvalSubmitting.value = false
    }
  }

  // 下发/撤回按钮点击处理
  const handleDistributeOrWithdraw = () => {
    if (distributeButtonDisabled.value) {
      if (distributeButtonDisabledReason.value) {
        ElMessage.warning(distributeButtonDisabledReason.value)
      }
      return
    }

    const status = currentPlanStatus.value

    if (status === 'DRAFT' || !status) {
      // 草稿状态：确认流程后发起整体计划审批
      void openApprovalSetupDialog()
    } else {
      // 待审批/已下发状态：撤回
      if (canWithdrawPlan.value) {
        handleWithdrawAll()
      }
    }
  }

  // 表格引用和选中的指标
  const tableRef = ref<InstanceType<typeof ElTable>>()
  const selectedIndicators = ref<StrategicIndicator[]>([])

  // 当前指标（卡片视图用）
  const currentIndicator = computed(() => {
    const list = indicators.value
    return list[currentIndicatorIndex.value] || null
  })

  const indicatorWorkflowCache = ref<Record<string, IndicatorWorkflowSnapshot | null>>({})
  const currentIndicatorWorkflowLoading = ref(false)

  const currentIndicatorWorkflow = computed(() => {
    const indicatorId = currentIndicator.value?.id
    if (indicatorId === undefined || indicatorId === null) {
      return null
    }
    return indicatorWorkflowCache.value[String(indicatorId)] ?? null
  })

  const canCurrentUserHandleCurrentIndicatorWorkflow = computed(() =>
    canCurrentUserHandleIndicatorWorkflow(
      currentIndicatorWorkflow.value,
      currentUserId.value,
      currentUserPermissionCodes.value
    )
  )

  const loadIndicatorWorkflowSnapshot = async (
    indicatorId: number | string,
    options: { force?: boolean } = {}
  ) => {
    const cacheKey = String(indicatorId)
    if (!options.force && cacheKey in indicatorWorkflowCache.value) {
      return indicatorWorkflowCache.value[cacheKey]
    }

    try {
      const response = await indicatorFillApi.getIndicatorFillHistory(indicatorId)
      const fills = Array.isArray(response.data) ? response.data : []
      const baseSnapshot = resolveLatestIndicatorWorkflowSnapshot(fills)
      let snapshot = baseSnapshot

      if (baseSnapshot?.workflowInstanceId) {
        try {
          const workflowResponse = await getWorkflowInstanceDetail(
            String(baseSnapshot.workflowInstanceId)
          )
          if (workflowResponse.success && workflowResponse.data) {
            snapshot = {
              ...baseSnapshot,
              workflowInstanceId:
                workflowResponse.data.instanceId || baseSnapshot.workflowInstanceId,
              currentTaskId: workflowResponse.data.currentTaskId || baseSnapshot.currentTaskId,
              workflowStatus: workflowResponse.data.status || baseSnapshot.workflowStatus,
              currentStepName:
                workflowResponse.data.currentStepName || baseSnapshot.currentStepName,
              currentApproverId:
                workflowResponse.data.currentApproverId ?? baseSnapshot.currentApproverId,
              currentApproverName:
                workflowResponse.data.currentApproverName || baseSnapshot.currentApproverName
            }
          }
        } catch (error) {
          logger.warn('[StrategicTaskView] 按实例刷新指标工作流快照失败:', {
            indicatorId,
            workflowInstanceId: baseSnapshot.workflowInstanceId,
            error
          })
        }
      } else if (baseSnapshot?.reportId) {
        try {
          const workflowResponse = await getWorkflowInstanceDetailByBusiness(
            'PLAN_REPORT',
            baseSnapshot.reportId
          )
          if (workflowResponse.success && workflowResponse.data) {
            snapshot = {
              ...baseSnapshot,
              workflowInstanceId:
                workflowResponse.data.instanceId || baseSnapshot.workflowInstanceId,
              currentTaskId: workflowResponse.data.currentTaskId || baseSnapshot.currentTaskId,
              workflowStatus: workflowResponse.data.status || baseSnapshot.workflowStatus,
              currentStepName:
                workflowResponse.data.currentStepName || baseSnapshot.currentStepName,
              currentApproverId:
                workflowResponse.data.currentApproverId ?? baseSnapshot.currentApproverId,
              currentApproverName:
                workflowResponse.data.currentApproverName || baseSnapshot.currentApproverName
            }
          }
        } catch (error) {
          logger.warn('[StrategicTaskView] 按业务实体刷新指标工作流快照失败:', {
            indicatorId,
            reportId: baseSnapshot.reportId,
            error
          })
        }
      }

      indicatorWorkflowCache.value = {
        ...indicatorWorkflowCache.value,
        [cacheKey]: snapshot
      }
      return snapshot
    } catch (error) {
      logger.warn('[StrategicTaskView] 加载指标工作流快照失败:', { indicatorId, error })
      indicatorWorkflowCache.value = {
        ...indicatorWorkflowCache.value,
        [cacheKey]: null
      }
      return null
    }
  }

  const refreshIndicatorWorkflowContext = async (indicatorId: number | string) => {
    const workflowSnapshot = await loadIndicatorWorkflowSnapshot(indicatorId, { force: true })
    if (workflowSnapshot?.workflowStatus) {
      const optimisticPlanStatus = ['APPROVED', 'COMPLETED'].includes(
        String(workflowSnapshot.workflowStatus).toUpperCase()
      )
        ? 'DISTRIBUTED'
        : ['REJECTED', 'RETURNED', 'WITHDRAWN', 'CANCELLED'].includes(
              String(workflowSnapshot.workflowStatus).toUpperCase()
            )
          ? 'DRAFT'
          : 'PENDING'

      if (currentPlan.value) {
        currentPlan.value = {
          ...currentPlan.value,
          status: optimisticPlanStatus,
          workflowStatus: workflowSnapshot.workflowStatus,
          currentTaskId: workflowSnapshot.currentTaskId ?? currentPlan.value.currentTaskId,
          currentStepName: workflowSnapshot.currentStepName ?? currentPlan.value.currentStepName,
          currentApproverId:
            workflowSnapshot.currentApproverId ?? currentPlan.value.currentApproverId,
          currentApproverName:
            workflowSnapshot.currentApproverName ?? currentPlan.value.currentApproverName,
          canWithdraw:
            optimisticPlanStatus === 'PENDING'
              ? false
              : optimisticPlanStatus === 'DRAFT'
                ? true
                : false
        }
      }
    }

    invalidateQueries([
      'indicator.list',
      'task.list',
      'plan.detail',
      'workflow.todo',
      'workflow.detail',
      'workflow.instances',
      'workflow.statistics',
      'dashboard.overview',
      buildQueryKey('task', 'list', { year: timeContext.currentYear })
    ])
    const planId = currentPlan.value?.id
    await strategicStore.loadIndicatorsByYear(timeContext.currentYear)
    if (planId !== undefined && planId !== null && planId !== '') {
      await planStore.loadPlanDetails(planId, { force: true, background: true })
    }
    await loadPendingPlanApprovalCount()
    await approvalStore.loadPendingApprovals()
  }

  const refreshTaskPageAfterIndicatorMutation = async () => {
    const planId = currentPlan.value?.id
    resetApprovalWorkflowStateCache()
    const invalidateTargets: Array<string | ReturnType<typeof buildQueryKey>> = [
      'indicator.list',
      'task.list',
      'task.scope',
      'plan.detail',
      'workflow.todo',
      'workflow.detail',
      'workflow.instances',
      'workflow.statistics',
      'dashboard.overview',
      buildQueryKey('task', 'list', { year: timeContext.currentYear })
    ]

    if (planId !== undefined && planId !== null && planId !== '') {
      invalidateTargets.push(
        buildQueryKey('task', 'scope', {
          department: selectedDepartment.value,
          planId: String(planId),
          year: timeContext.currentYear
        })
      )
    }

    invalidateQueries(invalidateTargets)

    // 开始全量并发刷新各维度数据
    await Promise.all([
      strategicStore.loadIndicatorsByYear(timeContext.currentYear, { force: true }),
      loadBackendTaskTypeMap(),
      loadCurrentPlanTaskScope({ force: true }),
      loadPendingPlanApprovalCount(),
      refreshCurrentDepartmentView({ force: true })
    ])
  }

  const isLightGlobalRefreshSource = (source?: GlobalDataRefreshDetail['source']): boolean => {
    return source === 'heartbeat' || source === 'window-focus' || source === 'visibility-return'
  }

  const isApprovalDrivenRefreshSource = (source?: GlobalDataRefreshDetail['source']): boolean => {
    return source === 'approval-state-refresh' || source === 'approval-notification'
  }

  const refreshCurrentDepartmentViewLightweight = async (
    detail: GlobalDataRefreshDetail = {}
  ): Promise<void> => {
    const source = detail.source
    const now = Date.now()

    if (isLightGlobalRefreshSource(source)) {
      if (now < lightRefreshBackoffUntil) {
        logger.debug('[StrategicTaskView] skip light refresh during backoff', {
          source,
          waitMs: lightRefreshBackoffUntil - now
        })
        return
      }

      if (now - lastLightRefreshAt < LIGHT_REFRESH_MIN_INTERVAL_MS) {
        logger.debug('[StrategicTaskView] skip duplicated light refresh', {
          source,
          elapsedMs: now - lastLightRefreshAt
        })
        return
      }
    }

    try {
      await Promise.all([
        loadPendingPlanApprovalCount(),
        loadCurrentPlanTaskScope({ force: true }),
        syncCurrentPlanReportSummaries({ force: true })
      ])

      if (isApprovalDrivenRefreshSource(source)) {
        await Promise.allSettled([
          approvalStore.loadPendingApprovals(),
          hydrateCurrentPlanWorkflowState({ force: true })
        ])

        if (
          currentPlanStatus.value === 'PENDING' ||
          currentPlanStatus.value === 'DISTRIBUTED' ||
          hasApprovalWorkflowReportBinding.value
        ) {
          await preloadApprovalWorkflowDetail()
        }
      }

      if (isLightGlobalRefreshSource(source)) {
        lastLightRefreshAt = Date.now()
      }
    } catch (error) {
      const errorCode =
        error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      const errorMessage =
        error instanceof Error
          ? error.message
          : error && typeof error === 'object' && 'message' in error
            ? String(error.message)
            : ''

      if (
        isLightGlobalRefreshSource(source) &&
        (errorCode === 'ECONNABORTED' || errorMessage.toLowerCase().includes('timeout'))
      ) {
        lightRefreshBackoffUntil = Date.now() + LIGHT_REFRESH_BACKOFF_MS
      }

      throw error
    }
  }

  const handleApproveCurrentIndicatorWorkflow = async () => {
    const indicator = currentIndicator.value
    const snapshot = currentIndicatorWorkflow.value
    if (!indicator || !snapshot?.currentTaskId) {
      ElMessage.warning('当前指标没有可审批的工作流任务')
      return
    }
    if (!canCurrentUserHandleCurrentIndicatorWorkflow.value) {
      ElMessage.warning('当前审批节点不是你，或当前账号缺少报告审批权限')
      return
    }

    try {
      const { value } = await ElMessageBox.prompt('请输入审批意见（可选）', '审批通过', {
        confirmButtonText: '确认通过',
        cancelButtonText: '取消',
        inputType: 'textarea'
      })
      const loading = ElLoading.service({ lock: true, text: '正在审批...' })
      try {
        await approveTask(String(snapshot.currentTaskId), {
          comment: value || '审批通过'
        })
        ElMessage.success('审批通过成功')
        await refreshIndicatorWorkflowContext(indicator.id)
      } finally {
        loading.close()
      }
    } catch {
      // user cancelled
    }
  }

  const handleRejectCurrentIndicatorWorkflow = async () => {
    const indicator = currentIndicator.value
    const snapshot = currentIndicatorWorkflow.value
    if (!indicator || !snapshot?.currentTaskId) {
      ElMessage.warning('当前指标没有可审批的工作流任务')
      return
    }
    if (!canCurrentUserHandleCurrentIndicatorWorkflow.value) {
      ElMessage.warning('当前审批节点不是你，或当前账号缺少报告审批权限')
      return
    }

    try {
      const { value } = await ElMessageBox.prompt('请输入驳回原因', '审批驳回', {
        confirmButtonText: '确认驳回',
        cancelButtonText: '取消',
        inputType: 'textarea',
        inputValidator: input => (String(input || '').trim() ? true : '请填写驳回原因')
      })
      const loading = ElLoading.service({ lock: true, text: '正在驳回...' })
      try {
        await rejectTask(String(snapshot.currentTaskId), {
          reason: String(value).trim()
        })
        ElMessage.success('审批驳回成功')
        await refreshIndicatorWorkflowContext(indicator.id)
      } finally {
        loading.close()
      }
    } catch {
      // user cancelled
    }
  }

  // 切换视图模式
  const _toggleViewMode = () => {
    viewMode.value = viewMode.value === 'table' ? 'card' : 'table'
    // 切换到卡片视图时，如果没有指标则重置索引
    if (viewMode.value === 'card' && indicators.value.length === 0) {
      currentIndicatorIndex.value = 0
    }
  }

  // 卡片视图导航
  const goToPrevIndicator = () => {
    if (currentIndicatorIndex.value > 0) {
      currentIndicatorIndex.value--
    }
  }

  const goToNextIndicator = () => {
    if (currentIndicatorIndex.value < indicators.value.length - 1) {
      currentIndicatorIndex.value++
    }
  }

  // 跳转到指定指标
  const _goToIndicator = (index: number) => {
    if (index >= 0 && index < indicators.value.length) {
      currentIndicatorIndex.value = index
    }
  }

  // 从 Store 获取任务列表
  const taskList = computed(() =>
    strategicStore.tasks.map(t => ({
      id: Number(t.id),
      title: t.title,
      desc: t.desc,
      createTime: t.createTime,
      cycle: t.cycle
    }))
  )

  // 当前选中的任务
  const _currentTask = computed(
    () =>
      taskList.value[currentTaskIndex.value] || {
        id: 0,
        title: '暂无任务',
        desc: '',
        createTime: '',
        cycle: ''
      }
  )

  // 从 Store 获取指标列表（带里程碑），按年份和部门过滤，按任务类型和战略任务分组排序
  const indicators = computed(() => {
    // 过滤当前年份的指标
    let list = normalizedIndicators.value.filter(
      i => resolveIndicatorYear(i, timeContext.currentYear) === timeContext.currentYear
    )

    // 左侧部门未确定前不要回退成“显示全部部门”，避免切页返回时短暂展示全量任务。
    if (!selectedDepartment.value) {
      return []
    }

    // 根据选中的部门筛选指标
    list = list.filter(
      i =>
        i.ownerDept === '战略发展部' && // 由战略发展部创建的指标
        i.responsibleDept === selectedDepartment.value && // 下发给选中部门的指标
        i.isStrategic === true && // 只显示战略指标，不显示子指标
        isIndicatorInCurrentPlanScope(i) // 严格限定当前计划任务范围
    )

    const mappedList = list.map(i => ({
      ...i,
      // type2 仅用于展示标签；业务判断统一走 task_type 映射。
      type2: getIndicatorCategoryLabel(i)
    }))

    // 先按任务类型（后端 task_type）排序，再按任务名称排序
    return mappedList.sort((a, b) => {
      const taskTypeA = getIndicatorMappedTaskType(a)
      const taskTypeB = getIndicatorMappedTaskType(b)
      if (taskTypeA !== taskTypeB) {
        // 发展性优先，其次基础性，最后其他类型
        const rank = (taskType: string) => {
          if (isDevelopmentTaskType(taskType)) {
            return 0
          }
          if (isBasicTaskType(taskType)) {
            return 1
          }
          return 2
        }
        return rank(taskTypeA) - rank(taskTypeB)
      }
      const taskA = a.taskContent || ''
      const taskB = b.taskContent || ''
      return taskA.localeCompare(taskB)
    })
  })

  watch(
    () => currentIndicator.value?.id,
    async indicatorId => {
      if (indicatorId === undefined || indicatorId === null) {
        return
      }
      currentIndicatorWorkflowLoading.value = true
      try {
        await loadIndicatorWorkflowSnapshot(indicatorId)
      } finally {
        currentIndicatorWorkflowLoading.value = false
      }
    },
    { immediate: true }
  )

  const taskSpanMetaMap = computed(() => {
    const map = new Map<number, { rowspan: number; colspan: number }>()
    const dataList = indicators.value

    let startIndex = 0
    while (startIndex < dataList.length) {
      const currentTask = dataList[startIndex].taskContent || '未关联任务'
      let endIndex = startIndex + 1

      while (
        endIndex < dataList.length &&
        (dataList[endIndex].taskContent || '未关联任务') === currentTask
      ) {
        endIndex++
      }

      map.set(startIndex, { rowspan: endIndex - startIndex, colspan: 1 })
      for (let index = startIndex + 1; index < endIndex; index++) {
        map.set(index, { rowspan: 0, colspan: 0 })
      }

      startIndex = endIndex
    }

    return map
  })

  const taskGroupRowsMap = computed(() => {
    const map = new Map<string, StrategicIndicator[]>()

    indicators.value.forEach(indicator => {
      const taskContent = indicator.taskContent || '未命名任务'
      const groupRows = map.get(taskContent)
      if (groupRows) {
        groupRows.push(indicator)
        return
      }
      map.set(taskContent, [indicator])
    })

    return map
  })

  // 计算单元格合并信息
  const getSpanMethod = ({
    row: _row,
    column: _column,
    rowIndex,
    columnIndex
  }: {
    row: Record<string, unknown>
    column: unknown
    rowIndex: number
    columnIndex: number
  }) => {
    // 战略任务列（第0列）需要合并
    // 列顺序: 0战略任务, 1核心指标, 2说明, 3权重, 4里程碑, 5进度, 6状态, 7操作
    if (columnIndex === 0) {
      return taskSpanMetaMap.value.get(rowIndex) ?? { rowspan: 1, colspan: 1 }
    }
    return { rowspan: 1, colspan: 1 }
  }

  // 获取当前行所属的任务组
  const getTaskGroup = (row: StrategicIndicator) => {
    const taskContent = row.taskContent || '未命名任务'
    return { taskContent, rows: taskGroupRowsMap.value.get(taskContent) ?? [] }
  }

  // 获取任务级别状态（基于 Plan 的状态）
  // Plan-centric: 状态由 Plan 控制，不是指标自己的 canWithdraw 字段
  const getTaskStatus = (_row: StrategicIndicator) => {
    const planStatus = currentPlanStatus.value

    // 根据 Plan 状态返回对应的显示
    if (planStatus === 'DRAFT' || !planStatus) {
      return { label: '待下发', type: 'info', canWithdraw: true }
    }
    if (planStatus === 'DISTRIBUTED') {
      return { label: '已下发', type: 'success', canWithdraw: false }
    }
    if (planStatus === 'PENDING') {
      return { label: '审批中', type: 'warning', canWithdraw: false }
    }
    // 默认返回待下发
    return { label: '待下发', type: 'info', canWithdraw: true }
  }

  const getPersistedWithdrawableRows = (rows: StrategicIndicator[]): StrategicIndicator[] => {
    return rows.filter(row => {
      const normalizedId = String(row.id ?? '').trim()
      return Boolean(normalizedId) && /^\d+$/.test(normalizedId)
    })
  }

  // 撤回整个任务（撤回同一战略任务下的所有指标）
  const _handleWithdrawTask = async (row: StrategicIndicator) => {
    const group = getTaskGroup(row)
    const distributedRows = getPersistedWithdrawableRows(group.rows)

    if (distributedRows.length === 0) {
      ElMessage.warning('该任务下没有已下发的指标')
      return
    }

    ElMessageBox.confirm(
      `确认撤回任务 "${group.taskContent}" 下的 ${distributedRows.length} 个已下发指标？`,
      '撤回确认',
      {
        confirmButtonText: '确认撤回',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
      .then(async () => {
        // 显示加载状态
        const loading = ElMessage({
          message: '正在撤回指标...',
          type: 'info',
          duration: 0
        })

        try {
          // 等待所有指标撤回完成
          await Promise.all(
            distributedRows.map(r => strategicStore.withdrawIndicator(r.id.toString()))
          )

          await refreshTaskPageAfterIndicatorMutation()
          loading.close()
          ElMessage.success(`已成功撤回 ${distributedRows.length} 个指标`)
          updateEditTime()
        } catch (err) {
          loading.close()
          ElMessage.error('撤回失败，请稍后重试')
          logger.error('Withdraw task failed:', err)
        }
      })
      .catch(() => {
        // 用户取消操作
      })
  }

  // 查看里程碑
  const milestoneDrawerVisible = ref(false)
  const currentMilestoneIndicator = ref<StrategicIndicator | null>(null)

  const _handleViewMilestones = (row: StrategicIndicator) => {
    currentMilestoneIndicator.value = row
    milestoneDrawerVisible.value = true
  }

  // 里程碑编辑弹窗
  const milestoneEditDialogVisible = ref(false)
  const editingMilestoneIndicator = ref<StrategicIndicator | null>(null)
  const editingMilestones = ref<Milestone[]>([])
  const isSavingMilestoneEdit = ref(false)
  const createTempMilestoneId = () => -Date.now() - Math.floor(Math.random() * 1000)

  const sortMilestoneListByProgress = (milestones: Milestone[]): Milestone[] =>
    sortMilestonesByProgress(milestones).map((milestone, index) => {
      milestone.sortOrder = index + 1
      return milestone
    })

  const sortNewRowMilestonesByProgress = () => {
    newRow.value.milestones = sortMilestoneListByProgress(newRow.value.milestones)
  }

  const sortEditingMilestonesByProgress = () => {
    editingMilestones.value = sortMilestoneListByProgress(editingMilestones.value)
  }

  const toEditableMilestoneProgress = (value: number | null | undefined): number => {
    const numericValue = Number(value ?? 0)
    if (!Number.isFinite(numericValue)) {
      return 0
    }
    return Math.min(100, Math.max(0, numericValue))
  }

  const handleNewRowMilestoneProgressChange = (
    milestone: Milestone,
    value: number | null | undefined
  ) => {
    milestone.targetProgress = toEditableMilestoneProgress(value)
    void nextTick(sortNewRowMilestonesByProgress)
  }

  const handleEditingMilestoneProgressChange = (
    milestone: Milestone,
    value: number | null | undefined
  ) => {
    milestone.targetProgress = toEditableMilestoneProgress(value)
    void nextTick(sortEditingMilestonesByProgress)
  }

  // 打开里程碑编辑弹窗
  const handleEditMilestones = (row: StrategicIndicator) => {
    // 只有未下发状态且有编辑权限时才能编辑
    if (!canEditIndicators.value) {
      ElMessage.warning('已下发的指标不可编辑里程碑')
      return
    }

    logger.info(`[StrategicTaskView] Opening milestone editor for indicator:`, {
      id: row.id,
      name: row.name,
      indicator_desc: row.indicator_desc,
      responsibleDept: row.responsibleDept,
      milestonesCount: row.milestones?.length || 0
    })

    editingMilestoneIndicator.value = row
    // 深拷贝里程碑数据
    editingMilestones.value = sortMilestoneListByProgress(
      JSON.parse(JSON.stringify(row.milestones || []))
    )
    milestoneEditDialogVisible.value = true
  }

  // 通过索引编辑里程碑（避免表格合并导致的行数据错位）
  const handleEditMilestonesByIndex = (index: number) => {
    const row = indicators.value[index]
    if (!row) {
      logger.error(`[StrategicTaskView] Cannot find indicator at index ${index}`)
      return
    }
    handleEditMilestones(row)
  }

  // 添加里程碑（编辑弹窗内）
  const addMilestoneInDialog = () => {
    const autoName =
      editingMilestoneIndicator.value?.type1 === '定量' ? editingMilestoneIndicator.value?.name : ''
    editingMilestones.value.push({
      id: createTempMilestoneId(),
      name: autoName,
      targetProgress: 0,
      deadline: '',
      status: 'pending'
    })
    sortEditingMilestonesByProgress()
  }

  // 生成12个月里程碑（编辑弹窗内）
  const generateMonthlyMilestonesInDialog = () => {
    const _currentYear = timeContext.currentYear
    // 获取指标名称并清理空白字符
    const rawName =
      editingMilestoneIndicator.value?.name ||
      editingMilestoneIndicator.value?.indicator_desc ||
      '指标完成'
    const indicatorName = rawName.trim() // 清理首尾空白

    logger.info(
      `[generateMonthlyMilestonesInDialog] Generating milestones for indicator: ${indicatorName}`,
      {
        indicator: editingMilestoneIndicator.value,
        name: editingMilestoneIndicator.value?.name,
        indicator_desc: editingMilestoneIndicator.value?.indicator_desc,
        rawNameLength: rawName.length,
        trimmedNameLength: indicatorName.length
      }
    )
    editingMilestones.value = []

    for (let month = 1; month <= 12; month++) {
      const lastDay = new Date(_currentYear, month, 0).getDate()
      const deadline = `${_currentYear}-${String(month).padStart(2, '0')}-${lastDay}`
      const progress = Math.round((month / 12) * 100)

      editingMilestones.value.push({
        id: -month, // 使用负数作为临时 ID，避免 Vue key 重复，后端会识别为新里程碑
        name: `${indicatorName} - ${month}月`,
        targetProgress: progress,
        deadline: deadline,
        status: 'NOT_STARTED' // 使用后端枚举值
      })
    }
    sortEditingMilestonesByProgress()
    logger.info(
      `[generateMonthlyMilestonesInDialog] Generated ${editingMilestones.value.length} milestones`
    )
  }

  // 删除里程碑（编辑弹窗内）
  const removeMilestoneInDialog = (index: number) => {
    editingMilestones.value.splice(index, 1)
  }

  const handleMilestoneDeadlineChange = () => {
    sortEditingMilestonesByProgress()
  }

  // 保存里程碑编辑
  const saveMilestoneEdit = async () => {
    if (!editingMilestoneIndicator.value || isSavingMilestoneEdit.value) {
      return
    }

    // 验证里程碑数据
    for (const ms of editingMilestones.value) {
      if (!ms.name || !ms.name.trim()) {
        ElMessage.warning('请填写里程碑名称')
        return
      }
      if (!ms.deadline) {
        ElMessage.warning('请设置里程碑截止日期')
        return
      }
      if (ms.targetProgress < 0 || ms.targetProgress > 100) {
        ElMessage.warning('目标进度必须在0-100之间')
        return
      }
    }

    isSavingMilestoneEdit.value = true

    try {
      // 从当前指标列表中查找最新的指标对象（使用 id 匹配）
      const currentIndicator = indicators.value.find(
        i => i.id === editingMilestoneIndicator.value?.id
      )

      if (!currentIndicator) {
        ElMessage.error('找不到对应的指标，请刷新页面后重试')
        return
      }

      const indicatorId = currentIndicator.id.toString()
      const deptKey = selectedDepartment.value || ''
      const sortedMilestones = sortMilestoneListByProgress(editingMilestones.value)
      editingMilestones.value = sortedMilestones

      logger.info(
        `[StrategicTaskView] Saving ${sortedMilestones.length} milestones for indicator ${indicatorId}`
      )

      await milestoneApi.saveMilestonesForIndicator(
        indicatorId,
        sortedMilestones.map((milestone, index) => {
          const milestoneId = Number(milestone.id)
          return {
            id: Number.isFinite(milestoneId) && milestoneId > 0 ? milestoneId : undefined,
            milestoneName: String(milestone.name || '').trim(),
            description: '',
            dueDate: toMilestoneDueDate(milestone.deadline),
            targetProgress: Number(milestone.targetProgress || 0),
            status: toMilestoneRequestStatus(milestone.status),
            sortOrder: index + 1,
            isPaired: Boolean((milestone as { isPaired?: boolean }).isPaired ?? false),
            inheritedFrom: null as number | null
          }
        })
      )

      const refreshedMilestones = await reloadMilestonesForIndicator(indicatorId, deptKey)
      logger.info(
        `[StrategicTaskView] Milestones synced for indicator ${indicatorId}, count=${refreshedMilestones.length}`
      )

      ElMessage.success('里程碑已更新')
      milestoneEditDialogVisible.value = false
      editingMilestoneIndicator.value = null
      editingMilestones.value = []
      updateEditTime()
    } catch (error) {
      logger.error('Failed to save milestones:', error)
      ElMessage.error('里程碑更新失败')
    } finally {
      isSavingMilestoneEdit.value = false
    }
  }

  // 取消里程碑编辑
  const cancelMilestoneEdit = () => {
    if (isSavingMilestoneEdit.value) {
      return
    }
    milestoneEditDialogVisible.value = false
    editingMilestoneIndicator.value = null
    editingMilestones.value = []
  }

  // 格式化更新时间
  const _formatUpdateTime = (time: string | Date | undefined) => {
    if (!time) {
      return '-'
    }
    const date = new Date(time)
    return `${date.getMonth() + 1}/${date.getDate()}`
  }

  const formatDetailDate = (time: string | Date | undefined) => {
    if (!time) {
      return '-'
    }

    const date = new Date(time)
    if (Number.isNaN(date.getTime())) {
      return String(time).slice(0, 10) || '-'
    }

    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  // 获取进度数字的样式类
  const _getProgressClass = (progress: number) => {
    if (progress >= 80) {
      return 'progress-success'
    }
    if (progress >= 50) {
      return 'progress-warning'
    }
    return 'progress-danger'
  }

  // 按类别筛选指标（基于后端 task_type）
  const developmentIndicators = computed(() =>
    indicators.value.filter(i => isDevelopmentTaskType(getIndicatorMappedTaskType(i)))
  )
  const basicIndicators = computed(() =>
    indicators.value.filter(i => isBasicTaskType(getIndicatorMappedTaskType(i)))
  )

  const groupIndicatorsByTask = (list: StrategicIndicator[]) => {
    const groups: Array<{ taskContent: string; rows: StrategicIndicator[] }> = []
    const indexMap: Record<string, number> = {}

    list.forEach(item => {
      const key = item.taskContent || '未命名任务'
      if (indexMap[key] === undefined) {
        groups.push({ taskContent: key, rows: [item] })
        indexMap[key] = groups.length - 1
      } else {
        groups[indexMap[key]].rows.push(item)
      }
    })

    return groups
  }

  const _groupedDevelopmentIndicators = computed(() =>
    groupIndicatorsByTask(developmentIndicators.value)
  )
  const _groupedBasicIndicators = computed(() => groupIndicatorsByTask(basicIndicators.value))

  // 获取已有的任务名称列表（从当前部门的指标中提取）
  const existingTaskNames = computed(() => {
    // 从当前显示的指标中提取已使用的 taskContent（战略任务名称）
    const taskNames = indicators.value
      .filter(i => i.taskContent && i.taskContent !== '未命名任务')
      .map(i => i.taskContent)

    // 去重
    return [...new Set(taskNames)]
  })

  // 获取任务名称对应的任务类型映射
  const taskTypeMap = computed(() => {
    const map: Record<string, '发展性' | '基础性'> = {}
    indicators.value.forEach(i => {
      if (i.taskContent && i.taskContent !== '未命名任务') {
        const category = getTaskCategoryLabel(getIndicatorMappedTaskType(i))
        if (category === '发展性' || category === '基础性') {
          map[i.taskContent] = category
        }
      }
    })
    return map
  })

  const preservePrefilledTaskBindingOnce = ref(false)

  // 选择战略任务时自动更新任务类型
  const handleTaskSelect = (taskName: string) => {
    if (preservePrefilledTaskBindingOnce.value && String(newRow.value.taskId || '').trim()) {
      preservePrefilledTaskBindingOnce.value = false
      return
    }

    newRow.value.taskId = ''

    if (taskTypeMap.value[taskName]) {
      newRow.value.type2 = taskTypeMap.value[taskName]
    }

    void (async () => {
      const plan = currentPlan.value as Record<string, unknown> | null
      const planId = Number(plan?.id ?? plan?.taskId ?? NaN)
      if (!Number.isFinite(planId) || planId <= 0) {
        return
      }

      const existingTaskId = await findExistingTaskIdByName(planId, taskName)
      if (existingTaskId) {
        newRow.value.taskId = String(existingTaskId)
      }
    })()
  }

  // 战略任务选择器ref
  const taskSelectRef = ref<{
    $el?: { querySelector: (selector: string) => HTMLInputElement }
  } | null>(null)

  // 处理战略任务下拉框关闭 - 保存输入的值
  const handleTaskVisibleChange = (visible: boolean) => {
    if (!visible && taskSelectRef.value) {
      // 下拉框关闭时，如果有输入内容但未选择，则保存输入的值
      const inputEl = taskSelectRef.value.$el?.querySelector('input')
      const inputValue = inputEl?.value || ''
      if (inputValue.trim() && !newRow.value.taskContent) {
        newRow.value.taskContent = inputValue.trim()
        newRow.value.taskId = ''
      }
    }
  }

  // 新增行数据
  const newRow = ref({
    taskId: '',
    taskContent: '',
    name: '',
    type1: '定量' as '定性' | '定量',
    type2: '基础性' as '发展性' | '基础性',
    weight: 0,
    remark: '',
    milestones: [] as Milestone[]
  })

  // 任务下发相关状态
  const showAssignmentDialog = ref(false)
  const assignmentTarget = ref('')
  const assignmentMethod = ref<'self' | 'college'>('self')

  // 添加新里程碑（单个）
  const addMilestone = () => {
    // 定量指标时，里程碑名称自动填充为核心指标内容
    const autoName = newRow.value.type1 === '定量' ? newRow.value.name : ''
    newRow.value.milestones.push({
      id: Date.now(),
      name: autoName,
      targetProgress: 0,
      deadline: '',
      status: 'pending'
    })
    sortNewRowMilestonesByProgress()
  }

  // 生成12个月里程碑（定量指标默认）
  const generateMonthlyMilestones = () => {
    const _currentYear = timeContext.currentYear
    const indicatorName = newRow.value.name || '指标完成'
    newRow.value.milestones = []

    for (let month = 1; month <= 12; month++) {
      const lastDay = new Date(_currentYear, month, 0).getDate()
      const deadline = `${_currentYear}-${String(month).padStart(2, '0')}-${lastDay}`
      const progress = Math.round((month / 12) * 100)

      newRow.value.milestones.push({
        id: 0, // 使用 0 表示新里程碑，后端会创建新记录
        name: `${indicatorName} - ${month}月`,
        targetProgress: progress,
        deadline: deadline,
        status: 'pending'
      })
    }
    sortNewRowMilestonesByProgress()
  }

  // 删除里程碑
  const removeMilestone = (index: number) => {
    newRow.value.milestones.splice(index, 1)
  }

  // 当前日期
  const _currentDate = '2025年12月5日'

  // 编辑状态管理（任务详情）
  const editingField = ref<string | null>(null)
  const editingValue = ref('')

  // 指标列表编辑状态
  const editingIndicatorId = ref<number | null>(null)
  const editingIndicatorField = ref<string | null>(null)
  const editingIndicatorValue = ref<Record<string, unknown> | null>(null)
  const isSavingIndicatorEdit = ref(false)
  const savingIndicatorId = ref<number | null>(null)
  const savingIndicatorField = ref<string | null>(null)

  // 任务详情双击编辑处理
  const _handleDoubleClick = (field: 'title' | 'desc' | 'cycle' | 'createTime', value: string) => {
    if (!canEdit.value) {
      return
    }
    editingField.value = field
    editingValue.value = value
  }

  // 任务详情保存编辑
  const _saveEdit = (field: 'title' | 'desc' | 'cycle' | 'createTime') => {
    // 如果值没有变化或者被清空（根据需求，这里假设如果不填则取消编辑或保留原值，这里逻辑是如果不填则取消）
    if (editingValue.value === undefined || editingValue.value === null) {
      cancelEdit()
      return
    }

    const task = taskList.value[currentTaskIndex.value]
    if (field === 'title') {
      task.title = editingValue.value
    } else if (field === 'desc') {
      task.desc = editingValue.value
    } else if (field === 'cycle') {
      task.cycle = editingValue.value
    } else if (field === 'createTime') {
      task.createTime = editingValue.value
    }

    cancelEdit()
  }

  // 任务详情取消编辑
  const cancelEdit = () => {
    editingField.value = null
    editingValue.value = ''
  }

  // 指标双击编辑
  const handleIndicatorDblClick = (row: StrategicIndicator, field: string) => {
    if (!canEdit.value) {
      return
    }
    // 已下发状态下不允许编辑
    if (hasDistributedIndicators.value) {
      return
    }
    if (savingIndicatorId.value === row.id) {
      return
    }
    editingIndicatorId.value = row.id
    editingIndicatorField.value = field
    editingIndicatorValue.value = row[field as keyof StrategicIndicator]
  }

  const isSavingIndicatorCell = (row: StrategicIndicator, field: string) =>
    savingIndicatorId.value === row.id && savingIndicatorField.value === field

  // 保存指标编辑
  const saveIndicatorEdit = async (row: StrategicIndicator, field: string) => {
    if (isSavingIndicatorEdit.value) {
      return
    }

    // 如果已经在取消过程中或值无效，直接退出
    if (editingIndicatorId.value === null) {
      return
    }

    if (editingIndicatorValue.value === null || editingIndicatorValue.value === undefined) {
      cancelIndicatorEdit()
      return
    }

    // 前端字段名到后端字段名的映射
    const fieldMapping: Record<string, string> = {
      name: 'indicatorDesc',
      weight: 'weightPercent',
      progress: 'progress',
      remark: 'remark',
      sortOrder: 'sortOrder'
    }

    try {
      isSavingIndicatorEdit.value = true
      savingIndicatorId.value = row.id
      savingIndicatorField.value = field
      // 使用 Store 更新指标
      const updates: Record<string, unknown> = {}
      const mappedField = fieldMapping[field] || field

      console.log(
        '[saveIndicatorEdit] row.id:',
        row.id,
        'field:',
        field,
        'mappedField:',
        mappedField,
        'value:',
        editingIndicatorValue.value
      )

      if (field === 'taskContent') {
        const normalizedTaskName = normalizeEditableText(editingIndicatorValue.value)
        if (!normalizedTaskName) {
          cancelIndicatorEdit()
          ElMessage.warning('战略任务名称不能为空')
          return
        }
        if (normalizedTaskName === normalizeEditableText(row.taskContent)) {
          cancelIndicatorEdit()
          return
        }
        cancelIndicatorEdit()
        await persistTaskContentEdit(row, normalizedTaskName)
        updateEditTime()
        return
      }

      if (field === 'weight' || field === 'progress') {
        // 权重和进度字段强制转换为数字
        updates[mappedField] = Number(editingIndicatorValue.value)
      } else if (field === 'type1' || field === 'type2') {
        updates[field] = editingIndicatorValue.value
        // 更新 isQualitative 状态如果修改的是 type1
        if (field === 'type1') {
          updates.isQualitative = editingIndicatorValue.value === '定性'
        }
      } else {
        updates[mappedField] = editingIndicatorValue.value
      }

      // 如果编辑的是核心指标名称，且当前没有指标类型，则设置默认类型为"定性"
      if (field === 'name' && !row.type1) {
        updates.type1 = '定性'
        updates.isQualitative = true
      }

      console.log('[saveIndicatorEdit] updates:', updates)
      cancelIndicatorEdit()
      await strategicStore.updateIndicator(row.id.toString(), updates)
      updateEditTime()
    } catch (error) {
      console.error('[saveIndicatorEdit] Error details:', error)
      logger.error('[StrategicTaskView] Failed to save indicator:', error)
      const message =
        error instanceof Error && error.message ? error.message : '保存失败，请稍后重试'
      ElMessage.error(message)
    } finally {
      isSavingIndicatorEdit.value = false
      savingIndicatorId.value = null
      savingIndicatorField.value = null
    }
  }

  // 取消指标编辑
  const cancelIndicatorEdit = () => {
    editingIndicatorId.value = null
    editingIndicatorField.value = null
    editingIndicatorValue.value = null
  }

  // 全局点击事件处理 - 点击编辑区域外退出编辑
  const handleGlobalClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement

    if (isAddingOrEditing.value) {
      const clickedInsideAddForm = !!addRowFormRef.value && addRowFormRef.value.contains(target)
      const clickedInsidePopup =
        !!target.closest('.el-popper') ||
        !!target.closest('.el-select-dropdown') ||
        !!target.closest('.el-picker__popper')

      if (!clickedInsideAddForm && !clickedInsidePopup) {
        cancelAdd()
        return
      }
    }

    // 如果没有正在编辑的字段，直接返回
    if (
      editingIndicatorId.value === null ||
      editingIndicatorField.value === null ||
      isSavingIndicatorEdit.value
    ) {
      return
    }

    // 检查点击是否在 el-select 或其下拉菜单内
    const isInSelect = target.closest('.el-select') || target.closest('.el-select-dropdown')
    // 检查点击是否在 el-input 内
    const isInInput = target.closest('.el-input') || target.closest('.el-textarea')

    const blurManagedFields = new Set(['taskContent', 'name', 'remark', 'weight', 'progress'])

    // 这些字段已经在组件自身的 blur 事件里保存，避免点击捕获阶段再触发一次。
    if (blurManagedFields.has(editingIndicatorField.value)) {
      return
    }

    // 仅对非 blur 驱动的编辑控件兜底
    if (!isInSelect && !isInInput) {
      const currentRow = indicators.value.find(
        item => String(item.id) === String(editingIndicatorId.value)
      )
      const currentField = editingIndicatorField.value

      if (currentRow && currentField) {
        void saveIndicatorEdit(currentRow, currentField)
        return
      }

      cancelIndicatorEdit()
    }
  }

  // 挂载和卸载全局点击监听
  onMounted(async () => {
    await Promise.all([
      (async () => {
        if (orgStore.departments.length === 0) {
          try {
            await orgStore.loadDepartments()
          } catch (error) {
            logger.error('[StrategicTaskView] 初始加载部门失败:', error)
          }
        }
      })(),
      (async () => {
        try {
          await planStore.loadPlans({ force: true, background: true })
        } catch (error) {
          logger.error('[StrategicTaskView] 初始加载 Plan 失败:', error)
        }
      })(),
      loadBackendTaskTypeMap({ force: true })
    ])

    ensureInitialSelectedDepartment(functionalDepartments.value)
    await refreshCurrentDepartmentView({ force: true })
    isBootstrappingPage.value = false

    void loadMilestonesForCurrentScope()

    document.addEventListener('click', handleGlobalClick, true)
    if (typeof window !== 'undefined') {
      window.addEventListener(
        GLOBAL_DATA_REFRESH_REQUEST_EVENT,
        handleGlobalDataRefreshRequest as EventListener
      )
    }
  })

  onUnmounted(() => {
    document.removeEventListener('click', handleGlobalClick, true)
    if (typeof window !== 'undefined') {
      window.removeEventListener(
        GLOBAL_DATA_REFRESH_REQUEST_EVENT,
        handleGlobalDataRefreshRequest as EventListener
      )
    }
    if (departmentSwitchingTimer) {
      clearTimeout(departmentSwitchingTimer)
      departmentSwitchingTimer = null
    }
  })

  const handleGlobalDataRefreshRequest = (event: Event) => {
    if (isBootstrappingPage.value || globalDataRefreshPromise) {
      return
    }

    const detail = (event as CustomEvent<GlobalDataRefreshDetail>).detail
    globalDataRefreshPromise = (async () => {
      logger.info('[StrategicTaskView] handling global data refresh request', detail)
      if (
        isLightGlobalRefreshSource(detail?.source) ||
        isApprovalDrivenRefreshSource(detail?.source)
      ) {
        await refreshCurrentDepartmentViewLightweight(detail)
        return
      }

      await refreshTaskPageAfterIndicatorMutation()
    })()
      .catch(error => {
        logger.warn('[StrategicTaskView] global data refresh failed', {
          detail,
          error
        })
      })
      .finally(() => {
        globalDataRefreshPromise = null
      })
  }

  watch(
    () => timeContext.currentYear,
    async () => {
      if (isBootstrappingPage.value) {
        return
      }
      resetApprovalWorkflowStateCache()
      await loadBackendTaskTypeMap({ force: true })
      await refreshCurrentDepartmentView({ showLoading: true, force: true, reloadIndicators: true })
    }
  )

  watch([selectedDepartment, () => planStore.plans.length], async () => {
    if (isBootstrappingPage.value) {
      return
    }
    resetApprovalWorkflowStateCache()
    await refreshCurrentDepartmentView({
      showLoading: false,
      force: false,
      reloadIndicators: false
    })
  })

  watch(
    [() => currentPlan.value?.id, currentPlanStatus],
    async ([planId, status], [prevPlanId, prevStatus]) => {
      if (isBootstrappingPage.value) {
        return
      }

      if (planId === prevPlanId && status === prevStatus) {
        return
      }

      preloadedPlanWorkflowDetail.value = null
      await hydrateCurrentPlanWorkflowState()
    }
  )

  // 方法
  const resetNewRow = (
    overrides: Partial<{
      taskId: string
      taskContent: string
      type1: '定性' | '定量'
      type2: '发展性' | '基础性'
    }> = {}
  ) => {
    preservePrefilledTaskBindingOnce.value = false
    newRow.value = {
      taskId: overrides.taskId ?? '',
      taskContent: overrides.taskContent ?? '',
      name: '',
      type1: overrides.type1 ?? '定量',
      type2: overrides.type2 ?? '基础性',
      weight: 0,
      remark: '',
      milestones: []
    }
  }

  const openNewRowDialog = (
    overrides: Partial<{
      taskId: string
      taskContent: string
      type1: '定性' | '定量'
      type2: '发展性' | '基础性'
    }> = {}
  ) => {
    resetNewRow(overrides)
    if (overrides.taskId !== undefined) {
      newRow.value.taskId = overrides.taskId
    }
    isAddingOrEditing.value = true

    if (newRow.value.type1 === '定量') {
      generateMonthlyMilestones()
    }
  }

  const addNewRow = () => {
    openNewRowDialog()
  }

  // 在指定类别中添加新指标
  const _addIndicatorToCategory = (category: '发展性' | '基础性') => {
    logger.info(`[StrategicTaskView] addIndicatorToCategory called with category: ${category}`)
    openNewRowDialog({ type2: category })
  }

  // 为指定任务新增指标（点击单元格右下角加号）
  const handleAddIndicatorToTask = (row: StrategicIndicator) => {
    preservePrefilledTaskBindingOnce.value = true
    openNewRowDialog({
      taskId: getIndicatorTaskId(row),
      taskContent: row.taskContent || '',
      type2: row.type2 === '基础性' ? '基础性' : '发展性'
    })
  }

  const cancelAdd = () => {
    isAddingOrEditing.value = false
    resetNewRow()
    updateEditTime()
  }

  const getCurrentActorUserId = () => {
    const userRecord = authStore.user as { id?: string | number; userId?: string | number } | null
    const candidateId = Number(userRecord?.userId ?? userRecord?.id ?? NaN)
    return Number.isFinite(candidateId) && candidateId > 0 ? candidateId : null
  }

  const persistNewIndicatorMilestones = async (indicatorId: number, milestones: Milestone[]) => {
    if (!Number.isFinite(indicatorId) || indicatorId <= 0 || milestones.length === 0) {
      return
    }

    const orderedMilestones = sortMilestoneListByProgress(milestones)

    await milestoneApi.saveMilestonesForIndicator(
      String(indicatorId),
      orderedMilestones.map((milestone, index) => ({
        milestoneName: String(milestone.name || '').trim() || `里程碑 ${index + 1}`,
        targetProgress: Number(milestone.targetProgress) || 0,
        dueDate: milestone.deadline || null,
        status: milestone.status === 'completed' ? 'COMPLETED' : 'NOT_STARTED',
        sortOrder: index + 1
      }))
    )

    await reloadMilestonesForIndicator(
      String(indicatorId),
      selectedDepartment.value || '战略发展部'
    )
  }

  // 保存新行
  const saveNewRow = async () => {
    if (!String(newRow.value.taskContent || '').trim()) {
      ElMessage.warning('请填写战略任务')
      return
    }

    if (!String(newRow.value.name || '').trim()) {
      ElMessage.warning('请填写核心指标内容')
      return
    }

    const weight = Number(newRow.value.weight)
    if (!Number.isFinite(weight) || weight <= 0) {
      ElMessage.warning('请填写大于 0 的权重')
      return
    }

    // 显示加载状态
    const loading = ElLoading.service({
      lock: true,
      text: '正在保存指标...',
      background: 'rgba(0, 0, 0, 0.7)'
    })

    try {
      const persistedTaskId = await ensurePersistedTaskIdForIndicator({
        taskId: newRow.value.taskId || null,
        taskContent: newRow.value.taskContent,
        type2: newRow.value.type2,
        remark: newRow.value.remark,
        responsibleDept: selectedDepartment.value || '战略发展部',
        ownerDept: '战略发展部'
      })

      // 添加日志记录 taskContent
      logger.info(
        `[StrategicTaskView] Saving indicator with taskContent: "${newRow.value.taskContent}"`
      )

      const orderedMilestones = sortMilestoneListByProgress(newRow.value.milestones)
      newRow.value.milestones = orderedMilestones

      // 调用 Store 添加指标（现在是异步的，会调用后端 API）
      const createdIndicatorResponse = await strategicStore.addIndicator({
        id: Date.now().toString(),
        taskId: persistedTaskId,
        taskContent: String(newRow.value.taskContent || '').trim(),
        name: String(newRow.value.name || '').trim(),
        isQualitative: newRow.value.type1 === '定性',
        type1: newRow.value.type1,
        type2: newRow.value.type2,
        progress: 0,
        createTime: new Date().toLocaleDateString('zh-CN'),
        weight,
        remark: newRow.value.remark || '无备注',
        canWithdraw: true,
        milestones: [...orderedMilestones],
        targetValue: 100,
        unit: '%',
        responsibleDept: selectedDepartment.value || '战略发展部', // 责任部门是选中的部门
        ownerDept: '战略发展部', // 创建者始终是战略发展部
        responsiblePerson: authStore.userName || '未分配',
        status: 'active',
        isStrategic: true,
        year: timeContext.currentYear,
        statusAudit: []
      })

      const createdIndicatorId = Number(
        createdIndicatorResponse?.data?.indicatorId ?? createdIndicatorResponse?.data?.id ?? NaN
      )
      if (Number.isFinite(createdIndicatorId) && orderedMilestones.length > 0) {
        await persistNewIndicatorMilestones(createdIndicatorId, orderedMilestones)
      }

      // 统一走“变更后刷新”链路，避免新增后被旧缓存覆盖，导致主页仍显示上一版状态。
      logger.info('[StrategicTaskView] Refreshing task page after successful indicator creation...')
      await refreshTaskPageAfterIndicatorMutation()
      logger.info('[StrategicTaskView] Task page refreshed successfully after indicator creation')

      // 成功：关闭表单并更新 UI
      cancelAdd()
      updateEditTime()
    } catch (error) {
      // 错误已在 Store 中处理并显示消息
      logger.error('[StrategicTaskView] Failed to save indicator:', error)
    } finally {
      loading.close()
    }
  }

  // 删除指标
  const _deleteIndicator = (indicator: StrategicIndicator) => {
    const indicatorId = indicator?.id
    if (indicatorId === null || indicatorId === undefined || indicatorId === '') {
      ElMessage.warning('当前行不是可删除的指标数据')
      return
    }

    ElMessageBox.confirm(`确定要删除指标 "${indicator.name}" 吗？删除后无法恢复。`, '删除确认', {
      confirmButtonText: '确定删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
      .then(async () => {
        const loading = ElLoading.service({
          lock: true,
          text: '正在删除指标并刷新数据...',
          background: 'rgba(0, 0, 0, 0.5)'
        })

        try {
          await strategicStore.deleteIndicator(indicatorId.toString())
          await refreshTaskPageAfterIndicatorMutation()
          ElMessage.success('指标已删除')
          updateEditTime()
        } catch (error) {
          logger.error('[StrategicTaskView] 删除指标失败:', error)
          ElMessage.error('删除失败，请稍后重试')
        } finally {
          loading.close()
        }
      })
      .catch(() => {
        // 用户取消操作
      })
  }

  // 最后编辑时间
  const lastEditTime = ref(new Date().toLocaleString())

  // 更新最后编辑时间的函数
  const updateEditTime = () => {
    lastEditTime.value = new Date().toLocaleString()
  }

  // 里程碑状态计算
  const _calculateMilestoneStatus = (
    indicator: StrategicIndicator
  ): 'success' | 'warning' | 'exception' => {
    if (!indicator.milestones || indicator.milestones.length === 0) {
      return getProgressStatus(indicator.progress)
    }

    const _currentDate = new Date()
    const _currentYear = _currentDate.getFullYear()

    // 检查是否有逾期未完成的里程碑
    const hasOverdueMilestone = indicator.milestones.some(milestone => {
      const deadlineDate = new Date(milestone.deadline)
      return milestone.status === 'pending' && deadlineDate < _currentDate
    })

    // 检查是否有即将到期的里程碑（30天内）
    const hasUpcomingMilestone = indicator.milestones.some(milestone => {
      if (milestone.status === 'completed') {
        return false
      }
      const deadlineDate = new Date(milestone.deadline)
      const daysUntilDeadline = Math.ceil(
        (deadlineDate.getTime() - _currentDate.getTime()) / (1000 * 60 * 60 * 24)
      )
      return daysUntilDeadline > 0 && daysUntilDeadline <= 30
    })

    // 判断状态逻辑
    if (hasOverdueMilestone) {
      return 'exception' // 红色：逾期未完成
    } else if (hasUpcomingMilestone) {
      return 'warning' // 黄色：即将到期
    } else {
      return 'success' // 绿色：按计划进行
    }
  }

  // 获取里程碑进度文本
  const _getMilestoneProgressText = (indicator: StrategicIndicator): string => {
    if (!indicator.milestones || indicator.milestones.length === 0) {
      return `当前进度: ${indicator.progress}%`
    }

    const _totalMilestones = indicator.milestones.length
    const _completedMilestones = indicator.milestones.filter(m => m.status === 'completed').length
    const _overdueMilestones = indicator.milestones.filter(m => m.status === 'overdue').length
    const pendingMilestones = indicator.milestones.filter(m => m.status === 'pending').length

    const _currentDate = new Date()
    const overdueMilestonesCount = indicator.milestones.filter(m => {
      if (m.status !== 'pending') {
        return false
      }
      const deadlineDate = new Date(m.deadline)
      return deadlineDate < _currentDate
    }).length

    if (overdueMilestonesCount > 0) {
      return `逾期: ${overdueMilestonesCount} 个里程碑`
    } else if (pendingMilestones > 0) {
      return `待完成: ${pendingMilestones} 个里程碑`
    } else {
      return '所有里程碑已完成'
    }
  }

  // 获取里程碑列表用于tooltip显示
  interface MilestoneTooltipItem {
    id: string | number
    name: string
    expectedDate: string
    progress: number
  }

  const getMilestonesTooltip = (indicator: StrategicIndicator): MilestoneTooltipItem[] => {
    return sortMilestonesByProgress(indicator.milestones || []).map(m => ({
      id: m.id || '',
      name: m.name,
      expectedDate: m.deadline || '',
      progress: m.targetProgress || 0
    }))
  }

  const getSortedMilestones = (milestones?: StrategicIndicator['milestones']) =>
    sortMilestonesByProgress(milestones || [])

  const selectDepartment = (dept: string) => {
    if (selectedDepartment.value === dept) {
      return
    }

    isDepartmentSwitching.value = true
    if (departmentSwitchingTimer) {
      clearTimeout(departmentSwitchingTimer)
    }
    departmentSwitchingTimer = setTimeout(() => {
      isDepartmentSwitching.value = false
      departmentSwitchingTimer = null
    }, 280)

    selectedDepartment.value = dept
    persistSelectedDepartment(dept)
  }

  const _selectTask = (index: number) => {
    currentTaskIndex.value = index
  }

  // 表格选择变化处理
  const handleSelectionChange = (selection: StrategicIndicator[]) => {
    selectedIndicators.value = selection
  }

  // 任务下发相关方法
  const handleCancelAssignment = () => {
    showAssignmentDialog.value = false
    assignmentTarget.value = ''
    assignmentMethod.value = 'self'
  }

  const confirmAssignment = () => {
    if (!assignmentTarget.value) {
      ElMessage.warning('请选择下发目标')
      return
    }

    const indicatorNames = selectedIndicators.value.map(ind => ind.name).join('、')
    const targetName =
      assignmentMethod.value === 'self' ? '自己完成' : `下发给${assignmentTarget.value}`

    ElMessageBox.confirm(`确认将以下指标${targetName}？\n\n${indicatorNames}`, '确认下发', {
      confirmButtonText: '确定下发',
      cancelButtonText: '取消',
      type: 'info'
    })
      .then(() => {
        // 这里应该调用API进行任务下发
        ElMessage.success(
          `成功下发${selectedIndicators.value.length}项指标到${assignmentTarget.value}`
        )
        showAssignmentDialog.value = false
        assignmentTarget.value = ''
        assignmentMethod.value = 'self'
      })
      .catch(() => {
        // 用户取消操作
      })
  }

  // ================== 详情抽屉 & 单个下发/撤回 ==================

  // 详情抽屉状态
  const detailDrawerVisible = ref(false)
  const currentDetail = ref<StrategicIndicator | null>(null)

  // 专门用于审批抽屉的指标列表（显示当前选中部门的所有指标，一个部门的所有指标状态应该统一）
  const approvalIndicators = computed(() => {
    if (!selectedDepartment.value) {
      return []
    }
    return normalizedIndicators.value
      .filter(i => resolveIndicatorYear(i, timeContext.currentYear) === timeContext.currentYear)
      .filter(i => i.responsibleDept === selectedDepartment.value) // 只显示当前选中部门的指标
      .filter(i => i.isStrategic === true) // 只显示战略指标（一级指标）
  })

  // 判断当前选中部门是否有待审批的指标（用于按钮显示和状态判断）
  const _hasPendingApprovalForDept = computed(() => {
    if (!selectedDepartment.value) {
      return false
    }
    return approvalIndicators.value.some(i => i.progressApprovalStatus === 'PENDING')
  })

  function resetApprovalWorkflowStateCache(): void {
    preloadedPlanWorkflowDetail.value = null
    currentPlanReportSummary.value = null
    latestPlanReportSummary.value = null
    currentPlanReportSummaryPromise = null
    currentPlanReportSummaryKey = ''
  }

  async function refreshApprovalWorkflowSummaries(): Promise<void> {
    await syncCurrentPlanReportSummaries({ force: true })
  }

  function normalizeWorkflowRuntimeStatus(value: unknown): string {
    return String(value || '')
      .trim()
      .toUpperCase()
  }

  function isActiveApprovalWorkflowDetail(
    detail: WorkflowInstanceDetailResponse | null | undefined
  ): boolean {
    const status = normalizeWorkflowRuntimeStatus(detail?.status)
    if (['PENDING', 'IN_REVIEW', 'SUBMITTED'].includes(status)) {
      return true
    }

    if (
      ['WITHDRAWN', 'CANCELLED', 'REJECTED', 'RETURNED', 'APPROVED', 'DISTRIBUTED'].includes(status)
    ) {
      return false
    }

    return false
  }

  async function waitForPlanWorkflowReady(
    options: { maxAttempts?: number; delayMs?: number } = {}
  ): Promise<void> {
    const maxAttempts = options.maxAttempts ?? 16
    const delayMs = options.delayMs ?? 500

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await preloadApprovalWorkflowDetail()

      const detail = preloadedPlanWorkflowDetail.value
      const isActiveDetail = isActiveApprovalWorkflowDetail(detail)
      const hasPendingTask =
        Array.isArray(detail?.tasks) &&
        detail.tasks.some(
          task =>
            String(task.status || '')
              .trim()
              .toUpperCase() === 'PENDING'
        )
      const hasWorkflowPointer = Boolean(
        detail?.currentTaskId || detail?.currentApproverId || detail?.currentStepName
      )

      if (isActiveDetail && (hasPendingTask || hasWorkflowPointer)) {
        return
      }

      const planId = currentPlan.value?.id
      if (planId !== undefined && planId !== null && planId !== '') {
        await planStore.loadPlanDetails(planId, { force: true, background: true })
      }

      if (attempt < maxAttempts - 1) {
        await sleep(delayMs)
      }
    }

    preloadedPlanWorkflowDetail.value = null
  }

  async function preloadApprovalWorkflowDetail(): Promise<void> {
    preloadedPlanWorkflowDetail.value = null

    const reportId = Number(
      hasApprovalWorkflowReportBinding.value
        ? (approvalWorkflowReportSummary.value?.id ?? NaN)
        : NaN
    )
    if (shouldPreferCurrentReportWorkflow.value && Number.isFinite(reportId) && reportId > 0) {
      try {
        const response = await getWorkflowInstanceDetailByBusiness('PLAN_REPORT', reportId)
        if (response.success && response.data) {
          preloadedPlanWorkflowDetail.value = response.data
          return
        }
      } catch (error) {
        logger.warn('[StrategicTaskView] 优先预加载 PlanReport 审批详情失败，回退 PLAN:', {
          reportId,
          error
        })
      }
    }

    const planId = currentPlan.value?.id
    if (planId === undefined || planId === null || planId === '') {
      if (Number.isFinite(reportId) && reportId > 0) {
        try {
          const response = await getWorkflowInstanceDetailByBusiness('PLAN_REPORT', reportId)
          if (response.success && response.data) {
            preloadedPlanWorkflowDetail.value = response.data
          }
        } catch (error) {
          logger.warn('[StrategicTaskView] 预加载 PlanReport 审批抽屉工作流详情失败:', {
            reportId,
            error
          })
        }
      }
      return
    }

    await planStore.loadPlanDetails(planId, { force: true, background: true })

    const latestPlan = currentPlan.value
    if (!latestPlan) {
      return
    }

    try {
      const businessEntityId = Number(latestPlan.id ?? 0)
      if (Number.isFinite(businessEntityId) && businessEntityId > 0) {
        const response = await getWorkflowInstanceDetailByBusiness('PLAN', businessEntityId)
        if (response.success && response.data) {
          preloadedPlanWorkflowDetail.value = response.data
        }
        return
      }

      const workflowInstanceId = Number(latestPlan.workflowInstanceId ?? 0)
      if (Number.isFinite(workflowInstanceId) && workflowInstanceId > 0) {
        const response = await getWorkflowInstanceDetail(String(workflowInstanceId))
        if (response.success && response.data) {
          preloadedPlanWorkflowDetail.value = response.data
        }
      }
    } catch (error) {
      logger.warn('[StrategicTaskView] 预加载审批抽屉工作流详情失败:', {
        planId,
        error
      })
    }

    if (Number.isFinite(reportId) && reportId > 0) {
      try {
        const response = await getWorkflowInstanceDetailByBusiness('PLAN_REPORT', reportId)
        if (response.success && response.data) {
          preloadedPlanWorkflowDetail.value = response.data
        }
      } catch (error) {
        logger.warn(
          '[StrategicTaskView] PLAN detail 不可用，回退加载 PlanReport 审批抽屉工作流详情失败:',
          {
            reportId,
            error
          }
        )
      }
    }
  }

  // 打开任务审批抽屉
  const handleOpenApproval = async () => {
    await refreshApprovalWorkflowSummaries()
    await preloadApprovalWorkflowDetail()
    taskApprovalVisible.value = true
  }

  const handleApprovalStatusPopoverShow = async () => {
    if (!hasApprovalWorkflowReportBinding.value && !currentPlan.value?.id) {
      return
    }

    approvalStatusPopoverLoading.value = true

    try {
      if (!preloadedPlanWorkflowDetail.value) {
        await refreshApprovalWorkflowSummaries()
        await preloadApprovalWorkflowDetail()
      }

      const previewWorkflowCode =
        currentApprovalWorkflowCode.value || PLAN_APPROVAL_SUBMIT_WORKFLOW_CODE
      if (
        previewWorkflowCode &&
        approvalWorkflowPreview.value?.workflowCode !== previewWorkflowCode
      ) {
        try {
          const response = await getWorkflowDefinitionPreviewByCode(previewWorkflowCode)
          if (response.success && response.data) {
            approvalWorkflowPreview.value = response.data
          }
        } catch (error) {
          logger.warn('[StrategicTaskView] 加载流程状态候选审批人失败:', error)
        }
      }
    } finally {
      approvalStatusPopoverLoading.value = false
    }
  }

  // 审批后刷新
  const handleApprovalRefresh = async () => {
    // 使用统一的变更后刷新逻辑，确保指标列表、计划详情、上报摘要、待办数量全部同步
    await refreshTaskPageAfterIndicatorMutation()

    // 额外刷新 planStore 的详情（与 strategicStore 不同步）
    const planId = currentPlan.value?.id
    if (planId !== undefined && planId !== null && planId !== '') {
      await planStore.loadPlanDetails(planId, { force: true, background: true })
    }

    // 强制关闭抽屉以避免旧数据残留
    taskApprovalVisible.value = false
    nextTick(() => {
      updateEditTime()
    })
  }

  // 下发弹窗状态
  const distributeDialogVisible = ref(false)
  const currentDistributeItem = ref<StrategicIndicator | null>(null)
  const currentDistributeGroup = ref<{ taskContent: string; rows: StrategicIndicator[] } | null>(
    null
  )
  const distributeTarget = ref<string[]>([])

  // ================== 进度审批相关 ==================
  // 旧的本地审批弹窗已停用，统一改为从真实工作流待办入口处理。

  // 查看详情
  const handleViewDetail = (row: StrategicIndicator) => {
    currentDetail.value = row
    detailDrawerVisible.value = true
  }

  // ================== 指标审核工作流方法 ==================

  // 判断是否为战略发展部
  const isStrategicDept = computed(() => {
    return authStore.userRole === 'strategic_dept' || props.selectedRole === 'strategic_dept'
  })

  // 审核通过指标定义
  const approveIndicatorReview = async (indicatorId: string) => {
    try {
      const indicator = indicators.value.find(i => i.id.toString() === indicatorId)
      if (!indicator) {
        ElMessage.error('找不到指标')
        return
      }

      ElMessageBox.confirm(
        `确认审核通过指标 "${indicator.name}"？\n\n审核通过后，指标将变为已下发状态。`,
        '审核通过',
        {
          confirmButtonText: '确认通过',
          cancelButtonText: '取消',
          type: 'success'
        }
      )
        .then(async () => {
          const loading = ElLoading.service({
            lock: true,
            text: '正在审核...',
            background: 'rgba(0, 0, 0, 0.7)'
          })

          try {
            await indicatorApi.approveIndicatorReview(indicatorId)
            ElMessage.success('审核通过')

            await refreshTaskPageAfterIndicatorMutation()
            updateEditTime()
          } catch (error) {
            logger.error('审核通过失败:', error)
            ElMessage.error('审核通过失败，请重试')
          } finally {
            loading.close()
          }
        })
        .catch(() => {
          // 用户取消操作
        })
    } catch (error) {
      logger.error('审核通过失败:', error)
      ElMessage.error('审核通过失败')
    }
  }

  // 驳回指标定义审核
  const rejectIndicatorReview = async (indicatorId: string) => {
    try {
      const indicator = indicators.value.find(i => i.id.toString() === indicatorId)
      if (!indicator) {
        ElMessage.error('找不到指标')
        return
      }

      // 使用 ElMessageBox.prompt 收集驳回原因
      ElMessageBox.prompt(`请输入驳回指标 "${indicator.name}" 的原因：`, '审核驳回', {
        confirmButtonText: '确认驳回',
        cancelButtonText: '取消',
        inputType: 'textarea',
        inputPlaceholder: '请输入驳回原因（必填）',
        inputValidator: value => {
          if (!value || !value.trim()) {
            return '驳回原因不能为空'
          }
          return true
        }
      })
        .then(async ({ value: reason }) => {
          const loading = ElLoading.service({
            lock: true,
            text: '正在驳回...',
            background: 'rgba(0, 0, 0, 0.7)'
          })

          try {
            await indicatorApi.rejectIndicatorReview(indicatorId, reason)
            ElMessage.info('已驳回审核')

            await refreshTaskPageAfterIndicatorMutation()
            updateEditTime()
          } catch (error) {
            logger.error('驳回审核失败:', error)
            ElMessage.error('驳回审核失败，请重试')
          } finally {
            loading.close()
          }
        })
        .catch(() => {
          // 用户取消操作
        })
    } catch (error) {
      logger.error('驳回审核失败:', error)
      ElMessage.error('驳回审核失败')
    }
  }

  // 打开下发弹窗
  const _openDistributeDialog = (row: StrategicIndicator) => {
    currentDistributeItem.value = row
    // 默认选中左侧当前选择的部门
    distributeTarget.value = selectedDepartment.value ? [selectedDepartment.value] : []
    distributeDialogVisible.value = true
  }

  const triggerApprovalForDistribution = async (indicator: StrategicIndicator) => {
    const indicatorId = Number(indicator.id)
    if (!Number.isFinite(indicatorId) || indicatorId <= 0) {
      return { skipped: true as const, reason: 'temporary_indicator' }
    }

    const requesterId = Number(getCurrentActorUserId() || 0)
    const rawOrgId = Number((authStore.user as { orgId?: number | string } | null)?.orgId || 0)
    const fallbackOrgId =
      departmentNameIdMap.value.get(
        authStore.effectiveDepartment || authStore.userDepartment || ''
      ) || 0
    const requesterOrgId = rawOrgId > 0 ? rawOrgId : Number(fallbackOrgId)
    const traceId = `dist-${indicatorId}-${Date.now()}`

    if (
      !Number.isFinite(requesterId) ||
      requesterId <= 0 ||
      !Number.isFinite(requesterOrgId) ||
      requesterOrgId <= 0
    ) {
      return { skipped: true as const, reason: 'missing_requester_context', traceId }
    }

    // Use new workflow API
    await startWorkflow({
      workflowCode: 'TASK_DISTRIBUTION',
      businessEntityId: indicatorId,
      businessEntityType: 'TASK'
    })
    const requestId = traceId

    logger.info('[StrategicTaskView] Distribution approval triggered', {
      traceId,
      requestId,
      indicatorId,
      requesterId,
      requesterOrgId
    })

    return { skipped: false as const, traceId, requestId, instanceId: undefined }
  }

  // 确认下发（支持单个和整体下发）
  const confirmDistribute = () => {
    if (!ensurePlanCanDistribute()) {
      return
    }

    if (distributeTarget.value.length === 0) {
      ElMessage.warning('请选择下发目标部门')
      return
    }

    const targetDepts = distributeTarget.value.join('、')

    // 整体下发模式
    if (currentDistributeGroup.value) {
      const pendingRows = currentDistributeGroup.value.rows.filter(r => r.canWithdraw)
      ElMessageBox.confirm(
        `确认将任务 "${currentDistributeGroup.value.taskContent}" 下的 ${pendingRows.length} 个指标下发到以下部门？\n\n${targetDepts}`,
        '整体下发确认',
        {
          confirmButtonText: '确认下发',
          cancelButtonText: '取消',
          type: 'info'
        }
      )
        .then(async () => {
          try {
            // 为每个目标部门创建指标副本
            for (const row of pendingRows) {
              const persistedIndicatorId = String(row.id)
              if (!/^\d+$/.test(persistedIndicatorId)) {
                throw new Error(`指标 ${persistedIndicatorId} 尚未持久化，无法执行下发`)
              }

              // 构建审计记录
              const newAuditEntry = {
                id: `audit-${row.id}-${Date.now()}`,
                operator: String(getCurrentActorUserId() || 'admin'),
                operatorName: authStore.user?.name || '管理员',
                operatorDept:
                  authStore.effectiveDepartment || authStore.userDepartment || '战略发展部',
                action: 'distribute' as const,
                comment: `下发到 ${distributeTarget.value.join('、')}`,
                timestamp: new Date()
              }

              for (const [index, dept] of distributeTarget.value.entries()) {
                const targetOrgId = departmentNameIdMap.value.get(dept)
                if (!Number.isFinite(targetOrgId)) {
                  throw new Error(`未找到部门 ${dept} 对应的组织ID`)
                }

                if (index === 0) {
                  await indicatorApi.distributeIndicator({
                    parentIndicatorId: persistedIndicatorId,
                    targetOrgId: String(targetOrgId),
                    actorUserId: String(getCurrentActorUserId() || '')
                  })
                } else {
                  await strategicStore.addIndicator({
                    ...(row as StrategicIndicator & { taskId?: string | number }),
                    id: `${Date.now()}-${index}-${row.id}`,
                    parentIndicatorId: persistedIndicatorId,
                    taskId: getIndicatorTaskId(row) ?? undefined,
                    responsibleDept: dept,
                    ownerDept: '战略发展部',
                    canWithdraw: false,
                    progress: 0,
                    statusAudit: [newAuditEntry]
                  })
                }
              }

              const approvalTriggerResult = await triggerApprovalForDistribution(row)
              if (!approvalTriggerResult.skipped) {
                ElMessage.info(
                  `审批流已触发（实例ID: ${approvalTriggerResult.instanceId || '待回填'}，requestId: ${approvalTriggerResult.requestId || approvalTriggerResult.traceId}）`
                )
              } else {
                ElMessage.warning(
                  `指标 ${row.id} 下发成功，但审批未触发（${approvalTriggerResult.reason}）`
                )
              }
            }
            ElMessage.success(
              `已成功下发 ${pendingRows.length} 个指标到 ${distributeTarget.value.length} 个部门`
            )
            closeDistributeDialog()
            await refreshTaskPageAfterIndicatorMutation()
            updateEditTime()
          } catch (error) {
            logger.error('Failed to distribute indicators:', error)
            ElMessage.error('下发失败，请稍后重试')
          }
        })
        .catch(() => {
          // 用户取消操作
        })
      return
    }

    // 单个下发模式
    if (!currentDistributeItem.value) {
      return
    }

    ElMessageBox.confirm(
      `确认将指标 "${currentDistributeItem.value.name}" 下发到以下部门？\n\n${targetDepts}`,
      '下发确认',
      {
        confirmButtonText: '确认下发',
        cancelButtonText: '取消',
        type: 'info'
      }
    )
      .then(async () => {
        try {
          const row = currentDistributeItem.value
          if (!row) {
            return
          }

          const persistedIndicatorId = String(row.id)
          if (!/^\d+$/.test(persistedIndicatorId)) {
            throw new Error(`指标 ${persistedIndicatorId} 尚未持久化，无法执行下发`)
          }

          // 构建审计记录
          const newAuditEntry = {
            id: `audit-${row.id}-${Date.now()}`,
            operator: String(getCurrentActorUserId() || 'admin'),
            operatorName: authStore.user?.name || '管理员',
            operatorDept: authStore.effectiveDepartment || authStore.userDepartment || '战略发展部',
            action: 'distribute' as const,
            comment: `下发到 ${distributeTarget.value.join('、')}`,
            timestamp: new Date()
          }

          // 为每个目标部门处理
          for (const [index, dept] of distributeTarget.value.entries()) {
            const targetOrgId = departmentNameIdMap.value.get(dept)
            if (!Number.isFinite(targetOrgId)) {
              throw new Error(`未找到部门 ${dept} 对应的组织ID`)
            }

            if (index === 0) {
              await indicatorApi.distributeIndicator({
                parentIndicatorId: persistedIndicatorId,
                targetOrgId: String(targetOrgId),
                actorUserId: String(getCurrentActorUserId() || '')
              })
            } else {
              await strategicStore.addIndicator({
                ...(row as StrategicIndicator & { taskId?: string | number }),
                id: `${Date.now()}-${index}-${row.id}`,
                parentIndicatorId: persistedIndicatorId,
                taskId: getIndicatorTaskId(row) ?? undefined,
                responsibleDept: dept,
                ownerDept: '战略发展部',
                canWithdraw: false,
                progress: 0,
                statusAudit: [newAuditEntry]
              })
            }
          }
          const approvalTriggerResult = await triggerApprovalForDistribution(row)
          ElMessage.success(`指标已成功下发到 ${distributeTarget.value.length} 个部门`)
          if (!approvalTriggerResult.skipped) {
            ElMessage.info(
              `审批流已触发（实例ID: ${approvalTriggerResult.instanceId || '待回填'}，requestId: ${approvalTriggerResult.requestId || approvalTriggerResult.traceId}）`
            )
          } else {
            ElMessage.warning(`下发成功，但审批未触发（${approvalTriggerResult.reason}）`)
          }
          closeDistributeDialog()
          await refreshTaskPageAfterIndicatorMutation()
          updateEditTime()
        } catch (error) {
          logger.error('Failed to distribute indicator:', error)
          ElMessage.error('下发失败，请稍后重试')
        }
      })
      .catch(() => {
        // 用户取消操作
      })
  }

  // 关闭下发弹窗
  const closeDistributeDialog = () => {
    distributeDialogVisible.value = false
    currentDistributeItem.value = null
    currentDistributeGroup.value = null
    distributeTarget.value = []
  }

  // 单个撤回
  const _handleWithdraw = async (row: StrategicIndicator) => {
    // 检查 Plan 状态：是否可以撤回
    if (!canWithdrawPlan.value) {
      if (currentPlanStatus.value === 'DISTRIBUTED') {
        ElMessage.warning('当前 Plan 已下发，无法撤回')
      } else if (currentPlanStatus.value === 'PENDING') {
        ElMessage.warning('当前审批进度不支持撤回')
      } else {
        ElMessage.warning('当前状态无法撤回')
      }
      return
    }

    ElMessageBox.confirm(
      `撤回后，该指标将重新变为可下发状态。确认撤回 "${row.name}"？`,
      '撤回操作',
      {
        confirmButtonText: '确认撤回',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
      .then(async () => {
        try {
          await strategicStore.withdrawIndicator(row.id.toString())
          await refreshTaskPageAfterIndicatorMutation()
          ElMessage.info('指标已撤回')
          updateEditTime()
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : '未知错误'
          ElMessage.error({
            message: `撤回失败: ${errorMsg}`,
            duration: 5000,
            showClose: true
          })
          logger.error('Withdraw failed:', err)
          await refreshTaskPageAfterIndicatorMutation()
        }
      })
      .catch(() => {
        // 用户取消操作
      })
  }

  // 全部下发（下发当前界面所有未下发的指标）
  const handleDistributeAll = async () => {
    if (!ensurePlanCanDistribute()) {
      return
    }

    // 检查是否有待审批的进度
    if (pendingApprovalCount.value > 0) {
      ElMessage.warning(
        `有 ${pendingApprovalCount.value} 个指标有待审批的进度，请先完成审批后再下发`
      )
      return
    }

    // 基于生命周期状态判断可下发的指标
    const pendingRows = indicators.value.filter(r => {
      if (!r.name) {
        return false
      } // 只下发有核心指标的记录
      // 草稿或待审核状态的指标可以下发（使用大写枚举值）
      return !r.status || r.status === IndicatorStatus.DRAFT || r.status === IndicatorStatus.PENDING
    })

    if (pendingRows.length === 0) {
      ElMessage.warning('当前没有待下发的指标')
      return
    }

    ElMessageBox.confirm(
      `确认下发当前部门的全部 ${pendingRows.length} 个待下发指标？`,
      '全部下发确认',
      {
        confirmButtonText: '确认下发',
        cancelButtonText: '取消',
        type: 'info'
      }
    )
      .then(async () => {
        // 显示加载状态
        const loading = ElMessage({
          message: '正在下发指标...',
          type: 'info',
          duration: 0
        })

        try {
          const approvalResults: Array<{
            skipped: boolean
            traceId?: string
            requestId?: string
            instanceId?: number
            reason?: string
          }> = []

          // 更新所有指标状态为已下发，并逐条触发审批流
          for (const row of pendingRows) {
            const indicatorId = String(row.id)
            const targetOrgId = departmentNameIdMap.value.get(row.responsibleDept)

            if (/^\d+$/.test(indicatorId) && Number.isFinite(targetOrgId)) {
              await indicatorApi.distributeIndicator({
                parentIndicatorId: indicatorId,
                targetOrgId: String(targetOrgId),
                actorUserId: String(getCurrentActorUserId() || '')
              })
            } else {
              throw new Error(`指标 ${indicatorId} 缺少持久化 ID 或目标部门映射，无法执行批量下发`)
            }

            const approvalTriggerResult = await triggerApprovalForDistribution(row)
            approvalResults.push(approvalTriggerResult)
          }

          // 重新从后端加载数据，确保前端状态与后端一致
          await refreshTaskPageAfterIndicatorMutation()

          loading.close()
          ElMessage.success({
            message: `已成功下发 ${pendingRows.length} 个指标`,
            duration: 5000,
            showClose: true
          })
          const triggered = approvalResults.filter(r => !r.skipped)
          if (triggered.length > 0) {
            const sample = triggered[0]
            ElMessage.info(
              `审批流已触发 ${triggered.length} 条（示例 实例ID: ${sample.instanceId || '待回填'}，requestId: ${sample.requestId || sample.traceId || 'N/A'}）`
            )
          } else {
            const firstSkipped = approvalResults[0]
            if (firstSkipped) {
              ElMessage.warning(
                `下发成功，但审批未触发（${firstSkipped.reason || 'unknown_reason'}）`
              )
            }
          }
          updateEditTime()
        } catch (err) {
          loading.close()
          const errorMsg = err instanceof Error ? err.message : '未知错误'
          ElMessage.error({
            message: `下发失败: ${errorMsg}`,
            duration: 5000,
            showClose: true
          })
          logger.error('Distribute all failed:', err)
          await refreshTaskPageAfterIndicatorMutation()
        }
      })
      .catch(() => {
        // 用户取消操作
      })
  }

  // 全部撤回（撤回当前界面所有已下发的指标）
  const handleWithdrawAll = async () => {
    // 检查 Plan 状态：是否可以撤回
    if (!canWithdrawPlan.value) {
      if (isPlanDistributed.value) {
        ElMessage.warning('当前 Plan 已下发，无法撤回')
      } else if (currentPlanStatus.value === 'PENDING') {
        ElMessage.warning('当前审批进度不支持撤回')
      } else {
        ElMessage.warning('当前状态无法撤回')
      }
      return
    }

    const planId = Number(currentPlan.value?.id ?? NaN)
    if (!Number.isFinite(planId) || planId <= 0) {
      ElMessage.warning('当前没有可撤回的计划')
      return
    }

    ElMessageBox.confirm(
      '确认撤回当前部门的下发申请？撤回后，当前 Plan 将恢复为草稿状态。',
      '全部撤回确认',
      {
        confirmButtonText: '确认撤回',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
      .then(async () => {
        // 显示加载状态
        const loading = ElMessage({
          message: '正在撤回 Plan...',
          type: 'info',
          duration: 0
        })

        try {
          await planStore.withdrawPlan(planId)
          if (currentPlan.value) {
            currentPlan.value = {
              ...currentPlan.value,
              status: 'DRAFT',
              workflowStatus: 'WITHDRAWN',
              canWithdraw: false,
              currentTaskId: undefined,
              currentStepName: undefined,
              currentApproverId: undefined,
              currentApproverName: undefined
            }
          }
          applyLocalPlanWorkflowUiPatch('withdrawn')
          await planStore.loadPlans({ force: true, background: true })
          loading.close()
          ElMessage.success('已成功撤回当前 Plan')

          try {
            await refreshTaskPageAfterIndicatorMutation()
            await refreshApprovalCenterLiveView()
            notifyApprovalStateRefresh({ source: 'strategic-task-plan-withdraw' })
          } catch (refreshError) {
            logger.warn('[StrategicTaskView] Plan 撤回成功，但刷新指标列表失败:', refreshError)
            ElMessage.warning('Plan 已撤回成功，但指标列表刷新失败，请手动刷新页面确认最新状态')
          }

          updateEditTime()
        } catch (err) {
          loading.close()
          const errorMsg = err instanceof Error ? err.message : '未知错误'
          ElMessage.error({
            message: `撤回失败: ${errorMsg}`,
            duration: 5000,
            showClose: true
          })
          logger.error('Withdraw failed:', err)
          await refreshTaskPageAfterIndicatorMutation()
        }
      })
      .catch(() => {
        // 用户取消操作
      })
  }

  // 按任务整体下发（复用下发弹窗）
  const _handleBatchDistributeByTask = (group: {
    taskContent: string
    rows: StrategicIndicator[]
  }) => {
    if (!ensurePlanCanDistribute()) {
      return
    }

    const pendingRows = group.rows.filter(r => r.canWithdraw)
    if (pendingRows.length === 0) {
      ElMessage.warning('该任务下所有指标已下发')
      return
    }

    currentDistributeGroup.value = group
    currentDistributeItem.value = null
    distributeTarget.value = selectedDepartment.value ? [selectedDepartment.value] : []
    distributeDialogVisible.value = true
  }

  // 按任务整体撤回
  const _handleBatchWithdrawByTask = async (group: {
    taskContent: string
    rows: StrategicIndicator[]
  }) => {
    const distributedRows = getPersistedWithdrawableRows(group.rows)
    if (distributedRows.length === 0) {
      ElMessage.warning('该任务下没有已下发的指标')
      return
    }

    ElMessageBox.confirm(
      `确认撤回任务 "${group.taskContent}" 下的 ${distributedRows.length} 个已下发指标？`,
      '批量撤回确认',
      {
        confirmButtonText: '确认撤回',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
      .then(async () => {
        // 显示加载状态
        const loading = ElMessage({
          message: '正在撤回指标...',
          type: 'info',
          duration: 0
        })

        try {
          // 1. 先调用后端 API 更新所有指标
          await Promise.all(
            distributedRows.map(row => strategicStore.withdrawIndicator(row.id.toString()))
          )

          await refreshTaskPageAfterIndicatorMutation()

          loading.close()
          ElMessage.success(`已成功撤回 ${distributedRows.length} 个指标`)
          updateEditTime()
        } catch (err) {
          loading.close()
          const errorMsg = err instanceof Error ? err.message : '未知错误'
          ElMessage.error({
            message: `撤回失败: ${errorMsg}`,
            duration: 5000,
            showClose: true
          })
          logger.error('Batch withdraw failed:', err)
          await refreshTaskPageAfterIndicatorMutation()
        }
      })
      .catch(() => {
        // 用户取消操作
      })
  }

  // 按任务整体删除
  const _handleBatchDeleteByTask = (group: { taskContent: string; rows: StrategicIndicator[] }) => {
    if (group.rows.length === 0) {
      ElMessage.warning('该任务下没有指标')
      return
    }

    ElMessageBox.confirm(
      `确定要删除任务 "${group.taskContent}" 下的全部 ${group.rows.length} 个指标吗？删除后无法恢复。`,
      '批量删除确认',
      {
        confirmButtonText: '确定删除',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
      .then(async () => {
        const loading = ElLoading.service({
          lock: true,
          text: '正在批量删除并刷新数据...',
          background: 'rgba(0, 0, 0, 0.5)'
        })

        try {
          await Promise.all(
            group.rows.map(row => strategicStore.deleteIndicator(row.id.toString()))
          )
          await refreshTaskPageAfterIndicatorMutation()
          ElMessage.success(`已成功删除 ${group.rows.length} 个指标`)
          updateEditTime()
        } catch (error) {
          logger.error('[StrategicTaskView] 批量删除指标失败:', error)
          ElMessage.error('批量删除失败，请稍后重试')
        } finally {
          loading.close()
        }
      })
      .catch(() => {
        // 用户取消操作
      })
  }

  // 删除单个指标
  const handleDeleteIndicator = (row: StrategicIndicator) => {
    if (!canDeleteIndicator(row)) {
      ElMessage.warning('只有未下发的草稿计划才能删除指标')
      return
    }

    const indicatorId = row?.id
    if (indicatorId === null || indicatorId === undefined || indicatorId === '') {
      ElMessage.warning('当前行不是可删除的指标数据')
      return
    }

    ElMessageBox.confirm(`确定要删除指标 "${row.name}" 吗？删除后无法恢复。`, '删除确认', {
      confirmButtonText: '确定删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
      .then(async () => {
        const loading = ElLoading.service({
          lock: true,
          text: '正在删除指标并刷新数据...',
          background: 'rgba(0, 0, 0, 0.5)'
        })

        try {
          await strategicStore.deleteIndicator(indicatorId.toString())
          await refreshTaskPageAfterIndicatorMutation()
          ElMessage.success('指标已删除')
          updateEditTime()
        } catch (error) {
          logger.error('[StrategicTaskView] 删除指标失败:', error)
          ElMessage.error('删除失败，请稍后重试')
        } finally {
          loading.close()
        }
      })
      .catch(() => {
        // 用户取消操作
      })
  }

  // ================== 审批流程相关 ==================

  /**
   * 获取待审批计划数量
   */
  const pendingPlanApprovalCount = ref(0)

  /**
   * 加载待审批计划数量
   */
  const loadPendingPlanApprovalCount = async () => {
    try {
      const userId = getCurrentActorUserId() || 1
      const response = await taskApprovalApi.countPendingApprovals(userId)
      if (response.success && response.data !== undefined) {
        pendingPlanApprovalCount.value = response.data
      }
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : error && typeof error === 'object' && 'message' in error
            ? String((error as { message: unknown }).message)
            : '未知错误'
      logger.error('[StrategicTaskView] 加载待审批计划数量失败:', msg)
    }
  }

  // 组件挂载时加载待审批计划数量
  onMounted(() => {
    loadPendingPlanApprovalCount()
  })

  // 任务类别颜色映射
  const getCategoryColor = (type2: string) => {
    if (type2 === '发展性') {
      return '#409EFF'
    }
    if (type2 === '基础性') {
      return '#67C23A'
    }
    return '#909399'
  }

  const getCategoryText = (type2?: string): string => {
    if (type2 === '发展性' || type2 === '基础性') {
      return type2
    }
    return '其他'
  }

  // 表格滚动状态
  const _tableScrollRef = ref<HTMLElement | null>(null)
  const isTableScrolling = ref(false)

  // 监听表格滚动，判断是否需要显示操作列的固定效果
  const _handleTableScroll = (e: Event) => {
    const target = e.target as HTMLElement
    const scrollLeft = target.scrollLeft
    const scrollWidth = target.scrollWidth
    const clientWidth = target.clientWidth
    // 当滚动到最右侧时（允许2px误差），隐藏固定效果
    isTableScrolling.value = scrollLeft < scrollWidth - clientWidth - 2
  }

  // 进度条颜色计算
  // 未下发：灰色 | 任务周期内未达标：黄色 | 超过任务周期未达标：红色 | 任务周期内已达标：绿色
  // 使用统一的进度条颜色规则 (Requirements: 10.2)
  const getProgressColor = (row: StrategicIndicator): string => {
    // 未下发的进度条为灰色
    if (row.canWithdraw) {
      return 'var(--text-placeholder)' // 使用CSS变量 #C0C4CC
    }

    const progress = row.progress || 0
    const targetValue = row.targetValue || 100
    const isAchieved = progress >= targetValue

    // 检查是否有里程碑及其截止日期
    const _currentDate = new Date()
    let isOverdue = false

    if (row.milestones && row.milestones.length > 0) {
      // 检查最后一个里程碑的截止日期
      const lastMilestone = row.milestones[row.milestones.length - 1]
      if (lastMilestone.deadline) {
        const deadlineDate = new Date(lastMilestone.deadline)
        isOverdue = _currentDate > deadlineDate
      }
    }

    if (isAchieved) {
      return 'var(--color-success)' // 绿色：已达标
    } else if (isOverdue) {
      return 'var(--color-danger)' // 红色：超过任务周期未达标
    } else {
      return 'var(--color-warning)' // 黄色：任务周期内未达标
    }
  }

  // 获取进度状态 - 使用统一的进度条颜色规则 (Requirements: 10.2)
  // 规则: progress >= 80: success, 50 <= progress < 80: warning, progress < 50: exception
  const getProgressStatus = (progress: number): 'success' | 'warning' | 'exception' => {
    if (progress >= 80) {
      return 'success'
    }
    if (progress >= 50) {
      return 'warning'
    }
    return 'exception'
  }

  const hasPendingProgressValue = (indicator: StrategicIndicator): boolean => {
    const pendingProgress = Number(indicator.pendingProgress)
    if (!Number.isFinite(pendingProgress)) {
      return false
    }

    const currentProgress = Number(indicator.progress || 0)
    return pendingProgress !== currentProgress
  }

  const getPendingProgressDelta = (indicator: StrategicIndicator): number => {
    const pendingProgress = Number(indicator.pendingProgress)
    if (!Number.isFinite(pendingProgress)) {
      return 0
    }

    return pendingProgress - Number(indicator.progress || 0)
  }

  const hasPendingProgressContent = (indicator: StrategicIndicator): boolean => {
    const pendingRemark = String(indicator.pendingRemark || '').trim()
    return hasPendingProgressValue(indicator) || Boolean(pendingRemark)
  }

  const getDisplayedReportedProgress = (indicator: StrategicIndicator): number | null => {
    const reportedProgress = Number(
      (indicator as StrategicIndicator & { reportProgress?: number | null }).reportProgress
    )
    if (!Number.isFinite(reportedProgress)) {
      return null
    }
    return reportedProgress
  }

  const shouldShowReportedProgress = (indicator: StrategicIndicator): boolean => {
    const reportedProgress = getDisplayedReportedProgress(indicator)
    if (reportedProgress === null) {
      return false
    }
    return reportedProgress !== Number(indicator.progress || 0)
  }

  return {
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
    getCurrentActorUserId,
    getCurrentCycleId,
    getCurrentScopeIndicatorsForMilestones,
    getIndicatorCategoryLabel,
    getIndicatorMappedTaskType,
    getIndicatorTaskId,
    getMilestonesTooltip,
    getPersistedWithdrawableRows,
    getProgressColor,
    getProgressStatus,
    getDisplayedReportedProgress,
    getPendingProgressDelta,
    getRouteQueryText,
    getSortedMilestones,
    getSpanMethod,
    getTaskCategoryLabel,
    getTaskGroup,
    getTaskStatus,
    getTaskTypeForPersistence,
    hasPendingProgressContent,
    hasPendingProgressValue,
    shouldShowReportedProgress,
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
    handleEditMilestonesByIndex,
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
    isMilestoneLoading,
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
  }
}
