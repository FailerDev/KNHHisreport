import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import {
  canTransition,
  filePurgeDate,
  fiscalYearBE,
  formatReqNo,
  statusMeta,
} from '#services/report_request_flow'

/**
 * Pure workflow rules for the report-request module. No DB required.
 */

test.group('report_request_flow.fiscalYearBE', () => {
  test('1 October starts the next fiscal year', ({ assert }) => {
    assert.equal(fiscalYearBE(DateTime.fromISO('2026-10-01')), 2570)
    assert.equal(fiscalYearBE(DateTime.fromISO('2026-10-09')), 2570)
    assert.equal(fiscalYearBE(DateTime.fromISO('2026-12-31')), 2570)
  })

  test('January–September stay in the current fiscal year', ({ assert }) => {
    assert.equal(fiscalYearBE(DateTime.fromISO('2026-09-30')), 2569)
    assert.equal(fiscalYearBE(DateTime.fromISO('2027-01-01')), 2570)
    assert.equal(fiscalYearBE(DateTime.fromISO('2027-09-30')), 2570)
  })
})

test.group('report_request_flow.formatReqNo', () => {
  test('pads the running number to 4 digits', ({ assert }) => {
    assert.equal(formatReqNo(2570, 1), 'REQ-2570-0001')
    assert.equal(formatReqNo(2570, 123), 'REQ-2570-0123')
    assert.equal(formatReqNo(2570, 12345), 'REQ-2570-12345')
  })
})

test.group('report_request_flow.canTransition', () => {
  test('pending can be approved, rejected or cancelled', ({ assert }) => {
    assert.isTrue(canTransition('pending', 'in_progress'))
    assert.isTrue(canTransition('pending', 'rejected'))
    assert.isTrue(canTransition('pending', 'cancelled'))
    assert.isFalse(canTransition('pending', 'completed'))
  })

  test('in_progress can be completed or rejected, not cancelled by requester', ({ assert }) => {
    assert.isTrue(canTransition('in_progress', 'completed'))
    assert.isTrue(canTransition('in_progress', 'rejected'))
    assert.isFalse(canTransition('in_progress', 'cancelled'))
    assert.isFalse(canTransition('in_progress', 'pending'))
  })

  test('final states are terminal', ({ assert }) => {
    for (const from of ['completed', 'rejected', 'cancelled'] as const) {
      for (const to of ['pending', 'in_progress', 'completed', 'rejected', 'cancelled'] as const) {
        assert.isFalse(canTransition(from, to), `${from} → ${to}`)
      }
    }
  })
})

test.group('report_request_flow.statusMeta', () => {
  test('returns Thai label for known status and a fallback for unknown', ({ assert }) => {
    assert.equal(statusMeta('in_progress').label, 'กำลังจัดทำ')
    assert.equal(statusMeta('weird').label, 'weird')
  })
})

test.group('report_request_flow.filePurgeDate', () => {
  const completedAt = DateTime.fromISO('2026-10-01T10:00:00')
  const base = { dataLevel: 'identifiable', status: 'completed', completedAt, filesPurgedAt: null }

  test('identifiable + completed → completedAt + days', ({ assert }) => {
    assert.equal(filePurgeDate(base, 30)?.toISODate(), '2026-10-31')
  })

  test('aggregate, unfinished or already purged requests are not purged', ({ assert }) => {
    assert.isNull(filePurgeDate({ ...base, dataLevel: 'aggregate' }, 30))
    assert.isNull(filePurgeDate({ ...base, status: 'in_progress' }, 30))
    assert.isNull(filePurgeDate({ ...base, filesPurgedAt: completedAt }, 30))
  })
})
