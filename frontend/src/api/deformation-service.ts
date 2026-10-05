import { listRows, transact } from '@/data/local-store'
import type { ActionResult, EntryRow, PageResult } from '@/data/types'
import { filterRows } from '@/api/local-service'

// 形变观测的专用读写路径：校核写入、异常判定、复测版本都从这里过，
// 列表页、详情页、裂缝页读的是同一份本地数据，结果才能对得上。
const DEFORMATION = 'deformation'
const CRACK = 'crack'
const ANOMALY = 'deformation_anomaly'
const HISTORY = 'deformation_history'

const STATUS_OBSERVED = '已观测'
const STATUS_PENDING_CHECK = '待校核'
const STATUS_CHECKED = '已校核'
const STATUS_ABNORMAL = '异常值'
const STATUS_RETEST = '需复测'

const ANOMALY_OPEN = '待处理'
const ANOMALY_OVERTURNED = '已推翻'

function now(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function today(): string {
  return now().slice(0, 10)
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function findRecord(tables: Record<string, EntryRow[]>, id: number): EntryRow | undefined {
  return (tables[DEFORMATION] ?? []).find((row) => Number(row.id) === id)
}

function conflictResult(row: EntryRow, action: string): ActionResult {
  return {
    ok: false,
    conflict: true,
    message: `形变记录 ${row['记录编号']} 已被其他操作校核或标记（当前版本 v${row.version}），本次「${action}」未生效，原结果保持不变，请刷新后查看`,
  }
}

// ---------- 跨页面读取路径：列表、详情、裂缝关联都走这里 ----------

export function listDeformation(filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(DEFORMATION), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function getDeformation(id: number): EntryRow | undefined {
  return listRows(DEFORMATION).find((row) => Number(row.id) === id)
}

/** 同一隐患点下的裂缝测点：详情页和裂缝页看的是同一份当前宽度。 */
export function listLinkedCracks(hazardId: string): EntryRow[] {
  return listRows(CRACK).filter((row) => String(row['隐患点编号']) === hazardId)
}

/** 异常记录按时间倒序；每条都冻结了标记当时的裂缝宽度。 */
export function listAnomalies(recordId: number): EntryRow[] {
  return listRows(ANOMALY)
    .filter((row) => Number(row['形变记录id']) === recordId)
    .sort((a, b) => Number(b.id) - Number(a.id))
}

/** 复测产生的历史观测版本，旧值只读不改。 */
export function listVersionHistory(recordId: number): EntryRow[] {
  return listRows(HISTORY)
    .filter((row) => Number(row['形变记录id']) === recordId)
    .sort((a, b) => Number(b['观测版本']) - Number(a['观测版本']))
}

// ---------- 校核写入路径 ----------

export function submitCheck(id: number, expectedVersion: number): ActionResult {
  return transact((tables) => {
    const row = findRecord(tables, id)
    if (!row) {
      return { ok: false, message: `没有找到编号为 ${id} 的形变记录` }
    }
    if (Number(row.version) !== expectedVersion) {
      return conflictResult(row, '提交校核')
    }
    if (String(row.status) !== STATUS_OBSERVED) {
      return { ok: false, message: `形变记录当前状态为「${row.status}」，只有「已观测」才能提交校核` }
    }
    row.status = STATUS_PENDING_CHECK
    row['记录状态'] = STATUS_PENDING_CHECK
    row.pending = true
    row.version = expectedVersion + 1
    return { ok: true, message: `形变记录已提交校核，当前状态「${STATUS_PENDING_CHECK}」` }
  })
}

export function confirmCheck(id: number, expectedVersion: number): ActionResult {
  return transact((tables) => {
    const row = findRecord(tables, id)
    if (!row) {
      return { ok: false, message: `没有找到编号为 ${id} 的形变记录` }
    }
    if (Number(row.version) !== expectedVersion) {
      return conflictResult(row, '确认校核')
    }
    if (String(row.status) !== STATUS_PENDING_CHECK) {
      return { ok: false, message: `形变记录当前状态为「${row.status}」，只有「待校核」才能确认校核` }
    }
    row.status = STATUS_CHECKED
    row['记录状态'] = STATUS_CHECKED
    row.pending = false
    row.version = expectedVersion + 1
    // 校核写入：把校核后的裂缝宽度同步到同一隐患点的裂缝测点，
    // 裂缝监测页读的就是这份数据，不会再残留旧宽度。
    const synced: string[] = []
    for (const crack of tables[CRACK] ?? []) {
      if (String(crack['隐患点编号']) === String(row['隐患点编号'])) {
        crack['当前宽度'] = row['裂缝宽度']
        crack.version = (Number(crack.version) || 1) + 1
        synced.push(String(crack['测点编号']))
      }
    }
    const syncNote = synced.length > 0 ? `，已同步裂缝测点 ${synced.join('、')} 的当前宽度` : '，该隐患点暂无关联裂缝测点'
    return { ok: true, message: `形变记录已确认校核，当前状态「${STATUS_CHECKED}」${syncNote}` }
  })
}

// ---------- 异常判定路径 ----------

export function markAbnormal(id: number, expectedVersion: number, operator: string): ActionResult {
  return transact((tables) => {
    const row = findRecord(tables, id)
    if (!row) {
      return { ok: false, message: `没有找到编号为 ${id} 的形变记录` }
    }
    if (Number(row.version) !== expectedVersion) {
      return conflictResult(row, '标记异常')
    }
    if (![STATUS_OBSERVED, STATUS_PENDING_CHECK].includes(String(row.status))) {
      return { ok: false, message: `形变记录当前状态为「${row.status}」，不能重复标记异常` }
    }
    const anomalies = tables[ANOMALY] ?? (tables[ANOMALY] = [])
    // 幂等：同一观测版本只允许一条待处理异常，重复标记直接拒绝，不会再刷出重复异常。
    const open = anomalies.find(
      (item) => Number(item['形变记录id']) === id && Number(item['观测版本']) === Number(row['观测版本']) && String(item.status) === ANOMALY_OPEN,
    )
    if (open) {
      return { ok: false, message: `该记录第 ${row['观测版本']} 次观测已存在待处理异常（异常时宽度 ${open['异常时宽度']}），请勿重复标记` }
    }
    row.status = STATUS_ABNORMAL
    row['记录状态'] = STATUS_ABNORMAL
    row.pending = true
    row.abnormal = true
    row.version = expectedVersion + 1
    anomalies.push({
      id: nextId(anomalies),
      status: ANOMALY_OPEN,
      pending: true,
      abnormal: true,
      '形变记录id': id,
      '记录编号': row['记录编号'],
      '观测版本': row['观测版本'],
      '异常时宽度': row['裂缝宽度'],
      '标记时间': now(),
      '标记人': operator,
      '推翻时间': '',
    })
    return { ok: true, message: `形变记录已标记异常，异常时宽度 ${row['裂缝宽度']} 已留档` }
  })
}

// ---------- 复测：推翻异常必须生成新观测版本，历史只读 ----------

export function retest(id: number, expectedVersion: number, newWidth: number, operator: string): ActionResult {
  return transact((tables) => {
    const row = findRecord(tables, id)
    if (!row) {
      return { ok: false, message: `没有找到编号为 ${id} 的形变记录` }
    }
    if (Number(row.version) !== expectedVersion) {
      return conflictResult(row, '复测')
    }
    if (![STATUS_ABNORMAL, STATUS_RETEST].includes(String(row.status))) {
      return { ok: false, message: `形变记录当前状态为「${row.status}」，只有「异常值」或「需复测」才能复测` }
    }
    if (!Number.isFinite(newWidth) || newWidth < 0) {
      return { ok: false, message: '复测宽度必须是不小于 0 的数字' }
    }
    const history = tables[HISTORY] ?? (tables[HISTORY] = [])
    const anomalies = tables[ANOMALY] ?? (tables[ANOMALY] = [])
    // 1. 旧版本整体留档，历史值一个字都不改。
    history.push({
      id: nextId(history),
      status: String(row.status),
      pending: false,
      abnormal: Boolean(row.abnormal),
      '形变记录id': id,
      '记录编号': row['记录编号'],
      '观测版本': row['观测版本'],
      '裂缝宽度': row['裂缝宽度'],
      '记录状态': row.status,
      '操作': '复测推翻',
      '时间': now(),
    })
    // 2. 推翻待处理异常：只改异常单的状态，异常时宽度保持标记当时的值。
    let overturned = 0
    for (const item of anomalies) {
      if (Number(item['形变记录id']) === id && String(item.status) === ANOMALY_OPEN) {
        item.status = ANOMALY_OVERTURNED
        item.pending = false
        item['推翻时间'] = now()
        overturned += 1
      }
    }
    // 3. 生成新观测版本：新宽度写在新版本上，不复用旧值。
    row['观测版本'] = (Number(row['观测版本']) || 1) + 1
    row['裂缝宽度'] = newWidth
    row['观测日期'] = today()
    row['观测人'] = operator
    row.status = STATUS_OBSERVED
    row['记录状态'] = STATUS_OBSERVED
    row.pending = true
    row.abnormal = false
    row.version = expectedVersion + 1
    const note = overturned > 0 ? `，已推翻 ${overturned} 条历史异常（当时宽度保留）` : ''
    return { ok: true, message: `已生成第 ${row['观测版本']} 次观测版本，状态回到「${STATUS_OBSERVED}」${note}` }
  })
}
