<template>
  <img v-if="email" class="gravatar" v-bind:src="url">
</template>

<script lang="ts" setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick, defineProps, defineEmits, defineExpose } from 'vue';
import type { Ref } from 'vue';

import md5 from 'md5';

// Props
const props = defineProps<{
  email?: string | null;
}>();

// Computed properties
const emailHash = computed(() => {
  if (this.email) {
    return md5(this.email);
  }
  else {
    return null;
  }
});

const url = (() => {
  return `https://www.gravatar.com/avatar/${this.emailHash}?size=24&default=identicon`;
});
</script>

<style scoped lang="scss">
.gravatar {
  vertical-align: middle;
  border-radius: 50%;
  margin: 0;
}
</style>
