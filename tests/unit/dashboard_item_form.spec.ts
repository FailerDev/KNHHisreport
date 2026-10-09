import { test } from '@japa/runner'
import {
  buildDashboardItemAttributes,
  normalizeIcon,
  sqlToVerify,
  type DashboardItemInput,
} from '#services/dashboard_item_form'
import dashboardDataCache from '#services/dashboard_cache'

const base: DashboardItemInput = {
  detail: 'ทันตกรรม',
  sql1: 'SELECT COUNT(*) FROM dtmain',
  sort: 6,
  link_id: '593',
  icons: 'ti-pencil-alt',
  color1: 'icon-warning',
  chart_type: 'none',
  chart_name: 'ทันตกรรม',
  chart_sql: null,
  chart_color: 'default',
}

// Shape of legacy row id=5 in bpdashboard_head_index.
const legacy = {
  sql1: 'SELECT COUNT(*) FROM dtmain;',
  color1: 'icon-warning',
  pieShow: 'y',
  chartType: 'none',
  chartSql: null,
}

test.group('dashboard_item_form — normalizeIcon', () => {
  test('{$self.in} → {$self.out}')
    .with([
      { in: 'users', out: 'fa-users' },
      { in: ' fa-users ', out: 'fa-users' },
      { in: 'fas fa-users', out: 'fas fa-users' },
      { in: 'ti-truck', out: 'ti-truck' },
      { in: '', out: 'ti-bar-chart' },
      { in: null, out: 'ti-bar-chart' },
    ])
    .run(({ assert }, row) => {
      assert.equal(normalizeIcon(row.in), row.out)
    })
})

test.group('dashboard_item_form — buildDashboardItemAttributes', () => {
  test('empty sort is stored as NULL (hidden), not forced to 1', ({ assert }) => {
    assert.isNull(buildDashboardItemAttributes({ ...base, sort: null }, legacy).sort)
    assert.isNull(buildDashboardItemAttributes({ ...base, sort: undefined }).sort)
    assert.equal(buildDashboardItemAttributes(base).sort, 6)
  })

  test('editing a legacy row with no chart keeps pie_show and pie_name', ({ assert }) => {
    const attrs = buildDashboardItemAttributes(base, legacy)
    assert.equal(attrs.pieShow, 'y')
    assert.equal(attrs.pieName, 'ทันตกรรม')
  })

  test('new tile without chart gets pie_show = n', ({ assert }) => {
    assert.equal(buildDashboardItemAttributes(base).pieShow, 'n')
  })

  test('turning a chart off keeps its SQL and colour for later', ({ assert }) => {
    const attrs = buildDashboardItemAttributes(
      { ...base, chart_type: 'none', chart_sql: 'SELECT a, b FROM t', chart_color: 'red' },
      { ...legacy, chartType: 'bar', chartSql: 'SELECT a, b FROM t' }
    )
    assert.equal(attrs.chartType, 'none')
    assert.equal(attrs.chartSql, 'SELECT a, b FROM t')
    assert.equal(attrs.chartColor, 'red')
  })

  test('chart on sets pie_show = y', ({ assert }) => {
    const attrs = buildDashboardItemAttributes({ ...base, chart_type: 'pie', chart_sql: 'SELECT a, b FROM t' }, { ...legacy, pieShow: 'n' })
    assert.equal(attrs.pieShow, 'y')
  })

  test('missing colour keeps the stored one; blank link becomes NULL', ({ assert }) => {
    const attrs = buildDashboardItemAttributes({ ...base, color1: undefined, link_id: '  ' }, { ...legacy, color1: 'icon-danger' })
    assert.equal(attrs.color1, 'icon-danger')
    assert.isNull(attrs.linkId)
  })
})

test.group('dashboard_item_form — sqlToVerify', () => {
  test('new item: main SQL always checked; chart only when enabled', ({ assert }) => {
    assert.deepEqual(sqlToVerify(base), { main: true, chart: false })
    assert.deepEqual(sqlToVerify({ ...base, chart_type: 'bar', chart_sql: 'SELECT a,b FROM t' }), { main: true, chart: true })
  })

  test('unchanged SQL (ignoring trailing ;) is not re-run', ({ assert }) => {
    assert.deepEqual(sqlToVerify(base, legacy), { main: false, chart: false })
  })

  test('changed main SQL is re-run', ({ assert }) => {
    assert.deepEqual(sqlToVerify({ ...base, sql1: 'SELECT 2' }, legacy), { main: true, chart: false })
  })

  test('enabling a chart re-runs its SQL even if the text is unchanged', ({ assert }) => {
    const existing = { ...legacy, chartSql: 'SELECT a,b FROM t' }
    assert.deepEqual(sqlToVerify({ ...base, chart_type: 'pie', chart_sql: 'SELECT a,b FROM t' }, existing), { main: false, chart: true })
    assert.deepEqual(
      sqlToVerify({ ...base, chart_type: 'pie', chart_sql: 'SELECT a,b FROM t' }, { ...existing, chartType: 'bar' }),
      { main: false, chart: false }
    )
  })
})

test.group('dashboard_cache — invalidation race', () => {
  test('a payload computed before invalidate() is not cached', ({ assert }) => {
    dashboardDataCache.invalidate()
    const gen = dashboardDataCache.currentGeneration()
    dashboardDataCache.invalidate() // admin edits while /dashboard/data is computing
    assert.isFalse(dashboardDataCache.set({ stale: true }, gen))
    assert.isNull(dashboardDataCache.get())

    const fresh = dashboardDataCache.currentGeneration()
    assert.isTrue(dashboardDataCache.set({ stale: false }, fresh))
    assert.deepEqual(dashboardDataCache.get()?.data, { stale: false })
    dashboardDataCache.invalidate()
  })
})
