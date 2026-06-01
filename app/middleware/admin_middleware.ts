import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import User from '#models/user'

/**
 * Admin gate — only allow users whose userLevel === 'admin'.
 * Must run AFTER auth middleware so ctx.auth.user is populated.
 */
export default class AdminMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const user = ctx.auth.user as User | undefined
    if (!user || user.userLevel !== 'admin') {
      return ctx.response.redirect('/reports')
    }
    return next()
  }
}
