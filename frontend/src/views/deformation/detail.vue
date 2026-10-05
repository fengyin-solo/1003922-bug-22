<template>
  <section class="page" data-module="deformation-detail">
    <header class="page-head">
      <div>
        <h2>形变记录详情 · {{ record?.recordNo ?? '—' }}</h2>
        <p class="page-desc">版本只追加不回写：异常推翻会生成新版本，历史异常按当时宽度保留；操作需匹配当前版本，并发冲突时后到一方不生效。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/deformation">返回列表</RouterLink>
      </div>
    </header>

    <p v-if="notFound" class="error-text">没有找到该形变记录。</p>

    <template v-else-if="record && latest">
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">当前版本</span>
          <strong class="stat-value">v{{ latest.version }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">当前状态</span>
          <strong class="stat-value">{{ latest.status }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">认定裂缝宽度</span>
          <strong class="stat-value">{{ latest.widthMm }} mm</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">异常标记</span>
          <strong class="stat-value" :class="latest.abnormal ? 'abnormal-text' : 'normal-text'">
            {{ latest.abnormal ? '异常' : '正常' }}
          </strong>
        </article>
      </div>

      <table class="data-table detail-table">
        <tbody>
          <tr><th>记录编号</th><td>{{ record.recordNo }}</td><th>隐患点编号</th><td>{{ record.hazardNo }}</td></tr>
          <tr><th>观测日期</th><td>{{ record.observedAt }}</td><th>观测人</th><td>{{ record.observer }}</td></tr>
          <tr><th>水平位移量</th><td>{{ record.horizontalMm }} mm</td><th>垂直位移量</th><td>{{ record.verticalMm }} mm</td></tr>
        </tbody>
      </table>

      <section class="action-panel">
        <h3>处置动作（基于 v{{ latest.version }}）</h3>

        <div v-if="latest.status === '已观测'" class="action-row">
          <button class="btn primary" type="button" :disabled="busy" @click="doSubmit">提交校核</button>
          <span class="action-hint">提交后进入待校核，宽度沿用最新观测值（{{ latest.widthMm }}mm）。</span>
        </div>

        <div v-if="latest.status === '待校核'" class="action-row">
          <label>
            校核认定宽度(mm)
            <input v-model="confirmWidth" type="number" min="0" step="0.1" :placeholder="String(latest.widthMm)" />
          </label>
          <button class="btn primary" type="button" :disabled="busy" @click="doConfirm">确认校核</button>
          <button class="btn" type="button" :disabled="busy" @click="doMark">标记异常</button>
          <span class="action-hint">
            留空则按 {{ latest.widthMm }}mm 校核；宽度 ≥ {{ ABNORMAL_WIDTH_MM }}mm 自动判异常。
            若原判定有误，确认校核会生成新版本推翻异常，不会改写旧版本。
          </span>
        </div>

        <div v-if="latest.status === '异常值'" class="action-row">
          <button class="btn primary" type="button" :disabled="busy" @click="doArrange">安排复测</button>
          <span class="action-hint">异常值需先安排复测，复测数据上报后再由校核确认是否推翻。</span>
        </div>

        <template v-if="latest.status === '需复测'">
          <div class="action-row">
            <label>
              复测裂缝宽度(mm)
              <input v-model="remeasureWidth" type="number" min="0" step="0.1" placeholder="必填" />
            </label>
            <label>
              复测说明
              <input v-model="remeasureNote" type="text" placeholder="现场复测情况" />
            </label>
            <button class="btn primary" type="button" :disabled="busy" @click="doRemeasure">复测上报</button>
            <span class="action-hint">复测上报写入新版本并回到待校核；是否解除异常以确认校核结果为准。</span>
          </div>
        </template>

        <p v-if="latest.status === '已校核'" class="action-hint">该记录已校核完成。如对结论有异议，可按业务流程重新提交观测，本页不提供回写旧版本的操作。</p>

        <p v-if="message" :class="conflict ? 'conflict-text' : ok ? 'ok-text' : 'error-text'">{{ message }}</p>
      </section>

      <section class="history-panel">
        <h3>版本历史（{{ record.versions.length }} 个版本，不可变）</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>版本</th>
              <th>动作</th>
              <th>裂缝宽度(mm)</th>
              <th>状态</th>
              <th>异常判定</th>
              <th>操作人</th>
              <th>时间</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="v in [...record.versions].reverse()" :key="v.version" :class="{ 'version-abnormal': v.abnormal, 'version-current': v.version === latest.version }">
              <td>v{{ v.version }}</td>
              <td>{{ v.action }}</td>
              <td>{{ v.widthMm }}</td>
              <td>{{ v.status }}</td>
              <td>{{ v.abnormal ? '异常' : '正常' }}</td>
              <td>{{ v.operator }}</td>
              <td>{{ v.createdAt }}</td>
              <td>{{ v.note ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import {
  ABNORMAL_WIDTH_MM,
  arrangeRemeasure,
  confirmVerification,
  getDeformation,
  markAbnormal,
  submitForVerification,
  submitRemeasure,
} from '@/api/deformation-service'
import { useSessionStore } from '@/stores/session'
import type {
  DeformationRecord,
  DeformationSummary,
  MutationResult,
} from '@/data/deformation-types'

const route = useRoute()
const session = useSessionStore()

const record = ref<DeformationRecord | null>(null)
const latest = ref<DeformationSummary | null>(null)
const notFound = ref(false)
const busy = ref(false)
const message = ref('')
const conflict = ref(false)
const ok = ref(false)

const confirmWidth = ref('')
const remeasureWidth = ref('')
const remeasureNote = ref('')

const recordId = computed(() => Number(route.params.id))

function reload() {
  const detail = getDeformation(recordId.value)
  if (!detail) {
    notFound.value = true
    record.value = null
    latest.value = null
    return
  }
  notFound.value = false
  record.value = detail.record
  latest.value = detail.latest
}

function report(result: MutationResult) {
  message.value = result.message
  conflict.value = Boolean(result.conflict)
  ok.value = result.ok
  reload()
  // 冲突或成功都清空输入：冲突时必须基于刷新后的版本重新判断，旧输入不能再写
  confirmWidth.value = ''
  remeasureWidth.value = ''
  remeasureNote.value = ''
}

function baseParams(expectedVersion: number) {
  return { id: recordId.value, expectedVersion, operator: session.operator }
}

function doSubmit() {
  if (!latest.value) return
  busy.value = true
  report(submitForVerification(baseParams(latest.value.version)))
  busy.value = false
}

function doConfirm() {
  if (!latest.value) return
  busy.value = true
  report(
    confirmVerification({
      ...baseParams(latest.value.version),
      widthMm: confirmWidth.value === '' ? null : confirmWidth.value,
    }),
  )
  busy.value = false
}

function doMark() {
  if (!latest.value) return
  busy.value = true
  report(markAbnormal(baseParams(latest.value.version)))
  busy.value = false
}

function doArrange() {
  if (!latest.value) return
  busy.value = true
  report(arrangeRemeasure(baseParams(latest.value.version)))
  busy.value = false
}

function doRemeasure() {
  if (!latest.value) return
  if (remeasureWidth.value === '' || !Number.isFinite(Number(remeasureWidth.value))) {
    message.value = '请填写有效的复测裂缝宽度'
    conflict.value = false
    ok.value = false
    return
  }
  busy.value = true
  report(
    submitRemeasure({
      ...baseParams(latest.value.version),
      widthMm: remeasureWidth.value,
      note: remeasureNote.value || undefined,
    }),
  )
  busy.value = false
}

watch(recordId, reload)
onMounted(reload)
</script>

<style scoped>
.detail-table th {
  width: 14%;
  color: var(--muted);
  font-weight: normal;
}
.abnormal-text {
  color: #b42318;
}
.normal-text {
  color: #067647;
}
.action-panel,
.history-panel {
  margin-top: 16px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
}
.action-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.action-row label {
  display: flex;
  flex-direction: column;
  font-size: 12px;
  color: var(--muted);
  gap: 2px;
}
.action-row input {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.action-hint {
  color: var(--muted);
  font-size: 12px;
  flex-basis: 100%;
}
.ok-text {
  color: #067647;
}
.conflict-text {
  color: #b54708;
  font-weight: 600;
}
.version-abnormal td {
  background: #fef3f2;
}
.version-current td {
  font-weight: 600;
}
</style>
