# HisReport

ระบบรายงานข้อมูลจาก HIS (Hospital Information System) พัฒนาด้วย AdonisJS v6 + TypeScript  
รองรับการเชื่อมต่อ HIS Database หลายโรงพยาบาล และแสดงผลรายงานแบบ server-side render

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | AdonisJS v6 (TypeScript) |
| Template | Edge.js (SSR) |
| Frontend | Vite + CSS |
| ORM | Lucid (MySQL2) |
| Auth | AdonisJS Auth (session-based) |
| Validation | VineJS |

---

## Database

โปรเจกต์ใช้ MySQL **2 connection**:

| Connection | ชื่อ | หมายเหตุ |
|---|---|---|
| `mysql` | App DB | เก็บ users, settings, audit logs |
| `his` | HIS DB | อ่านอย่างเดียว — ดึงข้อมูลรายงาน |

> HIS DB credentials เก็บใน `his_settings` table ซึ่งตั้งค่าผ่านหน้า Admin ของระบบ

---

## Requirements

- Node.js >= 20
- MySQL >= 8.0
- npm >= 10

---

## Installation

```bash
# 1. clone repo
git clone https://github.com/ReyFailer/KNHHisreport.git
cd KNHHisreport

# 2. install dependencies
npm install

# 3. ตั้งค่า environment
cp .env.example .env
# แก้ไข .env ให้ตรงกับ server

# 4. สร้าง APP_KEY
node ace generate:key

# 5. สร้าง database schema
mysql -u root -p hisreport < database/schema.sql
```

---

## Environment Variables

ดู [.env.example](.env.example) สำหรับค่าทั้งหมด ตัวแปรหลักที่ต้องกำหนด:

```env
APP_KEY=          # สร้างด้วย: node ace generate:key
DB_HOST=          # MySQL host ของ app database
DB_USER=          # MySQL user
DB_PASSWORD=      # MySQL password
DB_DATABASE=      # ชื่อ database (เช่น hisreport)
```

---

## Development

```bash
npm run dev        # start dev server พร้อม HMR
npm run typecheck  # ตรวจ TypeScript
npm run lint       # ESLint
npm run format     # Prettier
npm run test       # run tests
```

---

## Production Build

```bash
npm run build              # build ไปที่ ./build
node build/bin/server.js   # start production server
```

---

## Project Structure

```
app/
├── controllers/     # route handlers (auth, dashboard, reports, users, ...)
├── models/          # Lucid models (User, HisSetting, ReportHead, AuditLog, ...)
├── services/        # business logic (HisDb, ReportRunner, Audit, ...)
├── middleware/      # auth guard, ...
└── exceptions/      # custom error handlers

database/
├── migrations/      # app database schema (TypeScript)
└── schema.sql       # SQL สำหรับ import ตรง

config/              # database, session, shield, auth, ...
start/               # routes, env validation, view globals
resources/           # Edge templates + frontend assets
```

---

## Key Features

- **Dashboard** — แสดง widget รายงานที่กำหนดเองได้
- **Report Runner** — รัน query บน HIS DB แล้ว render ผล
- **HIS Settings** — จัดการ HIS DB connection ต่อโรงพยาบาล
- **User Management** — จัดการผู้ใช้งาน
- **Audit Log** — บันทึก action ของ admin ทุกครั้ง

---

## License

Private — ใช้งานภายในองค์กรเท่านั้น
