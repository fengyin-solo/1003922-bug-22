import { beforeEach, describe, expect, it, vi } from 'vitest'

// 纯前端数据层依赖 window.localStorage，这里用内存实现顶替，用例之间互不影响。
const backing = new Map<string, string>()
const storageListeners: Array<(event: { key: string | null }) => void> = []

;(globalThis as Record<string, unknown>).window = {
  localStorage: {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => {
      backing.set(key, String(value))
    },
    removeItem: (key: string) => {
      backing.delete(key)
    },
  },
  addEventListener: (type: string, fn: (event: { key: string | null }) => void) => {
    if (type === 'storage') {
      storageListeners.push(fn)
    }
  },
}

const STORAGE_KEY = 'geohazard-monitor-prevention:entries'

async function loadService() {
  vi.resetModules()
  return import('@/api/deformation-service')
}

async function loadStore() {
  return import('@/data/local-store')
}

function storedTables(): Record<string, Array<Record<string, unknown>>> {
  const raw = backing.get(STORAGE_KEY)
  if (!raw) {
    throw new Error('localStorage 里还没有数据')
  }
  return (JSON.parse(raw) as { tables: Record<string, Array<Record<string, unknown>>> }).tables
}

beforeEach(() => {
  backing.clear()
})

describe('校核写入路径', () => {
  it('确认校核后同步裂缝测点当前宽度，刷新后结果不丢、旧宽度不残留', async () => {
    const service = await loadService()
    const result = service.confirmCheck(2, 2)
    expect(result.ok).toBe(true)

    // 同一会话内：裂缝页读到的就是校核后的宽度。
    const store = await loadStore()
    const crack = store.listRows('crack').find((row) => row['测点编号'] === 'CRAC-0002')
    expect(crack?.['当前宽度']).toBe(23.4)
    expect(crack?.version).toBe(2)

    // 模拟刷新（整页重载，缓存清空）：从 localStorage 重新播种后结果不变。
    const fresh = await loadService()
    const record = fresh.getDeformation(2)
    expect(record?.status).toBe('已校核')
    expect(record?.version).toBe(3)
    const freshStore = await loadStore()
    const crackAfterRefresh = freshStore.listRows('crack').find((row) => row['测点编号'] === 'CRAC-0002')
    expect(crackAfterRefresh?.['当前宽度']).toBe(23.4)
  })

  it('状态不合法时拒绝校核', async () => {
    const service = await loadService()
    // DEFO-0001 还是「已观测」，不能直接确认校核。
    expect(service.confirmCheck(1, 1).ok).toBe(false)
    // DEFO-0002 已是「待校核」，重复提交校核无效。
    expect(service.submitCheck(2, 2).ok).toBe(false)
  })
})

describe('异常判定路径', () => {
  it('标记异常生成留档异常记录，重复标记被拒绝且不再新增', async () => {
    const service = await loadService()
    const first = service.markAbnormal(1, 1, '值班管理员')
    expect(first.ok).toBe(true)
    expect(service.getDeformation(1)?.status).toBe('异常值')

    const anomalies = service.listAnomalies(1)
    expect(anomalies).toHaveLength(1)
    expect(anomalies[0]['异常时宽度']).toBe(12.5)
    expect(anomalies[0].status).toBe('待处理')

    // 重复标记：状态已是异常值，直接拒绝，异常记录不重复。
    const second = service.markAbnormal(1, 2, '值班管理员')
    expect(second.ok).toBe(false)
    expect(service.listAnomalies(1)).toHaveLength(1)
  })
})

describe('复测路径', () => {
  it('复测生成新观测版本，历史版本与异常记录按当时宽度保留', async () => {
    const service = await loadService()
    // DEFO-0003 已是异常值（v2，第 1 次观测，宽度 31.2，带一条待处理异常）。
    const result = service.retest(3, 2, 28.6, '张伟')
    expect(result.ok).toBe(true)

    const record = service.getDeformation(3)
    expect(record?.['观测版本']).toBe(2)
    expect(record?.['裂缝宽度']).toBe(28.6)
    expect(record?.status).toBe('已观测')
    expect(record?.abnormal).toBe(false)
    expect(record?.version).toBe(3)

    // 旧版本留档：还是当时的 31.2，不能被新值覆盖。
    const history = service.listVersionHistory(3)
    expect(history).toHaveLength(1)
    expect(history[0]['观测版本']).toBe(1)
    expect(history[0]['裂缝宽度']).toBe(31.2)

    // 异常被推翻，但异常时宽度保持标记当时的值。
    const anomalies = service.listAnomalies(3)
    expect(anomalies).toHaveLength(1)
    expect(anomalies[0].status).toBe('已推翻')
    expect(anomalies[0]['异常时宽度']).toBe(31.2)
    expect(anomalies[0]['推翻时间']).not.toBe('')
  })

  it('复测拒绝非法宽度', async () => {
    const service = await loadService()
    expect(service.retest(3, 2, Number.NaN, '张伟').ok).toBe(false)
    expect(service.retest(3, 2, -1, '张伟').ok).toBe(false)
    expect(service.getDeformation(3)?.['裂缝宽度']).toBe(31.2)
  })
})

describe('并发校核与标记异常', () => {
  it('同一条记录并发操作时仅先成功者生效，另一方收到冲突且原结果不变', async () => {
    const service = await loadService()
    // 双方拿到的都是 v2 的 DEFO-0002（待校核）。
    const confirm = service.confirmCheck(2, 2)
    expect(confirm.ok).toBe(true)

    // 另一方仍拿着旧版本号 v2 来标记异常：必须冲突，且不改写先成功的结果。
    const mark = service.markAbnormal(2, 2, '值班管理员')
    expect(mark.ok).toBe(false)
    expect(mark.conflict).toBe(true)

    const record = service.getDeformation(2)
    expect(record?.status).toBe('已校核')
    expect(record?.version).toBe(3)
    expect(service.listAnomalies(2)).toHaveLength(0)
  })

  it('反向并发：先标记异常成功者生效，校核方收到冲突', async () => {
    const service = await loadService()
    const mark = service.markAbnormal(2, 2, '值班管理员')
    expect(mark.ok).toBe(true)

    const confirm = service.confirmCheck(2, 2)
    expect(confirm.ok).toBe(false)
    expect(confirm.conflict).toBe(true)

    const record = service.getDeformation(2)
    expect(record?.status).toBe('异常值')
    expect(record?.version).toBe(3)
  })

  it('另一标签页已写入时，本页旧版本操作冲突且落盘数据保持原结果', async () => {
    const service = await loadService()
    // 本页读出 DEFO-0001（v1，已观测）。
    expect(service.getDeformation(1)?.version).toBe(1)

    // 模拟另一标签页抢先标记异常并落盘。
    const tables = storedTables()
    const row = tables['deformation'].find((item) => item.id === 1)
    if (!row) {
      throw new Error('种子里没有 DEFO-0001')
    }
    row.status = '异常值'
    row.version = 2
    backing.set(STORAGE_KEY, JSON.stringify({ schema: 2, tables }))
    for (const listener of storageListeners) {
      listener({ key: STORAGE_KEY })
    }

    // 本页仍按 v1 提交校核：冲突，另一标签页的结果原样保留。
    const result = service.submitCheck(1, 1)
    expect(result.ok).toBe(false)
    expect(result.conflict).toBe(true)

    const persisted = storedTables()['deformation'].find((item) => item.id === 1)
    expect(persisted?.status).toBe('异常值')
    expect(persisted?.version).toBe(2)
  })
})
