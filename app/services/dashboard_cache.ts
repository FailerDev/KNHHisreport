/**
 * Tiny in-process cache for the dashboard hydration payload.
 *
 * Mirrors the 90-second file cache from the legacy PHP app
 * (`includes/dashboard_data.php`). Pulled out into its own module so the
 * settings controller can invalidate it after CUD operations — otherwise
 * admins would see stale data for up to 90 seconds after editing a tile.
 *
 * Single-process only. Switch to @adonisjs/cache when we need multi-instance.
 */
class DashboardCache<T> {
  private payload: T | null = null
  private timestamp = 0
  // Bumped on every invalidate() so a payload computed from pre-edit data
  // can't be written back after an admin edit (see set()).
  private generation = 0
  public readonly ttlMs: number

  constructor(ttlSeconds = 90) {
    this.ttlMs = ttlSeconds * 1000
  }

  get(): { data: T; ageSeconds: number } | null {
    if (this.payload === null) return null
    const age = Date.now() - this.timestamp
    if (age >= this.ttlMs) return null
    return { data: this.payload, ageSeconds: Math.floor(age / 1000) }
  }

  /** Capture before computing a payload; pass to set(). */
  currentGeneration(): number {
    return this.generation
  }

  /** Stores the payload unless the cache was invalidated since `generation`. */
  set(payload: T, generation = this.generation): boolean {
    if (generation !== this.generation) return false
    this.payload = payload
    this.timestamp = Date.now()
    return true
  }

  invalidate(): void {
    this.payload = null
    this.timestamp = 0
    this.generation++
  }
}

// One cache per app — shared between dashboard hydration + admin invalidation.
const dashboardDataCache = new DashboardCache<any>(90)

export default dashboardDataCache
