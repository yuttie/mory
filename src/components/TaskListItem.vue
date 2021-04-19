<template>
  <v-list-item
    v-on:click="$emit('click', $event)"
    class="task-list-item text-body-2"
  >
    <v-list-item-action>
      <v-checkbox
        dense
        v-bind:value="value.done"
        v-on:change="value.done = $event"
        class="task-checkbox"
      ></v-checkbox>
    </v-list-item-action>
    <v-list-item-content>
      {{ value.name }}
    </v-list-item-content>
  </v-list-item>
</template>

<script lang="ts">
import { Component, Prop, Watch, Vue } from 'vue-property-decorator';

import { Task } from '@/api';

@Component
export default class TaskEditor extends Vue {
  @Prop() readonly value!: Task;
}
</script>

<style scoped lang="scss">
.task-list-item {
}
.task-checkbox {
  pointer-events: none;
}
</style>
