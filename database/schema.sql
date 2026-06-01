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
