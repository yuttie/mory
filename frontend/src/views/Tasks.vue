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
              text
              color="primary"
              v-on:click="add"
              v-bind:disabled="newTask.name.length === 0"
            >Add</v-btn>
            <v-btn
              text
              color="primary"
              v-on:click="add(false)"
              v-bind:disabled="newTask.name.length === 0"
            >Add (continuously)</v-btn>
            <v-btn
              icon
              v-on:click="newTaskDialog = false; newTask = { name: '', deadline: null, schedule: null, done: false, tags: [], note: '', }"
            ><v-icon>mdi-close</v-icon></v-btn>
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
              text
              color="primary"
              v-on:click="addGroup"
              v-bind:disabled="newGroupName.length === 0 || newGroupFilter.length === 0"
            >Add</v-btn>
            <v-btn
              icon
              v-on:click="newGroupDialog = false; newGroupName = ''; newGroupFilter = '';"
            ><v-icon>mdi-close</v-icon></v-btn>
          </v-card-actions>
          <v-card-text>
            <v-text-field
              label="Name"
              autofocus
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
      <v-btn
        text
        v-on:click="collectUndone"
      >
        <v-icon class="mr-1">mdi-checkbox-multiple-blank-outline</v-icon>
        Collect Undone
      </v-btn>
      <v-progress-linear
        absolute
        bottom
        indeterminate
        color="primary"
        v-bind:active="isLoading"
      ></v-progress-linear>
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
            color="error"
            v-on:click="removeSelected"
          >Delete</v-btn>
          <v-btn
            text
            color="primary"
            v-on:click="updateSelected"
            v-bind:disabled="editTarget.name.length === 0"
          >Save</v-btn>
          <v-btn
            icon
            v-on:click="select(null, null, null)"
          ><v-icon>mdi-close</v-icon></v-btn>
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
          <draggable
            class="task-list"
            group="tasks"
            v-model="tasks.backlog"
            v-bind:delay="500"
            v-bind:delay-on-touch-only="true"
            v-on:end="clean(); save();"
          >
            <TaskListItem
              v-for="(task, index) of tasks.backlog"
              v-bind:key="`backlog/${task.name}`"
              v-bind:value="task"
              v-on:click="showEditTaskDialog(null, index, task, $event);"
              v-on:done-toggle="$set(task, 'done', $event); clean(); save();"
            ></TaskListItem>
          </draggable>
        </v-card>
        <v-card dense class="group">
          <v-card-title>With Deadline</v-card-title>
          <div class="task-list">
            <TaskListItem
              v-for="[date, index, task] of tasksWithDeadline"
              v-bind:key="task.name"
              v-bind:value="task"
              v-on:click="showEditTaskDialog(date, index, task, $event);"
              v-on:done-toggle="$set(task, 'done', $event); clean(); save();"
            ></TaskListItem>
          </div>
        </v-card>
        <v-card class="group">
          <v-card-title>Scheduled</v-card-title>
          <div class="task-list">
            <div
              v-for="date of Object.keys(tasks.scheduled).sort((a, b) => a < b ? 1 : a > b ? -1 : 0)"
              v-bind:key="date"
              v-bind:class="{ today: isToday(date) }"
            >
              <div class="date-header">{{ isToday(date) ? `Today (${date})` : date }}</div>
              <draggable v-model="tasks.scheduled[date]" group="tasks" v-bind:delay="500" v-bind:delay-on-touch-only="true" v-on:end="clean(); save();">
                <TaskListItem
                  v-for="(task, index) of tasks.scheduled[date]"
                  v-bind:key="`${date}/${task.name}`"
                  v-bind:value="task"
                  v-on:click="showEditTaskDialog(date, index, task, $event);"
                  v-on:done-toggle="$set(task, 'done', $event); clean(); save();"
                ></TaskListItem>
              </draggable>
            </div>
          </div>
        </v-card>
        <draggable class="custom-groups" v-model="groups" group="groups" v-bind:delay="500" v-bind:delay-on-touch-only="true" handle=".handle" v-on:end="clean(); save();">
          <v-card v-for="group of groups" v-bind:key="group.name" class="group">
            <v-card-title class="handle">{{ group.name }}</v-card-title>
            <div class="task-list">
              <div v-for="date of Object.keys(groupedTasks[group.name].scheduled).sort((a, b) => a < b ? 1 : a > b ? -1 : 0)" v-bind:key="date">
                <div class="date-header">{{ date }}</div>
                <template v-for="[index, task] of groupedTasks[group.name].scheduled[date]">
                  <TaskListItem
                    v-bind:key="`${date}/${task.name}`"
                    v-bind:value="task"
                    v-on:click="showEditTaskDialog(date, index, task, $event);"
                    v-on:done-toggle="$set(task, 'done', $event); clean(); save();"
                  ></TaskListItem>
                </template>
              </div>
            </div>
            <div class="task-list">
              <div v-if="groupedTasks[group.name].backlog.length !== 0">
                <div class="date-header">Backlog</div>
                <template v-for="[index, task] of groupedTasks[group.name].backlog">
                  <TaskListItem
                    v-bind:key="`backlog/${task.name}`"
                    v-bind:value="task"
                    v-on:click="showEditTaskDialog(null, index, task, $event);"
                    v-on:done-toggle="$set(task, 'done', $event); clean(); save();"
                  ></TaskListItem>
                </template>
              </div>
            </div>
          </v-card>
        </draggable>
      </div>
    </div>
    <v-snackbar v-model="error" color="error" top timeout="5000">{{ errorText }}</v-snackbar>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Watch, Vue } from 'vue-property-decorator';

import TaskEditor from '@/components/TaskEditor.vue';
import TaskListItem from '@/components/TaskListItem.vue';

import * as api from '@/api';
import { Task } from '@/api';
import { isMetadataEventMultiple, ListEntry, validateEvent } from '@/api';
import Color from 'color';
import materialColors from 'vuetify/lib/util/colors';
import draggable from 'vuedraggable';
import dayjs from 'dayjs';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import YAML from 'yaml';

dayjs.extend(isSameOrAfter);

@Component({
  components: {
    TaskEditor,
    TaskListItem,
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
    window.addEventListener('focus', this.load);
  }

  destroyed() {
    window.removeEventListener('focus', this.load);
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

  get tasksWithDeadline() {
    const result = [];
    // Backlog
    for (const [i, task] of this.tasks.backlog.entries()) {
      if (task.deadline) {
        result.push([null, i, task]);
      }
    }
    // Scheduled
    for (const [date, tasks] of Object.entries(this.tasks.scheduled)) {
      for (const [i, task] of tasks.entries()) {
        if (task.deadline) {
          result.push([date, i, task]);
        }
      }
    }
    return result;
  }

  get groupedTasks() {
    type Grouped = {
      backlog: [number, Task][];
      scheduled: { [key: string]: [number, Task][] };
    };
    const result: { [key: string]: Grouped } = {};
    for (const group of this.groups) {
      const grouped: Grouped = {
        backlog: [],
        scheduled: {},
      };
      // Backlog
      for (const [i, task] of this.tasks.backlog.entries()) {
        if ((task.tags || []).includes(group.filter)) {
          grouped.backlog.push([i, task]);
        }
      }
      // Scheduled
      for (const [date, tasks] of Object.entries(this.tasks.scheduled)) {
        for (const [i, task] of tasks.entries()) {
          if ((task.tags || []).includes(group.filter)) {
            if (!Object.prototype.hasOwnProperty.call(grouped.scheduled, date)) {
              grouped.scheduled[date] = [];
            }
            grouped.scheduled[date].push([i, task]);
          }
        }
      }
      // Add
      result[group.name] = grouped;
    }
    return result;
  }

  isToday(date: string) {
    return date === dayjs().format('YYYY-MM-DD');
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

  async collectUndone() {
    const today = dayjs().startOf('day');
    // Collect undone tasks
    const undone = [];
    const dates = Object.keys(this.tasks.scheduled).sort();
    for (const date of dates) {
      if (dayjs(date).isSameOrAfter(today)) {
        break;
      }
      const tasks: Task[] = this.tasks.scheduled[date];
      for (let i = 0; i < tasks.length;) {
        const task = tasks[i];
        if (task.done) {
          ++i;
        }
        else {
          undone.push(task)
          tasks.splice(i, 1);
        }
      }
    }
    // Schedule them today
    const todayDate = today.format('YYYY-MM-DD');
    if (!Object.prototype.hasOwnProperty.call(this.tasks.scheduled, todayDate)) {
      this.tasks.scheduled[todayDate] = [];
    }
    this.tasks.scheduled[todayDate].unshift(...undone);
    // Save
    this.clean();
    await this.save();
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
    const datePattern = /\d{4}-\d{2}-\d{2}/;
    const taskPropertyOrder: { [key: string]: number } = {
      name: 0,
      deadline: 1,
      schedule: 2,
      done: 3,
      tags: 4,
      note: 5,
    };
    const groupPropertyOrder: { [key: string]: number } = {
      name: 0,
      filter: 1,
    };
    const yaml = YAML.stringify({
      tasks: this.tasks,
      groups: this.groups,
    }, {
      sortMapEntries: (a, b) => {
        if (datePattern.test(a.key.value) && datePattern.test(b.key.value)) {
          if (a.key.value < b.key.value) {
            return 1;
          }
          else if (a.key.value > b.key.value) {
            return -1;
          }
          else {
            return 0;
          }
        }
        else if (a.key.value in taskPropertyOrder && b.key.value in taskPropertyOrder) {
          if (taskPropertyOrder[a.key.value] < taskPropertyOrder[b.key.value]) {
            return -1;
          }
          else if (taskPropertyOrder[a.key.value] > taskPropertyOrder[b.key.value]) {
            return 1;
          }
          else {
            return 0;
          }
        }
        else if (a.key.value in groupPropertyOrder && b.key.value in groupPropertyOrder) {
          if (groupPropertyOrder[a.key.value] < groupPropertyOrder[b.key.value]) {
            return -1;
          }
          else if (groupPropertyOrder[a.key.value] > groupPropertyOrder[b.key.value]) {
            return 1;
          }
          else {
            return 0;
          }
        }
        else {
          if (a.key.value < b.key.value) {
            return -1;
          }
          else if (a.key.value > b.key.value) {
            return 1;
          }
          else {
            return 0;
          }
        }
      },
    });
    return api.addNote('.mory/tasks.yaml', yaml);
  }

  clean() {
    for (const task of this.tasks.backlog) {
      for (const [prop, value] of Object.entries(task)) {
        if (value === null) {
          this.$delete(task, prop);
        }
      }
    }
    for (const [date, dailyTasks] of Object.entries(this.tasks.scheduled)) {
      if ((dailyTasks as Task[]).length === 0) {
        this.$delete(this.tasks.scheduled, date);
      }
      for (const task of dailyTasks) {
        for (const [prop, value] of Object.entries(task)) {
          if (value === null) {
            this.$delete(task, prop);
          }
        }
      }
    }
  }

  async add(clear = true) {
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
    // Save
    await this.save();
    if (clear) {
      // Close the dialog
      this.newTaskDialog = false;
      // Reset
      this.newTask = {
        name: '',
        deadline: null,
        schedule: null,
        done: false,
        tags: [],
        note: '',
      };
    }
    else {
      // Reset partially
      this.newTask = {
        ...this.newTask,
        name: '',
      };
    }
  }

  async updateSelected() {
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
    // Save
    this.clean();
    await this.save();
    // Reset
    this.select(null, null, null);
  }

  async removeSelected() {
    if (this.selectedTask === null) {
      throw new Error('selectedTask is null');
    }
    const list = this.selectedTask.schedule === null ? this.tasks.backlog : this.tasks.scheduled[this.selectedTask.schedule];
    list.splice(this.selectedTaskIndex!, 1);
    // Save
    this.clean();
    await this.save();
    // Reset
    this.select(null, null, null);
  }

  async addGroup() {
    // Create a new group
    const group: any = {
      name: this.newGroupName,
      filter: this.newGroupFilter,
    };
    this.groups.unshift(group);
    // Save
    await this.save();
    // Hide the dialog
    this.newGroupDialog = false;
    // Reset
    this.newGroupName = '';
    this.newGroupFilter = '';
  }
}
</script>

<style scoped lang="scss">
$group-width: 270px;
$space: 12px;

#tasks {
  height: 100%;
  user-select: none;
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
  grid-template-columns: $group-width $group-width $group-width min-content;
  grid-template-rows: 100%;
  grid-auto-columns: $group-width;
  column-gap: $space;
  padding: $space;
}
.custom-groups {
  display: grid;
  width: fit-content;
  height: 100%;
  grid-auto-flow: column;
  grid-template-columns: repeat(auto-fill, $group-width);
  grid-template-rows: 100%;
  grid-auto-columns: $group-width;
  column-gap: $space;
}
.group {
  display: flex;
  flex-direction: column;
  align-self: flex-start;
  max-height: 100%;
}
.custom-groups .group {
  &.sortable-ghost {
    visibility: hidden;
  }
}
.handle {
  cursor: grab;
}
.task-list {
  div > .date-header {
    border-bottom: 2px solid #ddd;
    margin-bottom: 2px;
  }
  div + div > .date-header {
    margin-top: 12px;
  }
}
.task-list {
  overflow-y: auto;
  padding: 0 8px;
}
</style>
