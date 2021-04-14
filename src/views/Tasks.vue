<template>
  <div class="tasks d-flex flex-column">
    <div>
      <h2>New Task</h2>
      <TaskEditor v-model="newTask" v-bind:knownTags="knownTags"></TaskEditor>
      <v-btn
        v-on:click="add"
        v-bind:disabled="newTask.name.length === 0"
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

import TaskEditor from '@/components/TaskEditor.vue';

import * as api from '@/api';
import { Task } from '@/api';
import { isMetadataEventMultiple, ListEntry, validateEvent } from '@/api';
import Color from 'color';
import materialColors from 'vuetify/lib/util/colors';
import dayjs from 'dayjs';
import YAML from 'yaml';

@Component({
  components: {
    TaskEditor,
  },
})
export default class Tasks extends Vue {
  tasks: any = [];
  newTask: Task = {
    name: '',
    deadline: null,
    schedule: null,
    done: false,
    tags: [],
    note: '',
  };
  knownTags: string[] = [];
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

    // Collect tags
    const knownTags: string[] = [];
    for (const task of this.tasks.backlog as Task[]) {
      for (const tag of task.tags || []) {
        if (!knownTags.includes(tag)) {
          knownTags.push(tag);
        }
      }
    }
    for (const [date, tasks] of Object.entries(this.tasks.scheduled)) {
      for (const task of tasks as Task[]) {
        for (const tag of task.tags || []) {
          if (!knownTags.includes(tag)) {
            knownTags.push(tag);
          }
        }
      }
    }
    this.knownTags = knownTags;
  }

  async add() {
    const task: any = {
      name: this.newTask.name,
    };
    if (this.newTask.deadline) { task.deadline = this.newTask.deadline; }
    if (this.newTask.done) { task.done = this.newTask.done; }
    if (this.newTask.tags.length > 0) { task.tags = this.newTask.tags; }
    if (this.newTask.note.length > 0) { task.note = this.newTask.note; }
    if (this.newTask.schedule !== null) {
      if (!Object.prototype.hasOwnProperty.call(this.tasks.scheduled, this.newTask.schedule)) {
        this.tasks.scheduled[this.newTask.schedule] = [];
      }
      this.tasks.scheduled[this.newTask.schedule].push(task);
    }
    else {
      this.tasks.backlog.push(task);
    }
    // Reset
    this.newTask = {
      name: '',
      deadline: null,
      schedule: null,
      done: false,
      tags: [],
      note: '',
    };

    api.addNote('.mory/tasks.yaml', YAML.stringify(this.tasks));
  }
}
</script>

<style scoped lang="scss">
.tasks {
  height: 100%;
}
</style>
