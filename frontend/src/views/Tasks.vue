<template>
  <div id="tasks" class="d-flex flex-column">
    <v-toolbar flat outlined dense class="flex-grow-0">
      <v-dialog max-width="600px" v-model="newTaskDialog">
        <template v-slot:activator="{ on, attrs }">
          <v-btn
            text
            v-bind="attrs"
            v-on="on"
            class="mr-2"
          >
            <v-icon class="mr-1">mdi-plus-box-outline</v-icon>
            New Task
          </v-btn>
        </template>
        <v-card>
          <v-card-actions>
            <v-card-title>New Task</v-card-title>
            <v-spacer></v-spacer>
            <v-btn
              v-on:click="add"
              v-bind:disabled="newTask.name.length === 0"
            >Add</v-btn>
          </v-card-actions>
          <v-card-text>
            <TaskEditor v-model="newTask" v-bind:knownTags="knownTags"></TaskEditor>
          </v-card-text>
        </v-card>
      </v-dialog>
      <v-dialog max-width="600px" v-model="newGroupDialog">
        <template v-slot:activator="{ on, attrs }">
          <v-btn
            text
            v-bind="attrs"
            v-on="on"
          >
            <v-icon class="mr-1">mdi-plus-box-outline</v-icon>
            New Group
          </v-btn>
        </template>
        <v-card>
          <v-card-actions>
            <v-card-title>New Group</v-card-title>
            <v-spacer></v-spacer>
            <v-btn
              v-on:click="addGroup"
              v-bind:disabled="newGroupName.length === 0 || newGroupFilter.length === 0"
            >Add</v-btn>
          </v-card-actions>
          <v-card-text>
            <v-text-field
              label="Name"
              prepend-icon="mdi-pencil"
              v-model="newGroupName"
            ></v-text-field>
            <v-text-field
              label="Tag"
              prepend-icon="mdi-tag-outline"
              v-model="newGroupFilter"
            ></v-text-field>
          </v-card-text>
        </v-card>
      </v-dialog>
    </v-toolbar>
    <v-dialog
      max-width="600px"
      v-if="editTarget !== null"
      v-model="editTaskDialog"
      v-bind:activator="editTaskDialogActivator"
    >
      <v-card>
        <v-card-actions>
          <v-card-title>Edit Task</v-card-title>
          <v-spacer></v-spacer>
          <v-btn
            text
            color="primary"
            v-on:click="update"
            v-bind:disabled="editTarget.name.length === 0"
          >Save</v-btn>
        </v-card-actions>
        <v-card-text>
          <TaskEditor v-model="editTarget" v-bind:knownTags="knownTags"></TaskEditor>
        </v-card-text>
      </v-card>
    </v-dialog>
    <div class="groups-container flex-grow-1">
      <div class="groups">
        <v-card dense class="group">
          <v-card-title>Backlog</v-card-title>
          <div class="list">
            <v-list dense>
              <draggable v-model="tasks.backlog" group="tasks" v-on:end="clean(); save();">
                <v-list-item v-for="(task, index) of tasks.backlog" v-bind:key="`backlog/${task.name}`" v-on:click="showEditTaskDialog(null, index, task, $event);">
                  <v-list-item-action>
                    <v-checkbox dense v-model="task.done" class="task-checkbox"></v-checkbox>
                  </v-list-item-action>
                  <v-list-item-content>
                    {{ task.name }}
                  </v-list-item-content>
                  <v-list-item-action>
                    <v-btn x-small icon v-on:click="remove(tasks.backlog, index)"><v-icon>mdi-delete</v-icon></v-btn>
                  </v-list-item-action>
                </v-list-item>
              </draggable>
            </v-list>
          </div>
        </v-card>
        <v-card class="group">
          <v-card-title>Scheduled</v-card-title>
          <div class="list">
            <div v-for="date of Object.keys(tasks.scheduled).sort((a, b) => a < b ? 1 : a > b ? -1 : 0)" v-bind:key="date">
              <v-subheader>{{ date }}</v-subheader>
              <v-divider></v-divider>
              <v-list dense>
                <draggable v-model="tasks.scheduled[date]" group="tasks" v-on:end="clean(); save();">
                  <v-list-item v-for="(task, index) of tasks.scheduled[date]" v-bind:key="`${date}/${task.name}`" v-on:click="showEditTaskDialog(date, index, task, $event);">
                    <v-list-item-action>
                      <v-checkbox dense v-model="task.done" class="task-checkbox"></v-checkbox>
                    </v-list-item-action>
                    <v-list-item-content>
                      {{ task.name }}
                    </v-list-item-content>
                    <v-list-item-action>
                      <v-btn x-small icon v-on:click="remove(tasks.scheduled[date], index)"><v-icon>mdi-delete</v-icon></v-btn>
                    </v-list-item-action>
                  </v-list-item>
                </draggable>
              </v-list>
            </div>
          </div>
        </v-card>
        <draggable class="custom-groups" v-model="groups" group="groups" handle=".handle" v-on:end="clean(); save();">
          <v-card v-for="group of groups" v-bind:key="group.name" class="group">
            <v-card-title class="handle">{{ group.name }}</v-card-title>
            <div class="list">
              <div v-for="date of Object.keys(groupedTasks[group.name].scheduled).sort((a, b) => a < b ? 1 : a > b ? -1 : 0)" v-bind:key="date">
                <v-subheader>{{ date }}</v-subheader>
                <v-divider></v-divider>
                <v-list dense>
                  <template v-for="(task, index) of groupedTasks[group.name].scheduled[date]">
                    <v-list-item v-bind:key="`${date}/${task.name}`" v-on:click="showEditTaskDialog(date, index, task, $event);">
                      <v-list-item-action>
                        <v-checkbox dense v-model="task.done" class="task-checkbox"></v-checkbox>
                      </v-list-item-action>
                      <v-list-item-content>
                        {{ task.name }}
                      </v-list-item-content>
                      <v-list-item-action>
                        <v-btn x-small icon v-on:click="remove(groupedTasks[group.name].scheduled[date], index)"><v-icon>mdi-delete</v-icon></v-btn>
                      </v-list-item-action>
                    </v-list-item>
                  </template>
                </v-list>
              </div>
            </div>
            <div class="list">
              <div v-if="groupedTasks[group.name].backlog.length !== 0">
                <v-subheader>Backlog</v-subheader>
                <v-divider></v-divider>
                <v-list dense>
                  <template v-for="(task, index) of groupedTasks[group.name].backlog">
                    <v-list-item v-bind:key="`backlog/${task.name}`" v-on:click="showEditTaskDialog(null, index, task, $event);">
                      <v-list-item-action>
                        <v-checkbox dense v-model="task.done" class="task-checkbox"></v-checkbox>
                      </v-list-item-action>
                      <v-list-item-content>
                        {{ task.name }}
                      </v-list-item-content>
                      <v-list-item-action>
                        <v-btn x-small icon v-on:click="remove(groupedTasks[group.name].backlog, index)"><v-icon>mdi-delete</v-icon></v-btn>
                      </v-list-item-action>
                    </v-list-item>
                  </template>
                </v-list>
              </div>
            </div>
          </v-card>
        </draggable>
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
  tasks = {
    backlog: [] as Task[],
    scheduled: {} as { [key: string]: Task[] }
  };
  groups: { name: string, filter: string }[] = [];
  // Task
  newTask: Task = {
    name: '',
    deadline: null,
    schedule: null,
    done: false,
    tags: [],
    note: '',
  };
  newTaskDialog = false;
  selectedTaskIndex: null | number = null;
  selectedTask: null | Task = null;
  editTarget: null | Task = null;
  editTaskDialog = false;
  editTaskDialogActivator: any = null;
  // Group
  newGroupDialog = false;
  newGroupName = '';
  newGroupFilter = '';
  // Others
  isLoading = false;
  error = false;
  errorText = '';

  mounted() {
    document.title = `Tasks | ${process.env.VUE_APP_NAME}`;
    this.load();
  }

  get knownTags(): string[] {
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
    return knownTags;
  }

  get groupedTasks() {
    const result = {};
    for (const group of this.groups) {
      const grouped = {
        backlog: [] as Task[],
        scheduled: {} as { [key: string]: Task[] },
      };
      // Backlog
      for (const task of this.tasks.backlog) {
        if ((task.tags || []).includes(group.filter)) {
          grouped.backlog.push(task);
        }
      }
      // Scheduled
      for (const [date, tasks] of Object.entries(this.tasks.scheduled)) {
        for (const task of tasks) {
          if ((task.tags || []).includes(group.filter)) {
            if (!Object.prototype.hasOwnProperty.call(grouped.scheduled, date)) {
              grouped.scheduled[date] = [];
            }
            grouped.scheduled[date].push(task);
          }
        }
      }
      // Add
      result[group.name] = grouped;
    }
    return result;
  }

  select(date: string | null, index: number | null, task: Task | null) {
    this.selectedTaskIndex = index;
    if (task !== null) {
      task.schedule = date;
    }
    this.selectedTask = task;
    this.editTarget = JSON.parse(JSON.stringify(task));
  }

  showEditTaskDialog(date: string | null, index: number, task: Task, event: MouseEvent) {
    const open = () => {
      this.select(date, index, task);
      this.editTaskDialogActivator = (event.target as Element).parentElement!;
      setTimeout(() => {
        this.editTaskDialog = true;
      }, 0);
    };

    if (this.editTaskDialog) {
      this.editTaskDialog = false;
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
      const data = YAML.parse(res.data);
      this.tasks = data.tasks;
      this.groups = data.groups;
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
            tasks: {
              backlog: [],
              scheduled: {},
            },
            groups: [],
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

  save() {
    return api.addNote('.mory/tasks.yaml', YAML.stringify({
      tasks: this.tasks,
      groups: this.groups,
    }));
  }

  clean() {
    for (const [date, dailyTasks] of Object.entries(this.tasks.scheduled)) {
      if ((dailyTasks as Task[]).length === 0) {
        this.$delete(this.tasks.scheduled, date);
      }
    }
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
      this.tasks.scheduled[this.newTask.schedule].unshift(task);
    }
    else {
      this.tasks.backlog.unshift(task);
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
    await this.save();
    // Hide the dialog
    this.newTaskDialog = false;
  }

  async update() {
    if (this.selectedTask === null) {
      throw new Error('selectedTask is null');
    }
    if (this.editTarget === null) {
      throw new Error('editTarget is null');
    }
    // Copy back
    this.selectedTask.name = this.editTarget.name;
    this.selectedTask.deadline = this.editTarget.deadline;
    this.selectedTask.done = this.editTarget.done;
    this.selectedTask.tags = this.editTarget.tags;
    this.selectedTask.note = this.editTarget.note;
    // Move to other list
    const oldDate = this.selectedTask.schedule;
    const newDate = this.editTarget.schedule;
    if (newDate !== oldDate) {
      // Remove it from the original list
      const list = oldDate === null ? this.tasks.backlog : this.tasks.scheduled[oldDate];
      list.splice(this.selectedTaskIndex!, 1);
      // Put into a new list
      if (newDate === null) {
        this.tasks.backlog.unshift(this.selectedTask);
      }
      else {
        if (!Object.prototype.hasOwnProperty.call(this.tasks.scheduled, newDate)) {
          this.tasks.scheduled[newDate] = [];
        }
        this.tasks.scheduled[newDate].unshift(this.selectedTask);
      }
    }
    // Reset
    this.select(null, null, null);
    // Save
    this.clean();
    await this.save();
  }

  async remove(list: Task[], index: number) {
    list.splice(index, 1);
    // Save
    this.clean();
    await this.save();
  }

  async addGroup() {
    // Create a new group
    const group: any = {
      name: this.newGroupName,
      filter: this.newGroupFilter,
    };
    this.groups.unshift(group);
    // Reset
    this.newGroupName = '';
    this.newGroupFilter = '';
    // Save
    await this.save();
    // Hide the dialog
    this.newGroupDialog = false;
  }
}
</script>

<style scoped lang="scss">
$list-width: 270px;

#tasks {
  height: 100%;
}
.groups-container {
  flex: 1 1 0;
  overflow-x: auto;
  overflow-y: hidden;
}
.groups {
  display: grid;
  width: fit-content;
  height: 100%;
  grid-auto-flow: column;
  grid-template-columns: $list-width $list-width min-content;
  grid-template-rows: 100%;
  grid-auto-columns: $list-width;
  column-gap: 1em;
  padding: 1em;
}
.custom-groups {
  display: grid;
  width: fit-content;
  height: 100%;
  grid-auto-flow: column;
  grid-template-columns: repeat(auto-fill, $list-width);
  grid-template-rows: 100%;
  grid-auto-columns: $list-width;
  column-gap: 1em;
}
.group {
  display: flex;
  flex-direction: column;
  align-self: flex-start;
  max-height: 100%;
}
.handle {
  cursor: pointer;
}
.list {
  overflow-y: auto;
}
.task-checkbox {
  pointer-events: none;
}
</style>
