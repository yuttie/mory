<template>
  <div
    v-on:click="$emit('click', $event)"
    class="task-list-item"
  >
    <span
      v-on:click.stop="toggleDone"
    >
      <v-icon
        v-if="!value.done"
      >mdi-checkbox-blank-outline</v-icon>
      <v-icon
        color="primary"
        v-if="value.done"
      >mdi-checkbox-marked</v-icon>
    </span>
    <span
      class="tag"
      v-for="tag of value.tags"
      v-bind:key="tag"
    >{{ tag }}</span>
    <span>{{ value.name }}</span>
    <span
      class="additional-info"
      v-if="value.note"
    >
      <v-icon small>mdi-note-text-outline</v-icon>
    </span>
    <span
      class="additional-info"
      v-if="value.deadline"
      v-bind:style="deadlineStyle(value.deadline)"
    >
      <v-icon small>mdi-calendar</v-icon>{{ value.deadline }}
    </span>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Watch, Vue } from 'vue-property-decorator';

import { Task } from '@/api';

import dayjs from 'dayjs';

@Component
export default class TaskEditor extends Vue {
  @Prop() readonly value!: Task;

  deadlineStyle(date: string) {
    const now = dayjs();
    const daysLeft = dayjs(date).diff(now, 'day');
    const r = daysLeft < 7 ? 255 : 0;
    const color = `rgb(${r}, 0, 0)`;
    return {
      color: color,
    };
  }

  toggleDone() {
    this.value.done = !this.value.done;
    this.$emit('change');
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

  &.sortable-chosen {
    background-color: #ffffff;
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
.additional-info {
  margin-left: 4px;
  opacity: 0.5;
}
.tag {
  color: #888;
  background: #fafafa;
  padding: 1px 2px;
  border: 1px solid #eee;
  margin-right: 3px;
}
</style>
