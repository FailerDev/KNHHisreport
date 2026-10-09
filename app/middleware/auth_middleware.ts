import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import type { Authenticators } from '@adonisjs/auth/types'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import type User from '#models/user'
import { unreadNotifications } from '#services/notifier'

export default class AuthMiddleware {
  redirectTo = '/login'

  async handle(
    ctx: HttpContext,
    next: NextFn,
    options: {
      guards?: (keyof Authenticators)[]
    } = {}
  ) {
    await ctx.auth.authenticateUsing(options.guards, { loginRoute: this.redirectTo })
    if (ctx.request.method() === 'GET') await this.shareNotifications(ctx)
    return next()
  }

  /** Feed the topbar bell on every authenticated page render. */
  private async shareNotifications(ctx: HttpContext) {
    const user = ctx.auth.user as User | undefined
    if (!user || !('view' in ctx)) return
    try {
      ctx.view.share({ notifications: await unreadNotifications(user.id) })
      if (user.isAdmin) {
        const [row] = await db
          .from('report_requests')
          .where('status', 'pending')
          .count('* as total')
        ctx.view.share({ pendingRequests: Number(row?.total ?? 0) })
      }
    } catch (err: any) {
      logger.warn({ err: err?.message ?? String(err) }, 'load notifications failed')
    }
  }
}
