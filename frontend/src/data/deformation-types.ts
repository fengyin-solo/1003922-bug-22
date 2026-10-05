/**
 * 形变观测领域模型：一条形变记录由多个「不可变版本」组成。
 * 校核、异常判定、复测都只能追加新版本，绝不回写旧版本，
 * 因此历史异常记录会按当时的裂缝宽度与判定结果原样保留。
 */

export type DeformationStatus = '已观测' | '待校核' | '已校核' | '异常值' | '需复测'

export type VersionAction =
  | '观测录入'
  | '提交校核'
  | '确认校核'
  | '标记异常'
  | '安排复测'
  | '复测上报'

export interface DeformationVersion {
  /** 记录内自增的版本号，从 1 开始，同时作为乐观锁版本 */
  version: number
  action: VersionAction
  /** 该版本认定的裂缝宽度（mm），历史版本一经写入不再修改 */
  widthMm: number
  status: DeformationStatus
  /** 该版本当时的异常判定结果 */
  abnormal: boolean
  operator: string
  createdAt: string
  note?: string
}

export interface DeformationRecord {
  id: number
  recordNo: string
  hazardNo: string
  /** 观测日期（YYYY-MM-DD） */
  observedAt: string
  horizontalMm: number
  verticalMm: number
  observer: string
  /** 乐观锁：当前最新版本号，写入时必须与调用方持有的版本一致 */
  currentVersion: number
  versions: DeformationVersion[]
}

/** 列表/看板使用的扁平化结果，全部由最新版本派生，不另存副本 */
export interface DeformationSummary {
  id: number
  recordNo: string
  hazardNo: string
  observedAt: string
  widthMm: number
  horizontalMm: number
  verticalMm: number
  observer: string
  version: number
  status: DeformationStatus
  abnormal: boolean
}

export interface DeformationStats {
  monthCount: number
  abnormalCount: number
  pendingVerifyCount: number
  pendingCount: number
  total: number
}

/** 裂缝测点页面跨行读取形变结果时使用的一行 */
export interface CrackWidthRow {
  id: number
  pointNo: string
  hazardNo: string
  crackNo: string
  initialWidthMm: number | null
  monitor: string
  pointStatus: string
  pointAbnormal: boolean
  latest: {
    recordId: number
    recordNo: string
    observedAt: string
    version: number
    widthMm: number
    status: DeformationStatus
    abnormal: boolean
    /** 相对初始宽度的变化率（%），缺初始宽度时为 null */
    changeRate: number | null
  } | null
}

export interface MutationResult {
  ok: boolean
  message: string
  /** 版本不一致导致的并发冲突 */
  conflict?: boolean
  /** 冲突时回传服务端当前版本，方便调用方刷新后重试 */
  currentVersion?: number
  currentStatus?: DeformationStatus
  record?: DeformationRecord
}

export interface MutationParams {
  id: number
  /** 调用方读取时持有的版本号；与当前版本不一致即判为并发冲突 */
  expectedVersion: number
  /** 校核/复测时新认定的宽度（mm）；留空则沿用上一版本宽度 */
  widthMm?: number | string | null
  operator?: string
  note?: string
}
