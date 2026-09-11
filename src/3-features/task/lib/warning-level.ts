export type PlanStatusLike = string | null | undefined

export function canEditManualAlertLevel(
  planStatus: PlanStatusLike,
  options: { readOnly?: boolean } = {}
): boolean {
  if (options.readOnly) {
    return false
  }
  return (
    String(planStatus ?? '')
      .trim()
      .toUpperCase() === 'DISTRIBUTED'
  )
}

export const MANUAL_ALERT_LOCKED_HINT = '计划正式下发后才能调整预警等级'
export const MANUAL_ALERT_READONLY_HINT = '历史年份只读，不能调整预警等级'
