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
    <span
      class="tag"
      v-for="tag of value.tags"
      v-bind:key="tag"
    >{{ tag }}</span>
    <span>{{ value.name }}</span>
    <span
      class="deadline"
      v-if="value.deadline"
      v-bind:style="deadlineStyle(value.deadline)"
    >(Due {{ value.deadline }})</span>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Watch, Vue } from 'vue-property-decorator';

import { Task } from '@/api';

import dayjs from 'dayjs';

@Component
export default class TaskEditor extends Vue {
  @Prop() readonly value!: Task;

  deadlineStyle(date) {
    const now = dayjs();
    const alpha = 0.2 + 0.8 * Math.exp(now.diff(date, 'day'));
    const color = `rgba(255, 0, 0, ${alpha})`;
    return {
      color: color,
    };
  }
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
.deadline {
  color: #e36e6e;
  margin-left: 3px;
}
.tag {
  color: #888;
  background: #fafafa;
  padding: 1px 2px;
  border: 1px solid #eee;
  margin-right: 3px;
}
.task-checkbox {
  pointer-events: none;
}
</style>
