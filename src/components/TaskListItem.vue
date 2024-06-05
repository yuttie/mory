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
      <v-tooltip bottom>
        <template v-slot:activator="{ on, attrs }">
          <v-icon small v-bind="attrs" v-on="on">mdi-note-text-outline</v-icon>
        </template>
        <div class="note-tooltip">{{ value.note }}</div>
      </v-tooltip>
    </span>
    <span
      class="additional-info"
      v-if="value.deadline"
      v-bind:style="deadlineStyle"
    >
      <v-tooltip bottom>
        <template v-slot:activator="{ on, attrs }">
          <span v-bind="attrs" v-on="on">
            <v-icon small v-bind:style="deadlineStyle" class="mr-1">mdi-calendar</v-icon>{{ deadlineText }}
          </span>
        </template>
        <div>{{ value.deadline }}</div>
      </v-tooltip>
    </span>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick, defineProps, defineEmits, defineExpose } from 'vue';
import type { Ref } from 'vue';

import { useRouter, useRoute } from '@/composables/vue-router';
import { useVuetify } from '@/composables/vuetify';

import { Task } from '@/api';

import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
dayjs.extend(relativeTime, {
  thresholds: [
    { l: 's', r: 1 },
    { l: 'm', r: 1 },
    { l: 'mm', r: 59, d: 'minute' },
    { l: 'h', r: 1 },
    { l: 'hh', r: 23, d: 'hour' },
    { l: 'd', r: 1 },
    { l: 'dd', d: 'day' },
    { l: 'M' },
    { l: 'MM', d: 'month' },
    { l: 'y' },
    { l: 'yy', d: 'year' }
  ],
});

// Props
const props = defineProps<{
  value?: Task;
}>();

// Emits
const emit = defineEmits<{
  (e: 'click', event: Event): void;
  (e: 'done-toggle', event: Event): void;
}>();

// Computed properties
const deadlineText = ((): string => {
  if (typeof props.value.deadline === 'string') {
    return dayjs(props.value.deadline).endOf('day').fromNow();
  }
  else {
    return '';
  }
});

const deadlineStyle = ((): Record<string, string> => {
  if (!props.value.done && props.value.deadline) {
    const now = dayjs();
    const daysLeft = dayjs(props.value.deadline).diff(now, 'day');
    const r = daysLeft < 7 ? 255 : 0;
    const color = `rgb(${r}, 0, 0)`;
    return {
      color: color,
    };
  }
  else {
    return {};
  }
});
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
.note-tooltip {
  white-space: pre-wrap;
}
</style>
