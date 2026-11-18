import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import {
  canRequesterCancel,
  canTransition,
  filePurgeDate,
  hasDeliverable,
  reportLinkQuery,
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

  test('in_progress can be completed, rejected or cancelled by requester', ({ assert }) => {
    assert.isTrue(canTransition('in_progress', 'completed'))
    assert.isTrue(canTransition('in_progress', 'rejected'))
    assert.isTrue(canTransition('in_progress', 'cancelled'))
    assert.isFalse(canTransition('in_progress', 'pending'))
  })

  test('canRequesterCancel only while the request is open', ({ assert }) => {
    assert.isTrue(canRequesterCancel('pending'))
    assert.isTrue(canRequesterCancel('in_progress'))
    assert.isFalse(canRequesterCancel('completed'))
    assert.isFalse(canRequesterCancel('rejected'))
    assert.isFalse(canRequesterCancel('cancelled'))
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

test.group('report_request_flow.hasDeliverable', () => {
  test('a file or a linked report is enough to close', ({ assert }) => {
    assert.isFalse(hasDeliverable(0, null))
    assert.isTrue(hasDeliverable(1, null))
    assert.isTrue(hasDeliverable(0, 12))
  })
})

test.group('report_request_flow.reportLinkQuery', () => {
  const p = (paramName: string, paramType: string) => ({ paramName, paramType })

  test('fills the first two date params with the request range', ({ assert }) => {
    const q = reportLinkQuery(
      [p('hcode', 'text'), p('start_d', 'date'), p('end_d', 'date'), p('x', 'date')],
      '2026-10-01',
      '2026-10-31'
    )
    assert.equal(q, '?start_d=2026-10-01&end_d=2026-10-31')
  })

  test('empty when the request has no range or the report no date params', ({ assert }) => {
    assert.equal(reportLinkQuery([p('start_d', 'date')], null, null), '')
    assert.equal(reportLinkQuery([p('hcode', 'text')], '2026-10-01', '2026-10-31'), '')
  })
})
