<template>
  <div class="tasks d-flex flex-column">
    <div>
      <h2>New Task</h2>
      <v-text-field
        label="Name"
        v-model="newName"
      ></v-text-field>
      <v-menu
        v-model="newDeadlineMenu"
        v-bind:close-on-content-click="false"
        v-bind:nudge-right="40"
        transition="scale-transition"
        offset-y
        min-width="auto"
      >
        <template v-slot:activator="{ on, attrs }">
          <v-text-field
            v-model="newDeadline"
            label="Deadline"
            prepend-icon="mdi-calendar"
            readonly
            v-bind="attrs"
            v-on="on"
          ></v-text-field>
        </template>
        <v-date-picker
          v-model="newDeadline"
          @input="menu2 = false"
        ></v-date-picker>
      </v-menu>
      <v-menu
        v-model="newScheduleMenu"
        v-bind:close-on-content-click="false"
        v-bind:nudge-right="40"
        transition="scale-transition"
        offset-y
        min-width="auto"
      >
        <template v-slot:activator="{ on, attrs }">
          <v-text-field
            v-model="newSchedule"
            label="Schedule on"
            prepend-icon="mdi-calendar"
            readonly
            v-bind="attrs"
            v-on="on"
          ></v-text-field>
        </template>
        <v-date-picker
          v-model="newSchedule"
          @input="menu2 = false"
        ></v-date-picker>
      </v-menu>
      <v-checkbox
        label="Done"
        v-model="newDone"
      ></v-checkbox>
      <v-combobox
        v-model="newTags"
        v-bind:items="tags"
        chips
        clearable
        label="Your favorite hobbies"
        multiple
        prepend-icon="mdi-filter-variant"
        solo
      >
        <template v-slot:selection="{ attrs, item, select, selected }">
          <v-chip
            v-bind="attrs"
            v-bind:input-value="selected"
            close
            @click="select"
            @click:close="remove(item)"
          >
            <span>{{ item }}</span>
          </v-chip>
        </template>
      </v-combobox>
      <v-textarea
        label="Note"
        v-model="newNote"
      ></v-textarea>
      <v-btn
        v-on:click="add"
        v-bind:disabled="newName.length === 0"
      >Add</v-btn>
    </div>
    <div>
      <h2>Backlog</h2>
      <ol>
        <li v-for="task of tasks.backlog" v-bind:key="task">{{ task }}</li>
      </ol>
    </div>
    <div>
      <h2>Scheduled</h2>
      <div v-for="(tasks, day) of tasks.scheduled" v-bind:key="day">
        <h3>{{ day }}</h3>
        <ol>
          <li v-for="task of tasks" v-bind:key="task">{{ task }}</li>
        </ol>
      </div>
    </div>
    <v-overlay v-bind:value="isLoading" z-index="10" opacity="0">
      <v-progress-circular indeterminate color="blue-grey lighten-3" size="64"></v-progress-circular>
    </v-overlay>
    <v-snackbar v-model="error" color="error" top timeout="5000">{{ errorText }}</v-snackbar>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Watch, Vue } from 'vue-property-decorator';

import * as api from '@/api';
import { isMetadataEventMultiple, ListEntry, validateEvent } from '@/api';
import Color from 'color';
import materialColors from 'vuetify/lib/util/colors';
import dayjs from 'dayjs';
import YAML from 'yaml';

@Component
export default class Tasks extends Vue {
  tasks: any = [];
  newName = '';
  newDeadline: null | string = null;
  newSchedule: null | string = null;
  newDone = false;
  newTags: string[] = [];
  newNote = '';
  isLoading = false;
  error = false;
  errorText = '';

  mounted() {
    document.title = `Tasks | ${process.env.VUE_APP_NAME}`;
    this.load();
  }

  async load() {
    this.isLoading = true;
    try {
      const res = await api.getNote('.mory/tasks.yaml');
      this.tasks = YAML.parse(res.data);
      console.log(this.tasks);
      this.isLoading = false;
    }
    catch (error) {
      if (error.response) {
        if (error.response.status === 401) {
          // Unauthorized
          this.$emit('tokenExpired', () => this.load());
        }
        else if (error.response.status === 404) {
          // Create a new one
          await api.addNote('.mory/tasks.yaml', YAML.stringify({
            backlog: [],
            scheduled: {},
          }));
          this.load();
        }
        else {
          this.error = true;
          this.errorText = error.response;
          console.log('Unhandled error: {}', error.response);
          this.isLoading = false;
        }
      }
      else {
        this.error = true;
        this.errorText = error.toString();
        console.log('Unhandled error: {}', error);
        this.isLoading = false;
      }
    }
  }

  async add() {
    const task: any = {
      name: this.newName,
    };
    if (this.newDeadline) { task.deadline = this.newDeadline; }
    if (this.newDone) { task.done = this.newDone; }
    if (this.newTags.length > 0) { task.tags = this.newTags; }
    if (this.newNote.length > 0) { task.note = this.newNote; }
    if (this.newSchedule !== null) {
      if (!Object.prototype.hasOwnProperty.call(this.tasks.scheduled, this.newSchedule)) {
        this.tasks.scheduled[this.newSchedule] = [];
      }
      this.tasks.scheduled[this.newSchedule].push(task);
    }
    else {
      this.tasks.backlog.push(task);
    }
    this.newName = '';
    this.newDeadline = null;
    this.newSchedule = null;
    this.newDone = false;
    this.newTags = [];
    this.newNote = '';

    api.addNote('.mory/tasks.yaml', YAML.stringify(this.tasks));
  }
}
</script>

<style scoped lang="scss">
.tasks {
  height: 100%;
}
</style>
