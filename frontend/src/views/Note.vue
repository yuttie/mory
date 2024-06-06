<template>
  <div id="note">
    <EditableViewer v-on:tokenExpired="$emit('tokenExpired')"></EditableViewer>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick, defineProps, defineEmits, defineExpose } from 'vue';
import type { Ref } from 'vue';

import { useRouter, useRoute } from '@/composables/vue-router';
import { useVuetify } from '@/composables/vuetify';

import EditableViewer from '@/components/EditableViewer.vue';

// Emits
const emit = defineEmits<{
  (e: 'tokenExpired', callback: () => void): void;
}>();
</script>

<style scoped lang="scss">
#note {
  display: flex;
  flex-direction: row;

  & > * {
    flex: 1 1;
    min-width: 0;
  }
}
</style>
