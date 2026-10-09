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
const ReportRequestsController = () => import('#controllers/report_requests_controller')
const AdminReportRequestsController = () => import('#controllers/admin_report_requests_controller')
const NotificationsController = () => import('#controllers/notifications_controller')
const SettingsController = () => import('#controllers/settings_controller')
const NotificationSettingsController = () => import('#controllers/notification_settings_controller')
const TwoFactorController = () => import('#controllers/two_factor_controller')
const AccountSecurityController = () => import('#controllers/account_security_controller')
const SecuritySettingsController = () => import('#controllers/security_settings_controller')

router.get('/', async ({ view, auth }) => {
  await auth.check()
  // Not behind the auth middleware, so feed the topbar bell here too.
  if (auth.user) {
    const { unreadNotifications } = await import('#services/notifier')
    view.share({ notifications: await unreadNotifications(auth.user.id) })
  }
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

// 2FA — second login step + enrolment. No middleware: the controller serves
// either the user parked mid-login (session `twofa.pending`) or a signed-in user.
router.get('/2fa/verify', [TwoFactorController, 'showVerify']).as('twofa.verify.show')
router.post('/2fa/verify', [TwoFactorController, 'verify']).as('twofa.verify')
router.post('/2fa/verify/line', [TwoFactorController, 'sendVerifyLine']).as('twofa.verify.line')
router.post('/2fa/cancel', [TwoFactorController, 'cancel']).as('twofa.cancel')
router.get('/2fa/setup', [TwoFactorController, 'showSetup']).as('twofa.setup.show')
router.post('/2fa/setup/totp', [TwoFactorController, 'confirmTotp']).as('twofa.setup.totp')
router.post('/2fa/setup/line/send', [TwoFactorController, 'sendSetupLine']).as('twofa.setup.line.send')
router.post('/2fa/setup/line', [TwoFactorController, 'confirmLine']).as('twofa.setup.line')
router.get('/2fa/recovery-codes', [TwoFactorController, 'showRecoveryCodes']).as('twofa.recoveryCodes').use(middleware.auth())

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

    // In-app user manual (admin chapters are shown to admins only)
    router.get('/manual', async ({ view }) => view.render('pages/manual')).as('manual')

    // Data/report requests (requester side)
    // The signed-in user's own 2FA
    router.get('/account/security', [AccountSecurityController, 'show']).as('account.security')
    router.post('/account/security/recovery-codes', [AccountSecurityController, 'regenerateCodes'])
    router.post('/account/security/disable', [AccountSecurityController, 'disable'])

    router.get('/requests', [ReportRequestsController, 'index']).as('requests.index')
    router.get('/requests/create', [ReportRequestsController, 'create']).as('requests.create')
    router.post('/requests', [ReportRequestsController, 'store']).as('requests.store')
    router.get('/requests/files/:fileId', [ReportRequestsController, 'download']).as('requests.download').where('fileId', router.matchers.number())
    router.get('/requests/:id', [ReportRequestsController, 'show']).as('requests.show').where('id', router.matchers.number())
    router.get('/notifications/:id', [NotificationsController, 'open']).as('notifications.open').where('id', router.matchers.number())
    router.post('/notifications/read-all', [NotificationsController, 'readAll']).as('notifications.readAll')
    router.post('/requests/:id/cancel', [ReportRequestsController, 'cancel']).as('requests.cancel').where('id', router.matchers.number())
  })
  .use(middleware.auth())

router
  .group(() => {
    router.get('/admin/users', [UsersController, 'index']).as('admin.users.index')
    router.post('/admin/users', [UsersController, 'store']).as('admin.users.store')
    router.post('/admin/users/update', [UsersController, 'update']).as('admin.users.update')
    router.post('/admin/users/reset-password', [UsersController, 'resetPassword']).as('admin.users.resetPassword')
    router.post('/admin/users/delete', [UsersController, 'destroy']).as('admin.users.destroy')
    router.post('/admin/users/two-factor', [UsersController, 'twoFactor']).as('admin.users.twoFactor')

    router.get('/admin/security-settings', [SecuritySettingsController, 'show']).as('admin.securitySettings')
    router.post('/admin/security-settings', [SecuritySettingsController, 'save'])
    router.post('/admin/security-settings/unlock', [SecuritySettingsController, 'unlock'])

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

    // Data/report requests (admin / งานสารสนเทศ)
    router.get('/admin/settings', [SettingsController, 'index']).as('admin.settings')
    router.get('/admin/notification-settings', [NotificationSettingsController, 'show']).as('admin.notificationSettings')
    router.post('/admin/notification-settings', [NotificationSettingsController, 'save'])
    router.post('/admin/notification-settings/test-line', [NotificationSettingsController, 'testLine'])

    router.get('/admin/requests', [AdminReportRequestsController, 'index']).as('admin.requests.index')
    router.get('/admin/requests/report-params/:reportId', [AdminReportRequestsController, 'reportParams']).where('reportId', router.matchers.number())
    router
      .group(() => {
        router.get('/', [AdminReportRequestsController, 'show']).as('admin.requests.show')
        router.post('/approve', [AdminReportRequestsController, 'approve'])
        router.post('/reject', [AdminReportRequestsController, 'reject'])
        router.post('/upload', [AdminReportRequestsController, 'upload'])
        router.post('/generate', [AdminReportRequestsController, 'generate'])
        router.post('/run-sql', [AdminReportRequestsController, 'runSql'])
        router.post('/promote', [AdminReportRequestsController, 'promote'])
        router.post('/complete', [AdminReportRequestsController, 'complete'])
        router.post('/files/:fileId/delete', [AdminReportRequestsController, 'destroyFile'])
      })
      .prefix('/admin/requests/:id')
      .where('id', router.matchers.number())
  })
  .use([middleware.auth(), middleware.admin()])
