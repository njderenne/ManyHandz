import { getTableName, is } from 'drizzle-orm'
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core'
import * as schema from './schema'

/**
 * Schema introspection — turns the live Drizzle table definitions into plain data for the /schema
 * browser. Because it reads the ACTUAL schema objects (drizzle's getTableConfig), the screen can
 * never drift from reality: add a table or index and the browser shows it on next reload.
 * Note: this pulls drizzle-orm's pg-core runtime into the app bundle — acceptable for the template
 * gallery; a minted app that wants the leanest bundle can drop the /schema routes.
 */
export type ColumnInfo = {
  name: string
  sqlType: string
  notNull: boolean
  hasDefault: boolean
  isPrimary: boolean
}
export type IndexInfo = { name: string; columns: string[]; unique: boolean }
export type ForeignKeyInfo = { columns: string[]; references: string; onDelete?: string }
export type TableInfo = {
  name: string
  columns: ColumnInfo[]
  indexes: IndexInfo[]
  foreignKeys: ForeignKeyInfo[]
  uniqueConstraints: IndexInfo[]
}

function describe(table: PgTable): TableInfo {
  const cfg = getTableConfig(table)
  return {
    name: cfg.name,
    columns: cfg.columns.map((col) => ({
      name: col.name,
      sqlType: col.getSQLType(),
      notNull: col.notNull,
      hasDefault: col.hasDefault,
      isPrimary: col.primary,
    })),
    indexes: cfg.indexes.map((idx) => ({
      name: idx.config.name ?? '(unnamed)',
      columns: idx.config.columns.map((c) => ('name' in c && typeof c.name === 'string' ? c.name : '(expression)')),
      unique: idx.config.unique ?? false,
    })),
    foreignKeys: cfg.foreignKeys.map((fk) => {
      const ref = fk.reference()
      return {
        columns: ref.columns.map((c) => c.name),
        references: `${getTableName(ref.foreignTable)}.${ref.foreignColumns.map((c) => c.name).join(', ')}`,
        onDelete: fk.onDelete,
      }
    }),
    uniqueConstraints: cfg.uniqueConstraints.map((u) => ({
      name: u.name ?? '(unnamed)',
      columns: u.columns.map((c) => c.name),
      unique: true,
    })),
  }
}

/** Every table in the schema, introspected once at module load (cheap — pure object reads). */
export const SCHEMA_TABLES: TableInfo[] = (Object.values(schema) as unknown[])
  .filter((v): v is PgTable => is(v, PgTable))
  .map(describe)
  .sort((a, b) => a.name.localeCompare(b.name))

export function getTable(name: string): TableInfo | undefined {
  return SCHEMA_TABLES.find((t) => t.name === name)
}
