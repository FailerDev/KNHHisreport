import vine from '@vinejs/vine'
import { DATA_LEVELS, OUTPUT_FORMATS } from '#services/report_request_flow'

const isoDate = () =>
  vine
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)

export const createRequestValidator = vine.compile(
  vine.object({
    title: vine.string().trim().minLength(5).maxLength(255),
    description: vine.string().trim().minLength(10).maxLength(5000),
    purpose: vine.string().trim().maxLength(2000).optional(),
    data_level: vine.enum(DATA_LEVELS),
    date_from: isoDate().optional(),
    date_to: isoDate().optional(),
    output_format: vine.enum(OUTPUT_FORMATS),
    due_date: isoDate().optional(),
  })
)

export const rejectValidator = vine.compile(
  vine.object({
    reason: vine.string().trim().minLength(5).maxLength(2000),
  })
)

export const noteValidator = vine.compile(
  vine.object({
    note: vine.string().trim().maxLength(2000).optional(),
  })
)

export const generateValidator = vine.compile(
  vine.object({
    report_id: vine.number().positive(),
  })
)

export const runSqlValidator = vine.compile(
  vine.object({
    sql: vine.string().trim().minLength(10).maxLength(20000),
    database_source: vine.enum(['his', 'system'] as const),
  })
)

export const promoteValidator = vine.compile(
  vine.object({
    head_id: vine.number().positive(),
    name: vine.string().trim().minLength(3).maxLength(255),
  })
)
