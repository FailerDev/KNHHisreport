import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * PDPA retention for the report-request module: delete result files of
 * identifiable (รายบุคคล) requests that were completed more than N days ago.
 *
 * Schedule once a day, e.g. Windows Task Scheduler:
 *   node ace requests:purge-files
 * or cron:
 *   15 2 * * *  cd /path/to/app && node ace requests:purge-files
 */
export default class PurgeRequestFiles extends BaseCommand {
  static commandName = 'requests:purge-files'
  static description = 'ลบไฟล์ผลลัพธ์ของคำขอข้อมูลรายบุคคลที่ปิดงานเกินระยะเวลาจัดเก็บ (PDPA)'

  static options: CommandOptions = {
    startApp: true,
  }

  @flags.number({
    description: 'จำนวนวันหลังปิดงาน (ค่าเริ่มต้นจากหน้าตั้งค่าการแจ้งเตือน หรือ 30)',
  })
  declare days?: number

  @flags.boolean({ description: 'แสดงรายการที่จะลบ โดยไม่ลบจริง' })
  declare dryRun: boolean

  async run() {
    const { purgeExpiredFiles, retentionDays } = await import('#services/report_request_service')
    const days = this.days && this.days > 0 ? this.days : await retentionDays()

    const result = await purgeExpiredFiles({ days, dryRun: !!this.dryRun })
    if (result.reqNos.length === 0) {
      this.logger.info(`ไม่มีคำขอที่ครบกำหนดลบไฟล์ (ระยะเก็บ ${days} วัน)`)
      return
    }
    const verb = this.dryRun ? 'จะลบ' : 'ลบแล้ว'
    this.logger.success(
      `${verb} ${result.files} ไฟล์ จาก ${result.reqNos.length} คำขอ: ${result.reqNos.join(', ')}`
    )
  }
}
