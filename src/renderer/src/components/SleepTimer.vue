<script setup lang="ts">
import { computed, ref } from 'vue'
import { usePlayerStore } from '../stores/player'
import AppIcon from './AppIcon.vue'
import SleepTimerDialog from './SleepTimerDialog.vue'
const player = usePlayerStore()
const open = ref(false)
const label = computed(() =>
  player.sleepRemaining
    ? `${Math.floor(player.sleepRemaining / 60)}:${String(player.sleepRemaining % 60).padStart(2, '0')}`
    : player.stopAfterTrack
      ? '本曲播完暂停'
      : '定时暂停'
)
</script>
<template>
  <div class="sleep-control" @keydown.esc="open = false">
    <button
      class="timer"
      :title="label"
      :aria-label="label"
      aria-haspopup="dialog"
      @click="open = !open"
    >
      <AppIcon name="clock" :size="17" /><span
        v-if="player.sleepRemaining || player.stopAfterTrack"
        >{{ label }}</span
      >
    </button>
    <SleepTimerDialog v-if="open" @close="open = false" />
  </div>
</template>
<style scoped>
.sleep-control {
  position: relative;
}
.timer {
  display: flex;
  gap: 4px;
  align-items: center;
  font-size: 10px;
  padding: 6px;
  border-radius: 6px;
  color: var(--color-primary-font);
}
.timer:hover {
  color: var(--color-primary-font-hover);
  background: var(--color-primary-background-hover);
}
.timer:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
</style>
