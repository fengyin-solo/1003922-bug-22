<template>
  <section class="page" data-module="deformation-detail">
    <header class="page-head">
      <div>
        <h2>形变记录详情</h2>
        <p class="page-desc">校核写入、异常判定与复测版本都围绕这条记录展开，裂缝页读的是同一份数据。</p>
      </div>
      <div class="page-actions">
        <button class="btn ghost" type="button" @click="goBack">返回形变观测列表</button>
      </div>
    </header>

    <template v-if="record">
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">记录编号</span>
          <strong class="stat-value">{{ record['记录编号'] }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">当前状态</span>
          <strong class="stat-value">{{ record.status }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">观测版本</span>
          <strong class="stat-value">第 {{ record['观测版本'] }} 次</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">数据版本</span>
          <strong class="stat-value">v{{ record.version }}</strong>
        </article>
      </div>

      <table class="data-table detail-table">
        <tbody>
          <tr v-for="field in detailFields" :key="field">
            <th>{{ field }}</th>
            <td>{{ record[field] ?? '—' }}</td>
          </tr>
        </tbody>
      </table>

      <div class="action-bar">
        <button
          v-for="action in availableActions"
          :key="action"
          class="btn"
          type="button"
          @click="runAction(action)"
        >
          {{ action }}
        </button>
      </div>

      <form v-if="canRetest" class="filter-bar retest-bar" @submit.prevent="submitRetest">
        <label class="filter-item">
          <span>复测裂缝宽度（mm）</span>
          <input v-model="retestWidth" type="number" min="0" step="0.1" placeholder="录入复测后的新宽度" />
        </label>
        <button class="btn primary" type="submit">提交复测（生成新观测版本）</button>
      </form>

      <h3 class="section-title">关联裂缝测点（与裂缝监测页同源）</h3>
      <table class="data-table">
        <thead>
          <tr><th>测点编号</th><th>裂缝编号</th><th>初始宽度</th><th>当前宽度</th><th>测点状态</th></tr>
        </thead>
        <tbody>
          <tr v-for="crack in linkedCracks" :key="String(crack.id)">
            <td>{{ crack['测点编号'] }}</td>
            <td>{{ crack['裂缝编号'] }}</td>
            <td>{{ crack['初始宽度'] }}</td>
            <td>{{ crack['当前宽度'] }}</td>
            <td>{{ crack.status }}</td>
          </tr>
          <tr v-if="!linkedCracks.length">
            <td colspan="5" class="empty-state">该隐患点暂无关联裂缝测点</td>
          </tr>
        </tbody>
      </table>

      <h3 class="section-title">异常记录（历史异常按当时宽度保留）</h3>
      <table class="data-table">
        <thead>
          <tr><th>观测版本</th><th>异常时宽度</th><th>标记时间</th><th>标记人</th><th>处理状态</th><th>推翻时间</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in anomalies" :key="String(item.id)">
            <td>第 {{ item['观测版本'] }} 次</td>
            <td>{{ item['异常时宽度'] }}</td>
            <td>{{ item['标记时间'] }}</td>
            <td>{{ item['标记人'] }}</td>
            <td>{{ item.status }}</td>
            <td>{{ item['推翻时间'] || '—' }}</td>
          </tr>
          <tr v-if="!anomalies.length">
            <td colspan="6" class="empty-state">暂无异常记录</td>
          </tr>
        </tbody>
      </table>

      <h3 class="section-title">历史观测版本（旧值只读）</h3>
      <table class="data-table">
        <thead>
          <tr><th>观测版本</th><th>裂缝宽度</th><th>当时状态</th><th>操作</th><th>时间</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in history" :key="String(item.id)">
            <td>第 {{ item['观测版本'] }} 次</td>
            <td>{{ item['裂缝宽度'] }}</td>
            <td>{{ item['记录状态'] }}</td>
            <td>{{ item['操作'] }}</td>
            <td>{{ item['时间'] }}</td>
          </tr>
          <tr v-if="!history.length">
            <td colspan="5" class="empty-state">暂无历史版本，复测后会在这里留档</td>
          </tr>
        </tbody>
      </table>
    </template>

    <p v-else class="empty-state">没有找到这条形变记录，可能已被重置。</p>

    <footer class="page-foot">
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  confirmCheck,
  getDeformation,
  listAnomalies,
  listLinkedCracks,
  listVersionHistory,
  markAbnormal,
  retest,
  submitCheck,
} from '@/api/deformation-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()

const recordId = Number(route.params.id)
const detailFields = ["记录编号", "隐患点编号", "观测日期", "裂缝宽度", "水平位移量", "垂直位移量", "观测人", "记录状态"]

const record = ref<EntryRow | undefined>(undefined)
const linkedCracks = ref<EntryRow[]>([])
const anomalies = ref<EntryRow[]>([])
const history = ref<EntryRow[]>([])
const retestWidth = ref('')
const errorMessage = ref('')
const noticeMessage = ref('')

const availableActions = computed<string[]>(() => {
  if (!record.value) {
    return []
  }
  switch (String(record.value.status)) {
    case '已观测':
      return ['提交校核', '标记异常']
    case '待校核':
      return ['确认校核', '标记异常']
    default:
      return []
  }
})

const canRetest = computed(() => !!record.value && ['异常值', '需复测'].includes(String(record.value.status)))

function goBack() {
  router.push('/deformation')
}

function runAction(action: string) {
  if (!record.value) {
    return
  }
  errorMessage.value = ''
  noticeMessage.value = ''
  const expectedVersion = Number(record.value.version)
  let result
  switch (action) {
    case '提交校核':
      result = submitCheck(recordId, expectedVersion)
      break
    case '确认校核':
      result = confirmCheck(recordId, expectedVersion)
      break
    case '标记异常':
      result = markAbnormal(recordId, expectedVersion, session.operator)
      break
    default:
      return
  }
  if (!result.ok) {
    errorMessage.value = result.message
    // 冲突或状态已变：重新读取，页面展示先成功的结果。
    reload()
    return
  }
  noticeMessage.value = result.message
  reload()
}

function submitRetest() {
  if (!record.value) {
    return
  }
  errorMessage.value = ''
  noticeMessage.value = ''
  const width = Number(retestWidth.value)
  const result = retest(recordId, Number(record.value.version), width, session.operator)
  if (!result.ok) {
    errorMessage.value = result.message
    reload()
    return
  }
  retestWidth.value = ''
  noticeMessage.value = result.message
  reload()
}

function reload() {
  record.value = getDeformation(recordId)
  if (record.value) {
    linkedCracks.value = listLinkedCracks(String(record.value['隐患点编号']))
    anomalies.value = listAnomalies(recordId)
    history.value = listVersionHistory(recordId)
  }
}

onMounted(reload)
</script>
