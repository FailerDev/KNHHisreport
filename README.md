# HisReport

ระบบรายงานข้อมูลจาก HIS (Hospital Information System) ของโรงพยาบาล พัฒนาด้วย AdonisJS v6 + TypeScript
ดึงข้อมูลจากฐานข้อมูล HIS (HOSxP) แบบอ่านอย่างเดียว แสดงผลแบบ server-side render

คู่มือการใช้งานสำหรับผู้ใช้และผู้ดูแลระบบอยู่ในตัวระบบที่หน้า **`/manual`** (หรือกดไอคอน ❓ ที่แถบด้านบน)

---

## ความสามารถหลัก

| โมดูล | รายละเอียด |
|---|---|
| **แดชบอร์ด** | ตัวชี้วัดและกราฟสรุปจาก HIS — ผู้ดูแลกำหนด SQL ของแต่ละรายการได้เอง |
| **รายงาน** | แยกตามหมวด ค้นหาได้ กรอกพารามิเตอร์ (วันที่ แผนก ฯลฯ) แล้วประมวลผล ส่งออก Excel และพิมพ์ |
| **ขอข้อมูล/รายงาน** | ผู้ใช้ส่งคำขอข้อมูลถึงงานสารสนเทศ ได้เลขที่ `REQ-<ปีงบ>-0001` ติดตามสถานะ และดาวน์โหลดไฟล์ผลลัพธ์ |
| **จัดการคำขอ (admin)** | อนุมัติ/ไม่อนุมัติ แนบไฟล์ สร้างไฟล์จากรายงานในระบบ หรือรัน SQL เอง แล้วบันทึกเป็นรายงานถาวรได้ |
| **การแจ้งเตือน** | กระดิ่งในระบบ + ห้อง LINE งานสารสนเทศผ่าน MOPH Notify (หมอพร้อม) |
| **PDPA** | คำขอข้อมูลรายบุคคลต้องระบุวัตถุประสงค์ ไฟล์ถูกลบอัตโนมัติหลังปิดงานตามจำนวนวันที่กำหนด บันทึกทุกการดาวน์โหลด |
| **ความปลอดภัย** | ล็อกการเข้าสู่ระบบเมื่อกรอกผิดหลายครั้ง (ต่อชื่อผู้ใช้/ต่อ IP), 2FA ด้วยแอป Authenticator หรือ OTP ทาง LINE (MOPH Alert), รหัสสำรอง |
| **ผู้ใช้และสิทธิ์** | สมัครเอง → ผู้ดูแลอนุมัติ, สิทธิ์ผู้ใช้ทั่วไป/ผู้ดูแลระบบ, นโยบาย 2FA รายคน, รีเซ็ตรหัสผ่าน |
| **ตั้งค่าระบบ** | หน้า `/admin/settings` รวมทุกการตั้งค่า พร้อมสถานะปัจจุบัน (HIS เชื่อมต่อได้หรือไม่, 2FA, LINE) |
| **Audit Log** | บันทึกการกระทำสำคัญของผู้ใช้และผู้ดูแล |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | AdonisJS v6 (TypeScript) |
| Template | Edge.js (SSR) + HIC design system (`public/ui/hic.css`) |
| Frontend | Vite, Tailwind (CDN), Font Awesome |
| ORM | Lucid (MySQL2) |
| Auth | AdonisJS Auth (session) + TOTP 2FA |
| Validation | VineJS |
| Excel | ExcelJS |
| Tests | Japa (functional + unit) |

---

## Database

ใช้ MySQL/MariaDB **2 connection**:

| Connection | หน้าที่ | หมายเหตุ |
|---|---|---|
| `mysql` | App DB (`hisreport`) | ผู้ใช้ รายงาน แดชบอร์ด คำขอข้อมูล การตั้งค่า audit log |
| `his` | HIS DB (HOSxP) | **อ่านอย่างเดียว** — ค่าการเชื่อมต่อตั้งจากหน้า `/admin/his-settings` (เก็บในตาราง `his_settings`) |

- ตารางเดิม (`users`, `report_head`, `report_head_detail`, `report_parameters`, `bpdashboard_head_index`) มาจากระบบ PHP HisReport และต้องมีอยู่แล้ว
- ตารางใหม่ของระบบนี้สร้างด้วย migration (`database/migrations/`)
- ควรใช้ MySQL user ของ HIS ที่มีสิทธิ์ `SELECT` อย่างเดียว — SQL ของรายงาน/แดชบอร์ดรันด้วย user นี้ ระบบกัน SQL ที่ไม่ใช่ `SELECT` ไว้อีกชั้นหนึ่ง

---

## Requirements

- Node.js 22 ขึ้นไป
- MySQL 8 / MariaDB
- npm 10 ขึ้นไป

---

## ติดตั้ง

```bash
# 1. clone repo
git clone https://github.com/FailerDev/KNHHisreport.git
cd KNHHisreport

# 2. ติดตั้ง dependencies
npm install

# 3. ตั้งค่า environment
cp .env.example .env
# แก้ไข .env ให้ตรงกับเครื่อง (ดูหัวข้อ Environment Variables)

# 4. สร้าง APP_KEY
node ace generate:key

# 5. สร้าง/อัปเดตตารางของระบบ
node ace migration:run --force
```

จากนั้นเข้าระบบด้วยบัญชีผู้ดูแล แล้วตั้งค่าตามลำดับ: **HIS Database → รายงาน/พารามิเตอร์ → แดชบอร์ด → ผู้ใช้ → การแจ้งเตือน → ความปลอดภัย**

---

## Environment Variables

ดูค่าทั้งหมดใน [.env.example](.env.example)

| ตัวแปร | จำเป็น | หมายเหตุ |
|---|---|---|
| `NODE_ENV` | ✓ | `development` / `production` |
| `PORT`, `HOST` | ✓ | ค่าเริ่มต้น `3333`, `0.0.0.0` |
| `APP_KEY` | ✓ | สร้างด้วย `node ace generate:key` — ห้ามใช้ร่วมกันหลายเครื่อง |
| `SESSION_DRIVER` | ✓ | `cookie` |
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_DATABASE` | ✓ | App DB |
| `TZ` | | แนะนำ `Asia/Bangkok` |
| `HIS_DB_*` | | ค่าเริ่มต้นของ HIS — ค่าที่ตั้งในหน้าเว็บจะใช้แทน |
| `APP_URL` | | URL ของระบบ ใช้ทำลิงก์/ปุ่มในข้อความ LINE |
| `MOPH_NOTIFY_*` | | key ของห้อง LINE — ตั้งในหน้า **ตั้งค่าระบบ > การแจ้งเตือน** แทนได้ |
| `REQUEST_FILE_RETENTION_DAYS` | | วันที่เก็บไฟล์คำขอข้อมูลรายบุคคลหลังปิดงาน (ค่าเริ่มต้น 30) |
| `REQUEST_STORAGE_PATH` | production | โฟลเดอร์เก็บไฟล์คำขอ **ต้องอยู่นอก `build/`** ไม่งั้น `node ace build` จะลบไฟล์ทิ้ง |

---

## Development

```bash
npm run dev        # dev server + HMR (http://localhost:3333)
npm run typecheck  # ตรวจ TypeScript
npm run lint       # ESLint
npm run format     # Prettier
npm test           # รันเทสต์
```

> เทสต์ใช้ฐานข้อมูลจริงตาม `.env.test` — ถ้า `npm run dev` เปิดอยู่ที่พอร์ต 3333 ให้รันเทสต์บนพอร์ตอื่น:
> `PORT=3344 node ace test`

---

## Production

```bash
node ace build                 # build ไปที่ ./build
node build/bin/server.js       # หรือใช้ pm2 / systemd
```

**อัปเดตเวอร์ชันบนเซิร์ฟเวอร์**

```bash
git pull origin main
npm ci                           # ต้องมี devDependencies เพราะ build ใช้ @adonisjs/assembler + vite
node ace migration:run --force   # เมื่อมี migration ใหม่
node ace build
pm2 restart hisreport            # หรือ systemctl restart hisreport
```

**งานตั้งเวลา (วันละครั้ง)** — ลบไฟล์คำขอข้อมูลรายบุคคลที่ครบกำหนด (PDPA) ด้วย Windows Task Scheduler หรือ cron:

```bash
node ace requests:purge-files
```

รายละเอียด reverse proxy, pm2/systemd และ rollback ดู [DEPLOY.md](DEPLOY.md) และ [CUTOVER.md](CUTOVER.md)

---

## Project Structure

```
app/
├── controllers/     # route handlers (auth, reports, dashboard, requests, settings, 2FA, ...)
├── models/          # Lucid models (User, ReportHead, ReportRequest, Notification, ...)
├── services/        # business logic (his_db, report_runner, report_request_*, notifier, two_factor, ...)
├── middleware/      # auth, admin, guest
├── validators/      # VineJS validators
└── exceptions/      # error handlers

commands/            # ace commands (requests:purge-files)
database/migrations/ # ตารางของระบบนี้
config/              # database, session, shield, auth, ...
start/               # routes, env validation, view globals
resources/views/     # Edge templates (pages/, partials/, layouts/)
public/ui/           # HIC design system (hic.css, hic.js)
tests/               # functional + unit tests
scripts/             # preflight / cutover / rollback
```

---

## License

Private — ใช้งานภายในองค์กรเท่านั้น
