<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { usePlayerStore } from '../stores/player'
import AppIcon from './AppIcon.vue'
import BaseBtn from './BaseBtn.vue'
import BaseCheckbox from './BaseCheckbox.vue'
import BaseInput from './BaseInput.vue'

const emit = defineEmits<{ close: [] }>()
const player = usePlayerStore()
const dialog = ref<HTMLDialogElement>()
const minutes = ref<string | number>(
  player.sleepRemaining ? Math.ceil(player.sleepRemaining / 60) : 30
)
const wait = ref(player.sleepWaitForEnd)
const valid = computed(
  () =>
    Number.isFinite(Number(minutes.value)) &&
    Number(minutes.value) >= 1 &&
    Number(minutes.value) <= 1440
)
const active = computed(() => player.sleepRemaining > 0 || player.stopAfterTrack)
const status = computed(() =>
  player.stopAfterTrack
    ? '本曲播完后暂停'
    : `将在 ${Math.floor(player.sleepRemaining / 60)} 分 ${player.sleepRemaining % 60} 秒后${player.sleepWaitForEnd ? '等待本曲播完再暂停' : '暂停播放'}`
)

// 原生模态进入浏览器顶层，避开播放页的 overflow / transform，并提供焦点约束和恢复。
onMounted(() => dialog.value?.showModal())
function close(): void {
  dialog.value?.close()
  emit('close')
}
function start(): void {
  if (!valid.value) return
  player.setSleep(Number(minutes.value), wait.value)
  close()
}
function cancel(): void {
  player.cancelSleep()
  close()
}
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="sleep-dialog"
      aria-labelledby="sleep-dialog-title"
      @cancel.prevent="close"
      @click.self="close"
    >
      <form class="sleep-dialog-content" @submit.prevent="start">
        <header>
          <h2 id="sleep-dialog-title"><AppIcon name="clock" :size="21" />定时暂停</h2>
          <BaseBtn min outline type="button" aria-label="关闭定时暂停" @click="close"
            ><AppIcon name="close" :size="16"
          /></BaseBtn>
        </header>
        <p v-if="active" class="status">{{ status }}</p>
        <p v-else>设定时间，让音乐陪你安心休息。</p>
        <div class="presets" role="group" aria-label="选择暂停时间">
          <BaseBtn
            v-for="n in [15, 30, 60, 90]"
            :key="n"
            type="button"
            :class="{ selected: Number(minutes) === n }"
            :aria-pressed="Number(minutes) === n"
            @click="minutes = n"
            >{{ n }} 分钟</BaseBtn
          >
        </div>
        <label class="custom"
          >自定义时间
          <BaseInput
            v-model="minutes"
            type="number"
            min="1"
            max="1440"
            step="any"
            required
            aria-label="定时暂停分钟数"
          />
          分钟</label
        >
        <BaseCheckbox
          id="sleep-wait-end"
          :model-value="wait"
          label="等当前歌曲播完再暂停"
          @update:model-value="wait = !!$event"
        />
        <footer>
          <BaseBtn v-if="active" type="button" outline @click="cancel">取消定时</BaseBtn>
          <BaseBtn class="start" type="submit" :disabled="!valid">{{
            active ? '更新定时' : '开始计时'
          }}</BaseBtn>
        </footer>
      </form>
    </dialog>
  </Teleport>
</template>

<style scoped>
.sleep-dialog {
  zoom: var(--app-zoom, 1);
  margin: auto;
  padding: 0;
  width: min(420px, calc(100% - 32px));
  max-height: calc(100% - 32px);
  overflow: auto;
  border: 1px solid var(--color-primary-alpha-900);
  border-radius: 16px;
  background:
    linear-gradient(var(--color-main-background), var(--color-main-background)),
    var(--color-content-background);
  color: var(--color-font);
  box-shadow: 0 18px 60px #0005;
  -webkit-app-region: no-drag;
}
.sleep-dialog::backdrop {
  background: #0006;
}
.sleep-dialog-content {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  font-size: 13px;
}
header,
h2,
footer,
.custom {
  display: flex;
  align-items: center;
  gap: 10px;
}
header {
  justify-content: space-between;
}
h2 {
  font-size: 18px;
  font-weight: 600;
}
p {
  color: var(--color-font-label);
  line-height: 1.6;
}
.status {
  color: var(--color-primary-font);
}
.presets {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.presets .btn {
  padding: 8px 4px;
}
.selected,
.start {
  color: var(--color-button-font-selected);
  background: var(--color-button-background-selected);
  border-color: var(--color-primary-alpha-400);
}
.custom .field {
  width: 88px;
}
footer {
  justify-content: flex-end;
  margin-top: 4px;
}
</style>
