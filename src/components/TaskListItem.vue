<template>
  <div
    v-on:click="$emit('click', $event)"
    class="task-list-item"
  >
    <input
      type="checkbox"
      v-model="value.done"
      class="task-checkbox"
    >
    <span>{{ value.name }}</span>
  </div>
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
  font-size: 14px;
  background: #ffffff;
  padding: 4px 4px;
  cursor: pointer;

  &:hover {
    background: #eee;
  }

  &.sortable-drag {
    background-color: #ffffff;
  }

  &.sortable-ghost {
    opacity: 0.5;
    background-color: #eeeeee;
  }

  input {
    margin-right: 6px;
    transform: scale(1.2);
  }
}
.task-checkbox {
  pointer-events: none;
}
</style>
