<template>
    <img
        class="gravatar"
        v-bind:src="url"
        v-bind:width="size"
        v-bind:height="size"
    >
</template>

<script lang="ts" setup>
import { computed } from 'vue';

import md5 from 'md5';

// Props
const props = defineProps<{
  email: string | null;
  size: number;
}>();

// Computed properties
const emailHash = computed(() => {
  if (props.email !== null) {
    return md5(props.email);
  }
  else {
    return "";
  }
});

const url = computed(() => {
  // Twice the drawn size, so the image stays sharp on a high-density screen.
  return `https://www.gravatar.com/avatar/${emailHash.value}?size=${props.size * 2}&default=identicon`;
});
</script>

<style scoped lang="scss">
.gravatar {
  vertical-align: middle;
  border-radius: 50%;
  margin: 0;
}
</style>
