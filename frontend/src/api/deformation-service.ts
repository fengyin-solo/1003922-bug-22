import { listRows, resetRows } from '@/data/local-store'
import { loadRecords, persistRecords, resetDeformation } from '@/data/deformation-store'
import type { EntryRow } from '@/data/types'
import type {
  CrackWidthRow,
  DeformationRecord,
  DeformationStats,
  DeformationStatus,
  DeformationSummary,
  DeformationVersion,
  MutationParams,
  MutationResult,
  VersionAction,
} from '@/data/deformation-types'

// 裂缝宽度注意级阈值（mm）：校核确认时 >= 该值即判异常，反之推翻异常。
export const ABNORMAL_WIDTH_MM = 10

const DEFAULT_OPERATOR = '值班管理员'

export interface DeformationFilters {
  keyword?: string
  hazardNo?: string
  status?: DeformationStatus | ''
  abnormalOnly?: boolean
}

function latestVersion(record: DeformationRecord): DeformationVersion {
  return record.versions[record.versions.length - 1]
}

function summarize(record: DeformationRecord): DeformationSummary {
  const v = latestVersion(record)
  return {
    id: record.id,
    recordNo: record.recordNo,
    hazardNo: record.hazardNo,
    observedAt: record.observedAt,
    widthMm: v.widthMm,
    horizontalMm: record.horizontalMm,
    verticalMm: record.verticalMm,
    observer: record.observer,
    version: v.version,
    status: v.status,
    abnormal: v.abnormal,
  }
}

function parseWidth(value: number | string | null | undefined, fallback: number): number {
  if (value === null || value === undefined || value === '') {
    return fallback
  }
  const num = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(num) || num < 0) {
    throw new Error('裂缝宽度必须是不小于 0 的数字')
  }
  return Math.round(num * 100) / 100
}

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 在一份记录上追加新版本并落盘。只追加、不回写：历史版本的宽度与异常判定原样保留。
 */
function appendVersion(
  records: DeformationRecord[],
  index: number,
  patch: {
    action: VersionAction
    widthMm: number
    status: DeformationStatus
    abnormal: boolean
    operator?: string
    note?: string
  },
): DeformationRecord {
  const record = records[index]
  const next: DeformationVersion = {
    version: record.currentVersion + 1,
    action: patch.action,
    widthMm: patch.widthMm,
    status: patch.status,
    abnormal: patch.abnormal,
    operator: patch.operator ?? DEFAULT_OPERATOR,
    createdAt: nowText(),
  }
  if (patch.note) {
    next.note = patch.note
  }
  const updated: DeformationRecord = {
    ...record,
    currentVersion: next.version,
    versions: [...record.versions, next],
  }
  const nextRecords = [...records]
  nextRecords[index] = updated
  persistRecords(nextRecords)
  return updated
}

function mutate(
  params: MutationParams,
  body: (
    record: DeformationRecord,
    records: DeformationRecord[],
    index: number,
  ) => { record: DeformationRecord; message: string },
): MutationResult {
  const records = loadRecords()
  const index = records.findIndex((row) => row.id === params.id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${params.id} 的形变记录` }
  }
  const record = records[index]
  // 并发冲突优先判定：同一记录并发校核/标记异常时，先成功者已推进版本，
  // 后到一方持有的 expectedVersion 必然落后，直接拒绝且不改写任何旧值。
  if (record.currentVersion !== params.expectedVersion) {
    return {
      ok: false,
      conflict: true,
      message: `记录已被其他操作更新（本地版本 v${params.expectedVersion}，当前 v${record.currentVersion}），请刷新后重试`,
      currentVersion: record.currentVersion,
      currentStatus: latestVersion(record).status,
    }
  }
  try {
    const result = body(record, records, index)
    return { ok: true, message: result.message, record: result.record }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '形变记录操作失败',
      currentVersion: record.currentVersion,
      currentStatus: latestVersion(record).status,
    }
  }
}

// ---------- 读路径：列表、详情、统计全部只认最新版本，读同一个版本化存储 ----------

export function listDeformations(filters: DeformationFilters = {}): DeformationSummary[] {
  let items = loadRecords().map(summarize)
  const keyword = (filters.keyword ?? '').trim()
  if (keyword) {
    items = items.filter(
      (row) => row.recordNo.includes(keyword) || row.hazardNo.includes(keyword),
    )
  }
  const hazardNo = (filters.hazardNo ?? '').trim()
  if (hazardNo) {
    items = items.filter((row) => row.hazardNo.includes(hazardNo))
  }
  if (filters.status) {
    items = items.filter((row) => row.status === filters.status)
  }
  if (filters.abnormalOnly) {
    items = items.filter((row) => row.abnormal)
  }
  return items.sort((a, b) => (a.observedAt < b.observedAt ? 1 : a.observedAt > b.observedAt ? -1 : b.id - a.id))
}

export function getDeformation(id: number): { record: DeformationRecord; latest: DeformationSummary } | null {
  const record = loadRecords().find((row) => row.id === id)
  return record ? { record, latest: summarize(record) } : null
}

export function currentMonthPrefix(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

export function deformationStats(): DeformationStats {
  const items = loadRecords().map(summarize)
  const month = currentMonthPrefix()
  return {
    monthCount: items.filter((row) => row.observedAt.startsWith(month)).length,
    abnormalCount: items.filter((row) => row.abnormal).length,
    pendingVerifyCount: items.filter((row) => row.status === '待校核').length,
    pendingCount: items.filter((row) => row.status !== '已校核').length,
    total: items.length,
  }
}

export function statusSummary(): { status: DeformationStatus; count: number }[] {
  const items = loadRecords().map(summarize)
  return (['已观测', '待校核', '已校核', '异常值', '需复测'] as DeformationStatus[]).map((status) => ({
    status,
    count: items.filter((row) => row.status === status).length,
  }))
}

/** 某隐患点最近一次形变观测的最新版本结果，供裂缝页面跨页面读取。 */
export function latestDeformationByHazard(
  hazardNo: string,
): DeformationSummary | null {
  const candidates = loadRecords()
    .filter((row) => row.hazardNo === hazardNo)
    .sort((a, b) => (a.observedAt < b.observedAt ? 1 : a.observedAt > b.observedAt ? -1 : b.id - a.id))
  return candidates.length ? summarize(candidates[0]) : null
}

// ---------- 写路径：所有动作先过乐观锁，再做状态前置条件，最后只追加新版本 ----------

/** 提交校核：已观测/需复测(复测上报后进入待校核) → 待校核 */
export function submitForVerification(params: MutationParams): MutationResult {
  return mutate(params, (record, records, index) => {
    const current = latestVersion(record)
    if (current.status === '待校核') {
      throw new Error('记录已提交校核，等待确认，请勿重复提交')
    }
    if (!['已观测', '需复测'].includes(current.status)) {
      throw new Error(`当前状态「${current.status}」不能提交校核`)
    }
    const width = parseWidth(params.widthMm, current.widthMm)
    const updated = appendVersion(records, index, {
      action: '提交校核',
      widthMm: width,
      status: '待校核',
      // 提交动作不改异常判定：此前被标记异常的记录仍带着异常标记进入待校核
      abnormal: current.abnormal,
      operator: params.operator,
      note: params.note,
    })
    return { record: updated, message: '已提交校核，等待确认' }
  })
}

/**
 * 确认校核（校核写入主路径）：
 * - 待校核 → 已校核；以本次认定宽度按阈值重新判定异常；
 * - 原异常值经复测后确认正常时，异常推翻必须生成新版本，绝不回写旧的异常宽度；
 * - 宽度仍超阈值则维持异常值，历史宽度原样保留。
 */
export function confirmVerification(params: MutationParams): MutationResult {
  return mutate(params, (record, records, index) => {
    const current = latestVersion(record)
    if (current.status === '已校核') {
      throw new Error('记录已校核，请勿重复校核')
    }
    if (current.status !== '待校核') {
      throw new Error(`只有「待校核」记录可以确认校核，当前为「${current.status}」`)
    }
    const width = parseWidth(params.widthMm, current.widthMm)
    const abnormal = width >= ABNORMAL_WIDTH_MM
    const updated = appendVersion(records, index, {
      action: '确认校核',
      widthMm: width,
      status: abnormal ? '异常值' : '已校核',
      abnormal,
      operator: params.operator,
      note:
        params.note ??
        (abnormal
          ? `裂缝宽度 ${width}mm 达到/超过 ${ABNORMAL_WIDTH_MM}mm 阈值`
          : record.versions.some((v) => v.abnormal)
            ? '复核后宽度正常，推翻原异常判定'
            : '校核通过'),
    })
    return {
      record: updated,
      message: abnormal
        ? `校核完成：宽度 ${width}mm 超阈值，维持异常值（新版本 v${updated.currentVersion}）`
        : `校核完成：宽度 ${width}mm 正常（新版本 v${updated.currentVersion}）`,
    }
  })
}

/** 标记异常：只允许待校核记录标记；已经是异常值不允许重复标记。 */
export function markAbnormal(params: MutationParams): MutationResult {
  return mutate(params, (record, records, index) => {
    const current = latestVersion(record)
    if (current.status === '异常值') {
      throw new Error('该记录已是异常值，不能重复标记')
    }
    if (current.status !== '待校核') {
      throw new Error(`只有「待校核」记录可以标记异常，当前为「${current.status}」`)
    }
    const width = parseWidth(params.widthMm, current.widthMm)
    const updated = appendVersion(records, index, {
      action: '标记异常',
      widthMm: width,
      status: '异常值',
      abnormal: true,
      operator: params.operator,
      note: params.note ?? `人工判定异常，裂缝宽度 ${width}mm`,
    })
    return { record: updated, message: `已标记异常（新版本 v${updated.currentVersion}），可安排复测` }
  })
}

/** 安排复测：异常值 → 需复测 */
export function arrangeRemeasure(params: MutationParams): MutationResult {
  return mutate(params, (record, records, index) => {
    const current = latestVersion(record)
    if (current.status === '需复测') {
      throw new Error('该记录已安排复测，等待复测上报')
    }
    if (current.status !== '异常值') {
      throw new Error(`只有「异常值」记录需要安排复测，当前为「${current.status}」`)
    }
    const updated = appendVersion(records, index, {
      action: '安排复测',
      widthMm: current.widthMm,
      status: '需复测',
      abnormal: true,
      operator: params.operator,
      note: params.note ?? '安排现场复测',
    })
    return { record: updated, message: '已安排复测，等待复测数据上报' }
  })
}

/**
 * 复测上报：需复测 → 待校核。复测值作为新版本宽度写入；
 * 是否仍是异常由随后的确认校核按阈值判定，复测动作本身不偷偷改旧版本。
 */
export function submitRemeasure(params: MutationParams): MutationResult {
  return mutate(params, (record, records, index) => {
    const current = latestVersion(record)
    if (current.status !== '需复测') {
      throw new Error(`只有「需复测」记录可以上报复测数据，当前为「${current.status}」`)
    }
    const width = parseWidth(params.widthMm, current.widthMm)
    const updated = appendVersion(records, index, {
      action: '复测上报',
      widthMm: width,
      status: '待校核',
      abnormal: current.abnormal,
      operator: params.operator,
      note: params.note ?? `复测裂缝宽度 ${width}mm，待校核确认`,
    })
    return { record: updated, message: `复测数据已上报（新版本 v${updated.currentVersion}），请确认校核` }
  })
}

// ---------- 裂缝监测页面：宽度/异常标记跨行统一读形变版本数据 ----------

function parseInitialWidth(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const num = typeof value === 'number' ? value : Number(String(value).trim())
  return Number.isFinite(num) ? num : null
}

/**
 * 裂缝测点的宽度视图：测点自身的当前宽度不再另存一份，
 * 全部按隐患点编号到形变版本数据里取最新结果，避免「旧宽度残留」与两边对不上。
 */
export function crackWidthRows(): CrackWidthRow[] {
  const points = listRows('crack')
  return points.map((point: EntryRow) => {
    const hazardNo = String(point['隐患点编号'] ?? '')
    const initial = parseInitialWidth(point['初始宽度'])
    const latestSummary = latestDeformationByHazard(hazardNo)
    let changeRate: number | null = null
    if (latestSummary && initial !== null && initial > 0) {
      changeRate = Math.round(((latestSummary.widthMm - initial) / initial) * 1000) / 10
    }
    return {
      id: Number(point.id),
      pointNo: String(point['测点编号'] ?? ''),
      hazardNo,
      crackNo: String(point['裂缝编号'] ?? ''),
      initialWidthMm: initial,
      monitor: String(point['监测人'] ?? ''),
      pointStatus: String(point.status ?? ''),
      pointAbnormal: Boolean(point.abnormal),
      latest: latestSummary
        ? {
            recordId: latestSummary.id,
            recordNo: latestSummary.recordNo,
            observedAt: latestSummary.observedAt,
            version: latestSummary.version,
            widthMm: latestSummary.widthMm,
            status: latestSummary.status,
            abnormal: latestSummary.abnormal,
            changeRate,
          }
        : null,
    }
  })
}

export function resetDeformationData(): DeformationSummary[] {
  resetDeformation()
  resetRows('crack')
  return listDeformations()
}
