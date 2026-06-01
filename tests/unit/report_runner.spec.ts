import { test } from '@japa/runner'
import ReportRunner from '#services/report_runner'
import type ReportParameter from '#models/report_parameter'

/**
 * Pure-function tests for ReportRunner.
 * No DB required — exercises substitution semantics only.
 */

test.group('ReportRunner.processSql', () => {
  test('substitutes start_d / end_d in dd/mm/yyyy form', ({ assert }) => {
    const sql = 'SELECT * FROM ovst WHERE vstdate BETWEEN @start_d AND @end_d'
    const out = ReportRunner.processSql(sql, { start_d: '24/05/2026', end_d: '25/05/2026' })
    assert.equal(out, "SELECT * FROM ovst WHERE vstdate BETWEEN '2026-05-24' AND '2026-05-25'")
  })

  test('substitutes start_d / end_d in ISO form passthrough', ({ assert }) => {
    const out = ReportRunner.processSql('@start_d', { start_d: '2026-05-24' })
    assert.equal(out, "'2026-05-24'")
  })

  test('substitutes start_t / end_t HH.MM → HH:MM', ({ assert }) => {
    const out = ReportRunner.processSql(
      'BETWEEN @start_t AND @end_t',
      { start_t: '08.00', end_t: '16.30' }
    )
    assert.equal(out, "BETWEEN '08:00' AND '16:30'")
  })

  test('substitutes simple text params with SQL-quote escaping', ({ assert }) => {
    const out = ReportRunner.processSql("WHERE an = @an", { an: "O'Brien" })
    assert.equal(out, "WHERE an = 'O''Brien'")
  })

  test('@main_dep "all" → BETWEEN', ({ assert }) => {
    const out = ReportRunner.processSql('AND main_dep @main_dep', { main_dep: 'all' })
    assert.equal(out, "AND main_dep BETWEEN '0' AND '999'")
  })

  test('@main_dep specific value → =', ({ assert }) => {
    const out = ReportRunner.processSql('AND main_dep @main_dep', { main_dep: '12' })
    assert.equal(out, "AND main_dep = '12'")
  })

  test('@spclty "00" → IN list', ({ assert }) => {
    const out = ReportRunner.processSql('AND spclty @spclty', { spclty: '00' })
    assert.match(out, /AND spclty IN \('01','02'.*'20'\)/)
  })

  test('@dayofweek used as raw comma-separated', ({ assert }) => {
    const out = ReportRunner.processSql('AND DAYOFWEEK(d) IN (@dayofweek)', { dayofweek: '2,3,4' })
    assert.equal(out, 'AND DAYOFWEEK(d) IN (2,3,4)')
  })

  test('generic param: numeric value passes bare', ({ assert }) => {
    const out = ReportRunner.processSql('AND age = @age', { age: '42' })
    assert.equal(out, 'AND age = 42')
  })

  test('generic param: string value gets quoted + escaped', ({ assert }) => {
    const out = ReportRunner.processSql("AND name = @name", { name: "it's" })
    assert.equal(out, "AND name = 'it''s'")
  })

  test('generic param: empty value → empty quoted string', ({ assert }) => {
    const out = ReportRunner.processSql('AND code = @code', { code: '' })
    assert.equal(out, "AND code = ''")
  })

  test('does not substitute @@variable (MySQL session var)', ({ assert }) => {
    // Generic substitution only kicks in for keys present in `parameters`.
    // The detector also strips @@ before scanning — here we just verify the
    // raw substitution path doesn't touch @@ tokens.
    const out = ReportRunner.processSql('SELECT @@version', { version: 'bogus' })
    assert.equal(out, 'SELECT @@version')
  })
})

test.group('ReportRunner.detectParameters', () => {
  test('finds single @token', ({ assert }) => {
    assert.deepEqual(ReportRunner.detectParameters('SELECT @x FROM t'), ['x'])
  })

  test('dedupes repeated tokens', ({ assert }) => {
    assert.deepEqual(
      ReportRunner.detectParameters('WHERE a = @x AND b = @x AND c = @y'),
      ['x', 'y']
    )
  })

  test('ignores MySQL @@variables', ({ assert }) => {
    assert.deepEqual(ReportRunner.detectParameters('SELECT @@version FROM dual'), [])
  })

  test('ignores tokens inside string literals', ({ assert }) => {
    assert.deepEqual(
      ReportRunner.detectParameters("SELECT 'literal with @fake' FROM t WHERE x = @real"),
      ['real']
    )
  })

  test('handles empty / null input', ({ assert }) => {
    assert.deepEqual(ReportRunner.detectParameters(''), [])
    assert.deepEqual(ReportRunner.detectParameters(null as any), [])
  })
})

test.group('ReportRunner.validate', () => {
  const mkParam = (overrides: Partial<ReportParameter>): ReportParameter =>
    ({
      paramName: 'x',
      paramLabel: 'X',
      paramType: 'text',
      paramRequired: false,
      ...overrides,
    }) as any

  test('returns error when required param missing', ({ assert }) => {
    const errors = ReportRunner.validate({}, [mkParam({ paramRequired: true, paramLabel: 'วันที่' })])
    assert.lengthOf(errors, 1)
    assert.include(errors[0], "'วันที่' จำเป็นต้องกรอก")
  })

  test('accepts non-empty required param', ({ assert }) => {
    assert.lengthOf(
      ReportRunner.validate({ x: '2026-05-24' }, [mkParam({ paramRequired: true })]),
      0
    )
  })

  test('rejects non-numeric for type=number', ({ assert }) => {
    const errors = ReportRunner.validate({ x: 'abc' }, [mkParam({ paramType: 'number', paramLabel: 'อายุ' })])
    assert.lengthOf(errors, 1)
    assert.include(errors[0], "'อายุ' ต้องเป็นตัวเลข")
  })

  test('accepts numeric for type=number', ({ assert }) => {
    assert.lengthOf(
      ReportRunner.validate({ x: '42' }, [mkParam({ paramType: 'number' })]),
      0
    )
  })

  test('rejects invalid date for type=date', ({ assert }) => {
    const errors = ReportRunner.validate({ x: 'not-a-date' }, [mkParam({ paramType: 'date', paramLabel: 'วันที่' })])
    assert.lengthOf(errors, 1)
  })

  test('accepts dd/mm/yyyy and ISO date', ({ assert }) => {
    assert.lengthOf(ReportRunner.validate({ x: '24/05/2026' }, [mkParam({ paramType: 'date' })]), 0)
    assert.lengthOf(ReportRunner.validate({ x: '2026-05-24' }, [mkParam({ paramType: 'date' })]), 0)
  })
})
