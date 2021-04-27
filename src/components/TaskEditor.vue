<template>
  <div class="task">
    <v-text-field
      label="Name"
      autofocus
      prepend-icon="mdi-pencil"
      v-bind:value="value.name"
      v-on:input="$emit('input', { ...value, name: $event })"
    ></v-text-field>
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
          v-bind="attrs"
          v-on="on"
        ></v-text-field>
      </template>
      <v-date-picker
        v-bind:value="value.deadline"
        v-on:input="$emit('input', { ...value, deadline: $event }); deadlineMenu = false;"
      ></v-date-picker>
    </v-menu>
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
    <v-checkbox
      label="Done"
      v-bind:input-value="value.done"
      v-bind:value="value.done"
      v-on:change="$emit('input', { ...value, done: $event })"
    ></v-checkbox>
    <v-combobox
      v-bind:value="value.tags"
      v-on:input="$emit('input', { ...value, tags: $event })"
      v-bind:items="knownTags"
      chips
      clearable
      label="Tags"
      multiple
      prepend-icon="mdi-tag-multiple-outline"
    >
      <template v-slot:selection="{ attrs, item, select, selected }">
        <v-chip
          v-bind="attrs"
          v-bind:input-value="selected"
          close
          v-on:click="select"
          v-on:click:close="removeTag(item)"
        >
          <span>{{ item }}</span>
        </v-chip>
      </template>
    </v-combobox>
    <v-textarea
      label="Note"
      v-bind:value="value.note"
      v-on:input="$emit('input', { ...value, note: $event })"
      prepend-icon="mdi-text"
    ></v-textarea>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Watch, Vue } from 'vue-property-decorator';

import * as api from '@/api';
import { Task } from '@/api';

import dayjs from 'dayjs';

@Component
export default class TaskEditor extends Vue {
  @Prop() readonly value!: Task;
  @Prop(Array) readonly knownTags!: string[];

  deadlineMenu = false;
  scheduleMenu = false;

  setScheduleToday() {
    this.value.schedule = dayjs().format('YYYY-MM-DD');
  }

  removeTag(tag: string) {
    this.value.tags.splice(this.value.tags.indexOf(tag), 1);
  }
}
</script>

<style scoped lang="scss">
.task {
}
</style>
