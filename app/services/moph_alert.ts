/**
 * MOPH Alert client — sends a LINE message (หมอพร้อม) to a person by citizen
 * ID. Used for LINE OTP in 2FA. This is a different API/key pair from MOPH
 * Notify (#services/moph_notify), which posts into a LINE room.
 * Ported from 99CLAIM app/services/moph_otp_service.ts.
 */

export interface MophAlertConfig {
  apiUrl: string
  clientKey: string
  secretKey: string
  systemName: string
}

export interface MophAlertResult {
  success: boolean
  message: string | null
}

export async function sendMophOtp(
  cid: string,
  code: string,
  config: MophAlertConfig
): Promise<MophAlertResult> {
  if (!config.apiUrl || !config.clientKey || !config.secretKey) {
    return { success: false, message: 'ยังไม่ได้ตั้งค่า MOPH Alert API — ติดต่อผู้ดูแลระบบ' }
  }

  const title = `[${config.systemName}] รหัสยืนยันการเข้าสู่ระบบ`
  const text = `${title}\nOTP: ${code}\nรหัสมีอายุ 5 นาที ห้ามบอกรหัสนี้กับผู้อื่น`
  const payload = {
    cid: [cid],
    messages: [{ type: 'text', text }],
    message_title: title,
    message_text: code,
    message_html: `<div><strong>${title}</strong></div><div>OTP: ${code}</div><div>รหัสมีอายุ 5 นาที ห้ามบอกรหัสนี้กับผู้อื่น</div>`,
    message_type: 'HPT',
  }

  let res: Response
  try {
    res = await fetch(config.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'client-key': config.clientKey,
        'secret-key': config.secretKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err) {
    return { success: false, message: `ส่งไม่สำเร็จ: ${(err as Error).message}` }
  }

  if (!res.ok) return { success: false, message: `MOPH Alert API ตอบกลับ HTTP ${res.status}` }

  const body = (await res.json().catch(() => null)) as {
    message_code?: number
    message?: string
    app_message?: string
  } | null
  if (body && typeof body.message_code === 'number' && body.message_code !== 200) {
    return { success: false, message: body.message ?? body.app_message ?? 'MOPH Alert API ปฏิเสธคำขอ' }
  }
  return { success: true, message: null }
}
