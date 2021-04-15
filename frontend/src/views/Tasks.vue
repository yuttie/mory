<template>
  <div class="tasks d-flex flex-column">
    <v-toolbar flat outlined dense class="flex-grow-0">
      <v-menu offset-y v-bind:close-on-content-click="false" v-model="newTaskMenu">
        <template v-slot:activator="{ on, attrs }">
          <v-btn
            icon
            v-bind="attrs"
            v-on="on"
          >
            <v-icon>mdi-plus-box-outline</v-icon>
          </v-btn>
        </template>
        <v-card>
          <v-card-title>New Task</v-card-title>
          <v-card-text>
            <TaskEditor v-model="newTask" v-bind:knownTags="knownTags"></TaskEditor>
          </v-card-text>
          <v-card-actions>
            <v-spacer></v-spacer>
            <v-btn
              v-on:click="add"
              v-bind:disabled="newTask.name.length === 0"
            >Add</v-btn>
          </v-card-actions>
        </v-card>
      </v-menu>
    </v-toolbar>
    <v-menu
      offset-x
      v-if="editTarget !== null"
      v-model="editTaskMenu"
      v-bind:close-on-content-click="false"
      v-bind:activator="editTaskMenuActivator"
    >
      <v-card>
        <v-card-title>Edit Task</v-card-title>
        <v-card-text>
          <TaskEditor v-model="editTarget" v-bind:knownTags="knownTags"></TaskEditor>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn
            text
            v-on:click="select(null)"
          >Cancel</v-btn>
          <v-btn
            text
            color="primary"
            v-on:click="update"
            v-bind:disabled="editTarget.name.length === 0"
          >Update</v-btn>
        </v-card-actions>
      </v-card>
    </v-menu>
    <div class="lists d-flex flex-row flex-grow-1 my-3">
      <div class="list">
        <h2>Backlog</h2>
        <v-list dense>
          <draggable v-bind:options="{ group: 'tasks' }">
            <v-list-item v-for="(task, index) of tasks.backlog" v-bind:key="task" v-on:click="showEditTaskMenu(task, $event);">
              <v-list-item-action>
                <v-checkbox v-model="task.done" class="task-checkbox"></v-checkbox>
              </v-list-item-action>
              <v-list-item-content>
                {{ task.name }}
              </v-list-item-content>
              <v-list-item-action>
                <v-btn icon v-on:click="remove(tasks.backlog, index)"><v-icon>mdi-delete</v-icon></v-btn>
              </v-list-item-action>
            </v-list-item>
          </draggable>
        </v-list>
      </div>
      <div class="list">
        <h2>Scheduled</h2>
        <div v-for="(tasks, day) of tasks.scheduled" v-bind:key="day">
          <h3>{{ day }}</h3>
          <v-list dense>
            <draggable v-bind:options="{ group: 'tasks' }">
              <v-list-item v-for="(task, index) of tasks" v-bind:key="task" v-on:click="showEditTaskMenu(task, $event);">
                <v-list-item-action>
                  <v-checkbox v-model="task.done" class="task-checkbox"></v-checkbox>
                </v-list-item-action>
                <v-list-item-content>
                  {{ task.name }}
                </v-list-item-content>
                <v-list-item-action>
                  <v-btn icon v-on:click="remove(tasks, index)"><v-icon>mdi-delete</v-icon></v-btn>
                </v-list-item-action>
              </v-list-item>
            </draggable>
          </v-list>
        </div>
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
import draggable from 'vuedraggable';
import dayjs from 'dayjs';
import YAML from 'yaml';

@Component({
  components: {
    TaskEditor,
    draggable,
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
  newTaskMenu = false;
  selectedTask: null | Task = null;
  editTarget: null | Task = null;
  editTaskMenu = false;
  editTaskMenuActivator: any = null;
  knownTags: string[] = [];
  isLoading = false;
  error = false;
  errorText = '';

  mounted() {
    document.title = `Tasks | ${process.env.VUE_APP_NAME}`;
    this.load();
  }

  select(task: Task | null) {
    this.selectedTask = task;
    this.editTarget = JSON.parse(JSON.stringify(task));
  }

  showEditTaskMenu(task: Task, event: MouseEvent) {
    const open = () => {
      this.select(task);
      this.editTaskMenuActivator = event.target;
      setTimeout(() => {
        this.editTaskMenu = true;
      }, 0);
    };

    if (this.editTaskMenu) {
      this.editTaskMenu = false;
      setTimeout(open, 0);
    }
    else {
      open();
    }
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
    // Create a new entry
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
    // Save
    await api.addNote('.mory/tasks.yaml', YAML.stringify(this.tasks));
    // Hide the menu
    this.newTaskMenu = false;
  }

  async update() {
    // Copy back
    this.selectedTask.name = this.editTarget.name;
    this.selectedTask.deadline = this.editTarget.deadline;
    this.selectedTask.done = this.editTarget.done;
    this.selectedTask.tags = this.editTarget.tags;
    this.selectedTask.note = this.editTarget.note;
    // Reset
    this.select(null);
    // Save
    await api.addNote('.mory/tasks.yaml', YAML.stringify(this.tasks));
  }

  async remove(list, index) {
    list.splice(index, 1);
    // Save
    await api.addNote('.mory/tasks.yaml', YAML.stringify(this.tasks));
  }
}
</script>

<style scoped lang="scss">
.tasks {
  height: 100%;
}
.list {
  width: 270px;
  border: 1px solid #ccc;
  background: #eee;
  border-radius: 8px;
  margin-left: 1em;
  padding: 0.5em;
  align-self: flex-start;
}
.task-checkbox {
  pointer-events: none;
}
</style>
