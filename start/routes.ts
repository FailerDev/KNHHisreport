import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

const AuthController = () => import('#controllers/auth_controller')
const UsersController = () => import('#controllers/users_controller')
const HisSettingsController = () => import('#controllers/his_settings_controller')
const ReportsController = () => import('#controllers/reports_controller')
const ReportSettingsController = () => import('#controllers/report_settings_controller')
const ReportParametersController = () => import('#controllers/report_parameters_controller')
const DashboardController = () => import('#controllers/dashboard_controller')
const DashboardSettingsController = () => import('#controllers/dashboard_settings_controller')
const HealthController = () => import('#controllers/health_controller')

router.get('/', async ({ view, auth }) => {
  await auth.check()
  return view.render('pages/home', { user: auth.user })
})
router.get('/health', [HealthController, 'show']).as('health')

router
  .group(() => {
    router.get('/login', [AuthController, 'showLogin']).as('auth.showLogin')
    router.post('/login', [AuthController, 'login']).as('auth.login')
    router.get('/register', [AuthController, 'showRegister']).as('auth.showRegister')
    router.post('/register', [AuthController, 'register']).as('auth.register')
  })
  .use(middleware.guest())

router.get('/logout', [AuthController, 'logout']).use(middleware.auth())
router.post('/logout', [AuthController, 'logout']).as('auth.logout').use(middleware.auth())

router
  .group(() => {
    router.get('/admin/dashboard', async ({ view, auth }) => {
      return view.render('pages/dashboard', { user: auth.user, isAdmin: true })
    })
    router.get('/dashboard', [DashboardController, 'index']).as('dashboard.index')
    router.get('/dashboard/data', [DashboardController, 'data']).as('dashboard.data')
    router.get('/reports', [ReportsController, 'index']).as('reports.index')
    router.get('/reports/:id', [ReportsController, 'show']).as('reports.show')
    router.post('/reports/:id', [ReportsController, 'run']).as('reports.run')
    router.post('/reports/:id/export', [ReportsController, 'export']).as('reports.export')
  })
  .use(middleware.auth())

router
  .group(() => {
    router.get('/admin/users', [UsersController, 'index']).as('admin.users.index')
    router.post('/admin/users', [UsersController, 'store']).as('admin.users.store')
    router.post('/admin/users/update', [UsersController, 'update']).as('admin.users.update')
    router.post('/admin/users/reset-password', [UsersController, 'resetPassword']).as('admin.users.resetPassword')
    router.post('/admin/users/delete', [UsersController, 'destroy']).as('admin.users.destroy')

    router.get('/admin/his-settings', [HisSettingsController, 'show']).as('admin.his.show')
    router.post('/admin/his-settings', [HisSettingsController, 'save']).as('admin.his.save')
    router.post('/admin/his-settings/test', [HisSettingsController, 'test']).as('admin.his.test')

    // Report settings: categories + reports CRUD
    router.get('/admin/report-settings', [ReportSettingsController, 'index']).as('admin.reportSettings.index')
    router.post('/admin/report-settings/heads', [ReportSettingsController, 'storeHead'])
    router.post('/admin/report-settings/heads/update', [ReportSettingsController, 'updateHead'])
    router.post('/admin/report-settings/heads/delete', [ReportSettingsController, 'destroyHead'])
    router.post('/admin/report-settings/reports', [ReportSettingsController, 'storeDetail'])
    router.post('/admin/report-settings/reports/update', [ReportSettingsController, 'updateDetail'])
    router.post('/admin/report-settings/reports/delete', [ReportSettingsController, 'destroyDetail'])
    router.post('/admin/report-settings/test-sql', [ReportSettingsController, 'testSql']).as('admin.reportSettings.testSql')

    // Dashboard settings (admin CRUD for the widget tiles)
    router.get('/admin/dashboard-settings', [DashboardSettingsController, 'index']).as('admin.dashboardSettings.index')
    router.post('/admin/dashboard-settings', [DashboardSettingsController, 'store'])
    router.post('/admin/dashboard-settings/update', [DashboardSettingsController, 'update'])
    router.post('/admin/dashboard-settings/delete', [DashboardSettingsController, 'destroy'])
    router.post('/admin/dashboard-settings/test-sql', [DashboardSettingsController, 'testSql']).as('admin.dashboardSettings.testSql')

    // Report parameters
    router.get('/admin/reports/:reportId/parameters', [ReportParametersController, 'index']).as('admin.parameters.index')
    router.post('/admin/reports/:reportId/parameters', [ReportParametersController, 'store'])
    router.post('/admin/reports/:reportId/parameters/auto-detect', [ReportParametersController, 'autoDetect'])
    router.post('/admin/parameters/update', [ReportParametersController, 'update'])
    router.post('/admin/parameters/delete', [ReportParametersController, 'destroy'])
  })
  .use([middleware.auth(), middleware.admin()])
