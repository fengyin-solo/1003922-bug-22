<template>
  <section class="page" data-module="crack">
    <header class="page-head">
      <div>
        <h2>裂缝监测管理</h2>
        <p class="page-desc">
          维护裂缝测点，测点只登记初始宽度；当前宽度、变化速率与异常标记统一读取对应隐患点最新一版形变观测结果，
          校核、复测、推翻异常后刷新本页立即一致，不再残留旧宽度。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记裂缝测点</button>
        <button class="btn" type="button" @click="reload">刷新形变结果</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statsCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>测点编号</span>
        <input v-model="keyword" placeholder="按测点编号检索" />
      </label>
      <label class="filter-item">
        <span>隐患点编号</span>
        <input v-model="hazardNo" placeholder="按隐患点编号检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>测点编号</th>
          <th>隐患点编号</th>
          <th>裂缝编号</th>
          <th>初始宽度(mm)</th>
          <th>当前宽度(mm)</th>
          <th>相对变化(%)</th>
          <th>形变状态</th>
          <th>异常标记</th>
          <th>数据版本</th>
          <th>来源记录 / 观测日期</th>
          <th>监测人</th>
          <th>测点动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in filteredRows" :key="row.id" :class="{ 'row-abnormal': row.latest?.abnormal }">
          <td>{{ row.pointNo }}</td>
          <td>{{ row.hazardNo }}</td>
          <td>{{ row.crackNo }}</td>
          <td>{{ row.initialWidthMm ?? '—' }}</td>
          <td>{{ row.latest ? row.latest.widthMm : '暂无形变观测' }}</td>
          <td>{{ row.latest?.changeRate ?? '—' }}</td>
          <td>{{ row.latest ? row.latest.status : '—' }}</td>
          <td>
            <span v-if="row.latest?.abnormal" class="badge-abnormal">异常</span>
            <span v-else class="badge-normal">正常</span>
          </td>
          <td>{{ row.latest ? `v${row.latest.version}` : '—' }}</td>
          <td>
            <RouterLink v-if="row.latest" class="link" :to="`/deformation/${row.latest.recordId}`">
              {{ row.latest.recordNo }} / {{ row.latest.observedAt }}
            </RouterLink>
            <span v-else>—</span>
          </td>
          <td>{{ row.monitor }}</td>
          <td class="row-actions">
            <button
              v-for="action in pointActions"
              :key="action"
              class="link"
              type="button"
              @click="runPointAction(action, row.id)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!filteredRows.length">
          <td colspan="12" class="empty-state">暂无符合条件的裂缝测点</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ rows.length }} 个裂缝测点；当前宽度取隐患点最新版本形变记录，异常阈值 {{ ABNORMAL_WIDTH_MM }}mm</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { ABNORMAL_WIDTH_MM, crackWidthRows } from '@/api/deformation-service'
import { runAction as applyPointAction } from '@/api/local-service'
import type { CrackWidthRow } from '@/data/deformation-types'

const statuses = ['正常', '加速发展', '趋于稳定', '已修复', '已废弃']
const pointActions = ['记录数据', '标记加速', '确认稳定']

const rows = ref<CrackWidthRow[]>([])
const keyword = ref('')
const hazardNo = ref('')
const errorMessage = ref('')

const filteredRows = computed(() =>
  rows.value.filter(
    (row) =>
      (!keyword.value.trim() || row.pointNo.includes(keyword.value.trim())) &&
      (!hazardNo.value.trim() || row.hazardNo.includes(hazardNo.value.trim())),
  ),
)

// 测点总数、加速发展数沿用测点自身状态；正常测点数以「最新形变结果不异常」为准，避免两边口径打架。
const statsCards = computed(() => [
  { label: '测点总数', value: rows.value.length },
  { label: '加速发展数', value: rows.value.filter((row) => row.pointStatus === '加速发展').length },
  { label: '形变正常测点数', value: rows.value.filter((row) => row.latest && !row.latest.abnormal).length },
])

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => row.pointStatus === status).length,
  })),
)

function resetFilters() {
  keyword.value = ''
  hazardNo.value = ''
}

function openCreate() {
  errorMessage.value = '裂缝测点登记入口尚未接入审批流'
}

// 测点自身状态流转仍走通用台账；宽度/异常标记不受影响，只来自形变版本数据。
function runPointAction(action: string, id: number) {
  errorMessage.value = ''
  const result = applyPointAction('crack', id, action)
  reload()
  if (!result.ok) {
    errorMessage.value = result.message
  }
}

function reload() {
  errorMessage.value = ''
  rows.value = crackWidthRows()
}

onMounted(reload)
</script>

<style scoped>
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
</style>
