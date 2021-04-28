<template>
  <div
    v-on:click="$emit('click', $event)"
    class="task-list-item"
  >
    <v-simple-checkbox
      color="primary"
      v-bind:ripple="false"
      v-bind:value="value.done"
      v-on:input="$emit('done-toggle', $event)"
    ></v-simple-checkbox>
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
      v-bind:style="deadlineStyle"
    >
      <v-icon small v-bind:style="deadlineStyle">mdi-calendar</v-icon>{{ value.deadline }}
    </span>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Watch, Vue } from 'vue-property-decorator';

import { Task } from '@/api';

import dayjs from 'dayjs';

@Component
export default class TaskListItem extends Vue {
  @Prop() readonly value!: Task;

  get deadlineStyle(): Record<string, string> {
    if (!this.value.done && this.value.deadline) {
      const now = dayjs();
      const daysLeft = dayjs(this.value.deadline).diff(now, 'day');
      const r = daysLeft < 7 ? 255 : 0;
      const color = `rgb(${r}, 0, 0)`;
      return {
        color: color,
      };
    }
    else {
      return {};
    }
  }
}
</script>

<style scoped lang="scss">
.task-list-item {
  font-size: 14px;
  padding: 4px 4px;
  cursor: pointer;
  word-break: break-all;

  &:hover {
    background: #eeeeee;
  }

  &.sortable-chosen {
    background: unset;
  }

  &.sortable-drag {
    background: unset;
  }

  &.sortable-ghost {
    visibility: hidden;
  }

  & > * {
    display: inline;
    vertical-align: middle;
  }
}
.additional-info {
  display: inline-block;
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
