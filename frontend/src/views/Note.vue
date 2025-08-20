<template>
  <div id="note">
    <EditableViewer v-on:tokenExpired="$emit('tokenExpired')"></EditableViewer>
  </div>
</template>

<script lang="ts" setup>
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
