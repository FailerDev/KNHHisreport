import { test } from '@japa/runner'
import ReportParameter from '#models/report_parameter'
import { effectiveParameters } from '#services/report_params'
import ReportRunner from '#services/report_runner'

test.group('effectiveParameters', () => {
  test('builds stubs for every @token when nothing is configured', ({ assert }) => {
    const list = effectiveParameters('SELECT * FROM t WHERE d BETWEEN @start_d AND @end_d AND x = @ds AND y = @foo', [])
    assert.deepEqual(list.map((p) => p.paramName), ['start_d', 'end_d', 'ds', 'foo'])
    assert.deepEqual(list.map((p) => p.paramType), ['date', 'date', 'text', 'text'])
    assert.isTrue(list[0].paramRequired)
    assert.isFalse(list[3].paramRequired)
  })

  test('keeps configured rows and only stubs the missing tokens', ({ assert }) => {
    const cfg = new ReportParameter()
    cfg.paramName = 'start_d'
    cfg.paramLabel = 'ตั้งเอง'
    cfg.paramType = 'date'
    cfg.sortOrder = 3
    const list = effectiveParameters('WHERE a = @start_d AND b = @hn', [cfg])
    assert.equal(list[0].paramLabel, 'ตั้งเอง')
    assert.equal(list[1].paramName, 'hn')
    assert.equal(list[1].sortOrder, 4)
  })

  test('only core date/time tokens get defaults; @chknull is never a field', ({ assert }) => {
    const list = effectiveParameters('WHERE t BETWEEN @start_t AND @end_t AND m @main_dep AND (@chknull)', [])
    assert.deepEqual(
      list.map((p) => [p.paramName, p.paramDefault, p.paramLabel]),
      [['start_t', '08.00', 'เวลาเริ่มต้น (HH.MM)'], ['end_t', '16.00', 'เวลาสิ้นสุด (HH.MM)'], ['main_dep', null, 'main_dep']]
    )
  })

  test('no tokens → empty list', ({ assert }) => {
    assert.lengthOf(effectiveParameters('SELECT 1', []), 0)
  })
})

test.group('ReportRunner legacy hardening', () => {
  test('@chknull becomes 1=1', ({ assert }) => {
    assert.equal(ReportRunner.processSql('AND (@chknull)', {}), 'AND (1=1)')
  })

  test('start_t is escaped', ({ assert }) => {
    assert.equal(ReportRunner.processSql('@start_t', { start_t: "08'00" }), "'08''00'")
  })

  test('dayofweek must be digits 1-7', ({ assert }) => {
    const p = effectiveParameters('IN (@dayofweek)', [])
    assert.lengthOf(ReportRunner.validate({ dayofweek: '1,2, 7' }, p), 0)
    assert.lengthOf(ReportRunner.validate({ dayofweek: '1) OR (1=1' }, p), 1)
  })
})
