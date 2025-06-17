<template>
  <img class="gravatar" v-bind:src="url">
</template>

<script lang="ts" setup>
import { computed } from 'vue';

import md5 from 'md5';

// Props
const props = defineProps<{
  email: string | null;
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
  return `https://www.gravatar.com/avatar/${emailHash.value}?size=24&default=identicon`;
});
</script>

<style scoped lang="scss">
.gravatar {
  vertical-align: middle;
  border-radius: 50%;
  margin: 0;
}
</style>
