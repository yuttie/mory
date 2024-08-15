<template>
  <div class="task">
    <v-container>
      <v-row>
        <v-col>
          <v-text-field
            label="Name"
            autofocus
            hide-details="auto"
            prepend-icon="mdi-pencil"
            v-bind:value="value.name"
            v-on:input="$emit('input', { ...value, name: $event })"
            ></v-text-field>
        </v-col>
      </v-row>
      <v-row>
        <v-col>
          <v-combobox
            v-bind:value="value.tags"
            v-on:input="$emit('input', { ...value, tags: $event })"
            v-bind:items="tagItems"
            v-bind:return-object="false"
            chips
            clearable
            hide-details="auto"
            label="Tags"
            multiple
            prepend-icon="mdi-tag-multiple-outline"
          >
            <template v-slot:selection="{ attrs, item, select, selected }">
              <v-chip
                v-bind="attrs"
                v-bind:input-value="selected"
                close
                small
                v-on:click="select"
                v-on:click:close="removeTag(item)"
              >
                <span>{{ item }}</span>
              </v-chip>
            </template>
          </v-combobox>
        </v-col>
      </v-row>
      <v-row>
        <v-col>
          <v-menu
            v-model="scheduleMenu"
            v-bind:close-on-content-click="false"
            v-bind:nudge-right="40"
            offset-y
            min-width="auto"
          >
            <template v-slot:activator="{ on, attrs }">
              <v-text-field
                v-bind:value="value.schedule"
                v-on:input="$emit('input', { ...value, schedule: $event })"
                label="Schedule on"
                prepend-icon="mdi-calendar"
                readonly
                clearable
                hide-details="auto"
                v-bind="attrs"
                v-on="on"
              ></v-text-field>
            </template>
            <v-date-picker
              v-bind:value="value.schedule"
              v-on:input="$emit('input', { ...value, schedule: $event }); scheduleMenu = false;"
            ></v-date-picker>
          </v-menu>
        </v-col>
        <v-col cols="auto">
          <v-btn
            text
            v-on:click="setScheduleToday"
          >Today</v-btn>
        </v-col>
      </v-row>
      <v-row>
        <v-col>
          <v-menu
            v-model="deadlineMenu"
            v-bind:close-on-content-click="false"
            v-bind:nudge-right="40"
            offset-y
            min-width="auto"
          >
            <template v-slot:activator="{ on, attrs }">
              <v-text-field
                v-bind:value="value.deadline"
                v-on:input="$emit('input', { ...value, deadline: $event })"
                label="Deadline"
                prepend-icon="mdi-calendar"
                readonly
                clearable
                hide-details="auto"
                v-bind="attrs"
                v-on="on"
              ></v-text-field>
            </template>
            <v-date-picker
              v-bind:value="value.deadline"
              v-on:input="$emit('input', { ...value, deadline: $event }); deadlineMenu = false;"
            ></v-date-picker>
          </v-menu>
        </v-col>
        <v-col cols="auto">
          <v-checkbox
            label="Done"
            v-bind:input-value="value.done"
            v-bind:value="value.done"
            v-on:change="$emit('input', { ...value, done: $event })"
          ></v-checkbox>
        </v-col>
      </v-row>
      <v-row>
        <v-col>
          <v-textarea
            label="Note"
            hide-details="auto"
            v-bind:value="value.note"
            v-on:input="$emit('input', { ...value, note: $event })"
            prepend-icon="mdi-text"
          ></v-textarea>
        </v-col>
      </v-row>
    </v-container>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, defineProps, defineEmits, defineExpose } from 'vue';

import { useRouter, useRoute } from '@/composables/vue-router';

import type { Task } from '@/api';

import dayjs from 'dayjs';

// Props
const props = defineProps<{
  value?: Task;
  knownTags?: [string, number][];
}>();

// Emits
const emit = defineEmits<{
  (e: 'input', task: Task): void;
}>();

// Reactive states
const deadlineMenu = ref(false);
const scheduleMenu = ref(false);

// Computed properties
const tagItems = computed((): { text: string; value: string; }[] => {
  return props.knownTags.map(([tag, count]) => {
    return {
      text: `${tag} (${count})`,
      value: tag,
    };
  });
});

// Methods
function setScheduleToday() {
  // FIXME We should emit an event instead like we do in template for bidirectional binding
  props.value.schedule = dayjs().format('YYYY-MM-DD');  // eslint-disable-line vue/no-mutating-props
}

function removeTag(tag: string) {
  // FIXME We should emit an event instead like we do in template for bidirectional binding
  props.value.tags.splice(props.value.tags.indexOf(tag), 1);  // eslint-disable-line vue/no-mutating-props
}

// Expose properties
defineExpose({
  setScheduleToday,
  removeTag,
});
</script>

<style scoped lang="scss">
.task {
}
</style>
