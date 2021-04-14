<template>
  <div class="task">
    <v-text-field
      label="Name"
      v-model="value.name"
    ></v-text-field>
    <v-menu
      v-model="deadlineMenu"
      v-bind:close-on-content-click="false"
      v-bind:nudge-right="40"
      transition="scale-transition"
      offset-y
      min-width="auto"
    >
      <template v-slot:activator="{ on, attrs }">
        <v-text-field
          v-model="value.deadline"
          label="Deadline"
          prepend-icon="mdi-calendar"
          readonly
          v-bind="attrs"
          v-on="on"
        ></v-text-field>
      </template>
      <v-date-picker
        v-model="value.deadline"
        v-on:input="deadlineMenu = false"
      ></v-date-picker>
    </v-menu>
    <v-menu
      v-model="scheduleMenu"
      v-bind:close-on-content-click="false"
      v-bind:nudge-right="40"
      transition="scale-transition"
      offset-y
      min-width="auto"
    >
      <template v-slot:activator="{ on, attrs }">
        <v-text-field
          v-model="value.schedule"
          label="Schedule on"
          prepend-icon="mdi-calendar"
          readonly
          v-bind="attrs"
          v-on="on"
        ></v-text-field>
      </template>
      <v-date-picker
        v-model="value.schedule"
        v-on:input="scheduleMenu = false"
      ></v-date-picker>
    </v-menu>
    <v-checkbox
      label="Done"
      v-model="value.done"
    ></v-checkbox>
    <v-combobox
      v-model="value.tags"
      v-bind:items="knownTags"
      chips
      clearable
      label="Tags"
      multiple
      prepend-icon="mdi-filter-variant"
      solo
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
      v-model="value.note"
    ></v-textarea>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Watch, Vue } from 'vue-property-decorator';

import * as api from '@/api';
import { Task } from '@/api';

@Component
export default class TaskEditor extends Vue {
  @Prop() readonly value!: Task;
  @Prop(Array) readonly knownTags!: string[];

  deadlineMenu = false;
  scheduleMenu = false;

  removeTag(tag: string) {
    this.value.tags.splice(this.value.tags.indexOf(tag), 1);
  }
}
</script>

<style scoped lang="scss">
.task {
}
</style>
