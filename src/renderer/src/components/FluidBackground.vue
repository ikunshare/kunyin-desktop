<script setup lang="ts">
defineProps<{ colors: string[] }>()

// 每个色块的位置/尺寸/时长（错开，形成缓慢流动）
const layout = [
  { top: '-10%', left: '-5%', size: '70%', dur: '18s', delay: '0s' },
  { top: '20%', left: '55%', size: '65%', dur: '22s', delay: '-6s' },
  { top: '50%', left: '10%', size: '75%', dur: '26s', delay: '-12s' },
  { top: '35%', left: '40%', size: '60%', dur: '20s', delay: '-3s' },
  { top: '5%', left: '30%', size: '68%', dur: '24s', delay: '-9s' }
]
</script>

<template>
  <div class="fluid" :style="{ backgroundColor: colors[colors.length - 1] || '#1a2029' }">
    <div
      v-for="(c, i) in colors"
      :key="i"
      class="blob"
      :style="{
        backgroundColor: c,
        top: layout[i % layout.length].top,
        left: layout[i % layout.length].left,
        width: layout[i % layout.length].size,
        height: layout[i % layout.length].size,
        animationDuration: layout[i % layout.length].dur,
        animationDelay: layout[i % layout.length].delay
      }"
    />
  </div>
</template>

<style scoped>
.fluid {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(90px);
  opacity: 0.85;
  will-change: transform;
  animation-name: drift;
  animation-timing-function: ease-in-out;
  animation-iteration-count: infinite;
  animation-direction: alternate;
}
@keyframes drift {
  0% {
    transform: translate(0, 0) scale(1);
  }
  50% {
    transform: translate(8%, 6%) scale(1.15);
  }
  100% {
    transform: translate(-6%, -4%) scale(0.95);
  }
}
@media (prefers-reduced-motion: reduce) {
  .blob {
    animation: none;
  }
}
</style>
