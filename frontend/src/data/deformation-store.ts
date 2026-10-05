import { DEFORMATION_SEED } from './deformation-seed'
import type { DeformationRecord } from './deformation-types'

// 形变记录的版本化持久化：独立于通用台账，key 里带 v2 以区分旧的平面数据。
const STORAGE_KEY = 'geohazard-monitor-prevention:deformation:v2'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seed(): DeformationRecord[] {
  return clone(DEFORMATION_SEED)
}

function readStorage(): DeformationRecord[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return seed()
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const fallback = seed()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    return JSON.parse(raw) as DeformationRecord[]
  } catch {
    const fallback = seed()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: DeformationRecord[] | null = null

export function deformationRecords(): DeformationRecord[] {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

/** 深拷贝读出，调用方拿到的对象与存储隔离，杜绝跨页面拿到被改了一半的旧引用。 */
export function loadRecords(): DeformationRecord[] {
  return clone(deformationRecords())
}

/** 整体写回：版本追加都发生在 service 层，store 只负责原子落盘。 */
export function persistRecords(records: DeformationRecord[]): void {
  cache = clone(records)
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  }
}

export function resetDeformation(): DeformationRecord[] {
  const records = seed()
  persistRecords(records)
  return clone(records)
}

// 跨标签页：另一个页面写入后本标签页立即丢弃缓存，刷新/重进不会读到旧值。
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) {
      cache = null
    }
  })
}

export function deformationStorageKey(): string {
  return STORAGE_KEY
}
