-- HisReport-adonis : App database schema
-- สร้างด้วย: database/migrations/
-- รันไฟล์นี้บน database หลักของ app (DB_DATABASE)
-- HIS database (his connection) เป็น external — ไม่ต้องสร้างที่นี่

-- -------------------------------------------------------
-- his_settings
-- เก็บ connection settings ของ HIS database แต่ละโรงพยาบาล
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS `his_settings` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `db_host_his`     VARCHAR(255) NOT NULL,
  `db_name_his`     VARCHAR(255) NOT NULL,
  `db_username_his` VARCHAR(255) NOT NULL,
  `db_password_his` TEXT         NULL,
  `db_port_his`     VARCHAR(10)  NOT NULL DEFAULT '3306',
  `created_by`      INT UNSIGNED NULL,
  `updated_by`      INT UNSIGNED NULL,
  `created_at`      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------
-- audit_logs
-- บันทึก action ของ admin (write-only)
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `user_id`    INT UNSIGNED    NULL,
  `username`   VARCHAR(64)     NULL,
  `action`     VARCHAR(40)     NOT NULL,   -- e.g. 'user.create'
  `entity`     VARCHAR(40)     NOT NULL,   -- e.g. 'user', 'report', 'his_settings'
  `entity_id`  INT             NULL,
  `summary`    TEXT            NULL,
  `meta`       JSON            NULL,
  `ip`         VARCHAR(64)     NULL,
  `user_agent` VARCHAR(255)    NULL,
  `created_at` TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_entity`     (`entity`, `entity_id`),
  INDEX `idx_user_id`    (`user_id`),
  INDEX `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------
-- report_request_* — โมดูลขอข้อมูล/รายงาน
-- เลขคำขอ REQ-<ปีงบ พ.ศ.>-<ลำดับ 4 หลัก> นับใหม่ทุกปีงบประมาณ (เริ่ม 1 ต.ค.)
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS `report_request_sequences` (
  `fiscal_year` INT UNSIGNED NOT NULL PRIMARY KEY,
  `last_no`     INT UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `report_requests` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `req_no`          VARCHAR(20)  NOT NULL,
  `fiscal_year`     INT UNSIGNED NOT NULL,
  `requester_id`    INT UNSIGNED NOT NULL,
  `title`           VARCHAR(255) NOT NULL,
  `description`     TEXT         NOT NULL,
  `purpose`         TEXT         NULL,
  `data_level`      VARCHAR(20)  NOT NULL DEFAULT 'aggregate',  -- aggregate | identifiable
  `date_from`       DATE         NULL,
  `date_to`         DATE         NULL,
  `output_format`   VARCHAR(10)  NOT NULL DEFAULT 'xlsx',       -- xlsx | csv | pdf | any
  `due_date`        DATE         NULL,
  `status`          VARCHAR(20)  NOT NULL DEFAULT 'pending',    -- pending | in_progress | completed | rejected | cancelled
  `reviewed_by`     INT UNSIGNED NULL,
  `reviewed_at`     TIMESTAMP    NULL,
  `reject_reason`   TEXT         NULL,
  `assigned_to`     INT UNSIGNED NULL,
  `completion_note` TEXT         NULL,
  `completed_at`    TIMESTAMP    NULL,
  `work_sql`        TEXT         NULL,                          -- SQL ที่ admin เขียนเองเพื่อจัดทำคำขอ
  `work_db_source`  VARCHAR(10)  NULL,                          -- his | system
  `promoted_report_id` INT UNSIGNED NULL,                       -- report_head_detail.id ที่สร้างจากคำขอนี้
  `files_purged_at` TIMESTAMP    NULL,                          -- ลบไฟล์ตามระยะเวลาเก็บ (PDPA)
  `created_at`      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE INDEX `uq_req_no` (`req_no`),
  INDEX `idx_status_created` (`status`, `created_at`),
  INDEX `idx_requester` (`requester_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `report_request_files` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `request_id`     INT UNSIGNED NOT NULL,
  `original_name`  VARCHAR(255) NOT NULL,
  `stored_name`    VARCHAR(100) NOT NULL,
  `mime`           VARCHAR(120) NULL,
  `size`           INT UNSIGNED NOT NULL DEFAULT 0,
  `source`         VARCHAR(20)  NOT NULL DEFAULT 'upload',      -- upload | generated
  `uploaded_by`    INT UNSIGNED NULL,
  `download_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at`     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_rrf_request` FOREIGN KEY (`request_id`) REFERENCES `report_requests` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `report_request_logs` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `request_id`  INT UNSIGNED    NOT NULL,
  `action`      VARCHAR(30)     NOT NULL,
  `from_status` VARCHAR(20)     NULL,
  `to_status`   VARCHAR(20)     NULL,
  `note`        TEXT            NULL,
  `user_id`     INT UNSIGNED    NULL,
  `username`    VARCHAR(64)     NULL,
  `created_at`  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_request_created` (`request_id`, `created_at`),
  CONSTRAINT `fk_rrl_request` FOREIGN KEY (`request_id`) REFERENCES `report_requests` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------
-- notifications — แจ้งเตือนในระบบ (กระดิ่งบน topbar)
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS `notifications` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `user_id`    INT UNSIGNED    NOT NULL,
  `title`      VARCHAR(255)    NOT NULL,
  `body`       TEXT            NULL,
  `link`       VARCHAR(255)    NULL,
  `read_at`    TIMESTAMP       NULL,
  `created_at` TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_user_read` (`user_id`, `read_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------
-- app_settings — ค่าตั้งค่าที่แก้ได้จากหน้าเว็บ (การแจ้งเตือน / PDPA)
-- ค่าในตารางนี้ทับค่าใน .env · ค่าลับ (LINE token) เข้ารหัสด้วย APP_KEY
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS `app_settings` (
  `key`        VARCHAR(100) NOT NULL PRIMARY KEY,
  `value`      TEXT         NULL,
  `updated_by` INT UNSIGNED NULL,
  `updated_at` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------
-- adonis_schema (AdonisJS migration tracker)
-- สร้างอัตโนมัติเมื่อรัน node ace migration:run
-- ใส่ไว้ให้ครบถ้วนหากต้องการ import ทั้งหมดพร้อมกัน
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS `adonis_schema` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `name`        VARCHAR(255) NOT NULL,
  `batch`       INT UNSIGNED NOT NULL,
  `migration_time` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `adonis_schema_versions` (
  `version` INT UNSIGNED NOT NULL PRIMARY KEY
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
