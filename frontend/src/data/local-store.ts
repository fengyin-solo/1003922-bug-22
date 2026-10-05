import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'geohazard-monitor-prevention:entries'
// 数据结构版本：行结构变化（例如补 version/观测版本 字段）时 +1，旧数据自动按新种子重播，
// 避免上一版残留的行缺字段、旧宽度对不上。
const SCHEMA_VERSION = 2

type StorageShape = {
  schema: number
  tables: Record<string, EntryRow[]>
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seedTables(): Record<string, EntryRow[]> {
  return clone(SEED_ROWS)
}

function persist(tables: Record<string, EntryRow[]>): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    const shape: StorageShape = { schema: SCHEMA_VERSION, tables }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(shape))
  }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = seedTables()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    persist(fallback)
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StorageShape>
    // 旧结构（直接是表映射、没有 schema 号）或版本不一致：重播种子，防止旧宽度残留。
    if (!parsed || parsed.schema !== SCHEMA_VERSION || typeof parsed.tables !== 'object' || parsed.tables === null) {
      persist(fallback)
      return fallback
    }
    return { ...fallback, ...parsed.tables }
  } catch {
    persist(fallback)
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  persist(next)
}

/**
 * 写事务：先丢弃缓存重读 localStorage 里的最新数据，再校验、再整体落盘。
 * 这样另一个标签页刚写入的版本号能立刻看到，并发校验才有意义；
 * fn 返回 ok=false 时不落盘，原结果保持不变。
 */
export function transact<T extends { ok: boolean }>(fn: (tables: Record<string, EntryRow[]>) => T): T {
  const tables = readStorage()
  const result = fn(tables)
  cache = tables
  if (result.ok) {
    persist(tables)
  }
  return result
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

// 跨标签页同步：别的页面写入后，本页缓存立刻失效，下次读取拿到最新结果。
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) {
      cache = null
    }
  })
}
