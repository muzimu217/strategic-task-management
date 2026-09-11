import { describe, expect, it } from 'vitest'
import {
  MANUAL_ALERT_LOCKED_HINT,
  MANUAL_ALERT_READONLY_HINT,
  canEditManualAlertLevel
} from '@/features/task/lib/warning-level'

describe('canEditManualAlertLevel', () => {
  it('locks manual alert level for DRAFT plans', () => {
    expect(canEditManualAlertLevel('DRAFT')).toBe(false)
  })

  it('locks manual alert level for PENDING plans', () => {
    expect(canEditManualAlertLevel('PENDING')).toBe(false)
  })

  it('allows manual alert level editing for DISTRIBUTED plans', () => {
    expect(canEditManualAlertLevel('DISTRIBUTED')).toBe(true)
  })

  it('matches plan status case-insensitively', () => {
    expect(canEditManualAlertLevel('distributed')).toBe(true)
    expect(canEditManualAlertLevel('Distributed')).toBe(true)
  })

  it('locks manual alert level when plan status is missing', () => {
    expect(canEditManualAlertLevel(undefined)).toBe(false)
    expect(canEditManualAlertLevel(null)).toBe(false)
    expect(canEditManualAlertLevel('')).toBe(false)
    expect(canEditManualAlertLevel('   ')).toBe(false)
  })

  it('locks manual alert level in read-only historical years even for DISTRIBUTED plans', () => {
    expect(canEditManualAlertLevel('DISTRIBUTED', { readOnly: true })).toBe(false)
    expect(canEditManualAlertLevel('DISTRIBUTED', { readOnly: false })).toBe(true)
  })
})

describe('MANUAL_ALERT_LOCKED_HINT', () => {
  it('explains why the control is locked', () => {
    expect(MANUAL_ALERT_LOCKED_HINT).toBe('计划正式下发后才能调整预警等级')
  })

  it('explains why the control is locked in read-only years', () => {
    expect(MANUAL_ALERT_READONLY_HINT).toBe('历史年份只读，不能调整预警等级')
  })
})
