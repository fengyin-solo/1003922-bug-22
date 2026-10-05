<template>
  <section class="page" data-module="deformation">
    <header class="page-head">
      <div>
        <h2>形变观测管理</h2>
        <p class="page-desc">维护形变记录，围绕记录编号、隐患点编号、观测日期、裂缝宽度做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记形变记录</button>
        <button class="btn" type="button" @click="exportRows">导出形变观测清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
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
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in availableActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <RouterLink class="link" :to="`/deformation/detail/${row.id}`">详情</RouterLink>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无形变观测数据，可先登记形变记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条形变观测记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { downloadEntries } from '@/api/local-service'
import {
  confirmCheck,
  listDeformation,
  markAbnormal,
  submitCheck,
} from '@/api/deformation-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const MODULE_KEY = 'deformation'
const columns = ["记录编号", "隐患点编号", "观测日期", "裂缝宽度", "水平位移量", "垂直位移量", "观测人", "观测版本", "记录状态"]
const statuses = ["已观测", "待校核", "已校核", "异常值", "需复测"]

const router = useRouter()
const session = useSessionStore()

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => [
  { label: '本月观测次数', value: rows.value.length },
  { label: '异常记录数', value: rows.value.filter((row) => String(row.status) === '异常值').length },
  { label: '待校核记录', value: rows.value.filter((row) => String(row.status) === '待校核').length },
])

// 每个状态只放出合法动作，界面上就不会出现重复标记异常这类误操作。
function availableActions(row: EntryRow): string[] {
  switch (String(row.status)) {
    case '已观测':
      return ['提交校核', '标记异常']
    case '待校核':
      return ['确认校核', '标记异常']
    case '异常值':
    case '需复测':
      return ['复测']
    default:
      return []
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(MODULE_KEY)
}

function openCreate() {
  errorMessage.value = '形变记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const id = Number(row.id)
  const expectedVersion = Number(row.version)
  let result
  switch (action) {
    case '提交校核':
      result = submitCheck(id, expectedVersion)
      break
    case '确认校核':
      result = confirmCheck(id, expectedVersion)
      break
    case '标记异常':
      result = markAbnormal(id, expectedVersion, session.operator)
      break
    case '复测':
      // 复测要录入新宽度，统一去详情页操作。
      router.push(`/deformation/detail/${id}`)
      return
    default:
      return
  }
  if (!result.ok) {
    errorMessage.value = result.message
    if (result.conflict) {
      // 并发冲突：别人已先写入，刷新列表展示先成功的结果。
      reload()
    }
    return
  }
  noticeMessage.value = result.message
  reload()
}

function reload() {
  try {
    const payload = listDeformation(filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '形变观测列表读取失败'
  }
}

onMounted(reload)
</script>
