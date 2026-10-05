<template>
  <section class="page" data-module="deformation">
    <header class="page-head">
      <div>
        <h2>形变观测管理</h2>
        <p class="page-desc">维护形变记录，围绕记录编号、隐患点编号、观测日期、裂缝宽度做登记、校核、异常判定与复测；每次处置都追加新版本。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记形变记录</button>
        <button class="btn" type="button" @click="resetAll">重置示例数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statsCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusCounts" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>记录编号</span>
        <input v-model="filters.keyword" placeholder="按记录编号检索" />
      </label>
      <label class="filter-item">
        <span>隐患点编号</span>
        <input v-model="filters.hazardNo" placeholder="按隐患点编号检索" />
      </label>
      <label class="filter-item">
        <span>当前状态</span>
        <select v-model="filters.status">
          <option value="">全部</option>
          <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <label class="filter-check">
        <input v-model="filters.abnormalOnly" type="checkbox" />
        <span>仅看异常</span>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>记录编号</th>
          <th>隐患点编号</th>
          <th>观测日期</th>
          <th>裂缝宽度(mm)</th>
          <th>水平位移量(mm)</th>
          <th>垂直位移量(mm)</th>
          <th>观测人</th>
          <th>版本</th>
          <th>当前状态</th>
          <th>异常标记</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id" :class="{ 'row-abnormal': row.abnormal }">
          <td>{{ row.recordNo }}</td>
          <td>{{ row.hazardNo }}</td>
          <td>{{ row.observedAt }}</td>
          <td>{{ row.widthMm }}</td>
          <td>{{ row.horizontalMm }}</td>
          <td>{{ row.verticalMm }}</td>
          <td>{{ row.observer }}</td>
          <td>v{{ row.version }}</td>
          <td>{{ row.status }}</td>
          <td>
            <span v-if="row.abnormal" class="badge-abnormal">异常</span>
            <span v-else class="badge-normal">正常</span>
          </td>
          <td class="row-actions">
            <RouterLink class="link" :to="`/deformation/${row.id}`">详情/复测</RouterLink>
            <button
              v-if="row.status === '已观测'"
              class="link"
              type="button"
              @click="runAction('submit', row)"
            >
              提交校核
            </button>
            <template v-if="row.status === '待校核'">
              <button class="link" type="button" @click="runAction('confirm', row)">确认校核</button>
              <button class="link" type="button" @click="runAction('mark', row)">标记异常</button>
            </template>
            <button
              v-if="row.status === '异常值'"
              class="link"
              type="button"
              @click="runAction('remeasure', row)"
            >
              安排复测
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="11" class="empty-state">暂无形变观测数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ rows.length }} 条形变观测记录；异常阈值：裂缝宽度 ≥ {{ ABNORMAL_WIDTH_MM }}mm</span>
      <span v-if="errorMessage" :class="errorConflict ? 'conflict-text' : 'error-text'">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  ABNORMAL_WIDTH_MM,
  arrangeRemeasure,
  confirmVerification,
  deformationStats,
  listDeformations,
  markAbnormal,
  resetDeformationData,
  statusSummary,
  submitForVerification,
} from '@/api/deformation-service'
import { useSessionStore } from '@/stores/session'
import type {
  DeformationStatus,
  DeformationSummary,
  MutationResult,
} from '@/data/deformation-types'

const session = useSessionStore()
const statuses: DeformationStatus[] = ['已观测', '待校核', '已校核', '异常值', '需复测']

const rows = ref<DeformationSummary[]>([])
const errorMessage = ref('')
const errorConflict = ref(false)
const filters = reactive({ keyword: '', hazardNo: '', status: '' as DeformationStatus | '', abnormalOnly: false })

const statsCards = computed(() => {
  const stats = deformationStats()
  return [
    { label: '本月观测次数', value: stats.monthCount },
    { label: '异常记录数', value: stats.abnormalCount },
    { label: '待校核记录', value: stats.pendingVerifyCount },
  ]
})

const statusCounts = computed(() => statusSummary())

function resetFilters() {
  filters.keyword = ''
  filters.hazardNo = ''
  filters.status = ''
  filters.abnormalOnly = false
  reload()
}

function openCreate() {
  errorMessage.value = '形变记录登记入口尚未接入审批流'
  errorConflict.value = false
}

function resetAll() {
  resetDeformationData()
  errorMessage.value = ''
  errorConflict.value = false
  reload()
}

type QuickAction = 'submit' | 'confirm' | 'mark' | 'remeasure'

function runAction(kind: QuickAction, row: DeformationSummary) {
  errorMessage.value = ''
  errorConflict.value = false
  const params = { id: row.id, expectedVersion: row.version, operator: session.operator }
  let result: MutationResult
  switch (kind) {
    case 'submit':
      result = submitForVerification(params)
      break
    case 'confirm':
      result = confirmVerification(params)
      break
    case 'mark':
      result = markAbnormal(params)
      break
    case 'remeasure':
      result = arrangeRemeasure(params)
      break
  }
  if (!result.ok) {
    errorMessage.value = result.message
    errorConflict.value = Boolean(result.conflict)
  }
  // 无论成功还是冲突都重新读取：成功后展示新版本，冲突后回到服务端最新结果，不保留旧页面状态
  reload()
  if (result.ok) {
    errorMessage.value = result.message
  }
}

function reload() {
  rows.value = listDeformations({
    keyword: filters.keyword,
    hazardNo: filters.hazardNo,
    status: filters.status,
    abnormalOnly: filters.abnormalOnly,
  })
}

onMounted(reload)
</script>

<style scoped>
.filter-check {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}
.row-abnormal {
  background: #fef3f2;
}
.badge-abnormal {
  color: #b42318;
  background: #fee4e2;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
}
.badge-normal {
  color: #067647;
  background: #dcfae6;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
}
.conflict-text {
  color: #b54708;
}
</style>
