<template>
  <div id="tasks" class="d-flex flex-column">
    <v-toolbar flat outlined dense class="flex-grow-0">
      <v-dialog
        max-width="600px"
        persistent
        v-model="newTaskDialog"
      >
        <template v-slot:activator="{ on, attrs }">
          <v-btn
            text
            v-bind="attrs"
            v-on="on"
            class="mr-2"
          >
            <v-icon class="mr-1">mdi-plus-box-outline</v-icon>
            Task
          </v-btn>
        </template>
        <v-card>
          <v-card-actions>
            <v-spacer></v-spacer>
            <v-btn
              text
              color="primary"
              v-on:click="add(false)"
              v-bind:disabled="newTask.name.length === 0"
            >Add (continuously)</v-btn>
            <v-btn
              text
              color="primary"
              v-on:click="add"
              v-bind:disabled="newTask.name.length === 0"
            >Add</v-btn>
            <v-btn
              icon
              v-on:click="closeNewTaskDialog"
            ><v-icon>mdi-close</v-icon></v-btn>
          </v-card-actions>
          <v-card-text>
            <TaskEditor v-model="newTask" v-bind:knownTags="knownTags"></TaskEditor>
          </v-card-text>
        </v-card>
      </v-dialog>
      <v-dialog
        max-width="600px"
        persistent
        v-model="newGroupDialog"
      >
        <template v-slot:activator="{ on, attrs }">
          <v-btn
            text
            v-bind="attrs"
            v-on="on"
          >
            <v-icon class="mr-1">mdi-plus-box-outline</v-icon>
            Group
          </v-btn>
        </template>
        <v-card>
          <v-card-actions>
            <v-spacer></v-spacer>
            <v-btn
              text
              color="primary"
              v-on:click="addGroup"
              v-bind:disabled="newGroupName.length === 0 || newGroupFilter.length === 0"
            >Add</v-btn>
            <v-btn
              icon
              v-on:click="closeNewGroupDialog"
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
      <v-switch
        v-model="hideDone"
        v-bind:label="'Hide done'"
      ></v-switch>
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
      persistent
      v-if="editTarget"
      v-model="editTaskDialog"
      v-bind:activator="editTaskDialogActivator"
    >
      <v-card>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn
            text
            v-on:click="openNewTaskDialogWithSelection"
          >Add similar...</v-btn>
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
            v-on:click="closeEditTaskDialog"
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
              v-for="date of scheduledDates"
              v-bind:key="date"
              v-bind:class="{ today: isToday(date) }"
            >
              <div class="date-header">
                <span>{{ isToday(date) ? `Today (${date})` : date }}</span>
                <v-btn
                  text
                  x-small
                  v-on:click="moveUndoneToFront(date)"
                >Sort</v-btn>
                <v-btn
                  text
                  x-small
                  v-on:click="moveUndoneToToday(date)"
                >Move to today</v-btn>
              </div>
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
            <v-card-title class="handle">
              <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{{ group.name }}</span>
            </v-card-title>
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
import axios from 'axios';
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
  hideDone = true;
  error = false;
  errorText = '';

  mounted() {
    document.title = `Tasks | ${process.env.VUE_APP_NAME}`;
    this.load();
    window.addEventListener('focus', this.loadIfNotEditing);
  }

  destroyed() {
    window.removeEventListener('focus', this.loadIfNotEditing);
  }

  get knownTags(): [string, number][] {
    // Collect tags
    const tagCounts = new Map();
    for (const task of this.tasks.backlog as Task[]) {
      for (const tag of task.tags || []) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }
    for (const [date, tasks] of Object.entries(this.tasks.scheduled)) {
      for (const task of tasks as Task[]) {
        for (const tag of task.tags || []) {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        }
      }
    }
    return [...tagCounts]
      .sort(([_tag1, count1], [_tag2, count2]) => count2 - count1);
  }

  get scheduledDates() {
    let dates = Object.keys(this.tasks.scheduled);
    dates.sort((a, b) => a < b ? 1 : a > b ? -1 : 0);
    if (this.hideDone) {
      // Keep today or dates that have some undone tasks
      const today = dayjs().format('YYYY-MM-DD');
      dates = dates.filter(date => {
        return date === today || this.tasks.scheduled[date].some(task => !task.done);
      });
    }
    return dates;
  }

  get tasksWithDeadline() {
    const result: [string | null, number, Task][] = [];
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
    if (this.hideDone) {
      // Remove scheduled tasks which are done
      let i = 0;
      while (i < result.length) {
        let [_date, _i, task] = result[i];
        if (task.done) {
          result.splice(i, 1);
        }
        else {
          i += 1;
        }
      }
    }
    // Sort
    result.sort(([date1, i1, task1], [date2, i2, task2]) => {
      if (task1.done && !task2.done) {
        return +1;
      }
      else if (!task1.done && task2.done) {
        return -1;
      }
      else {
        const deadline1 = dayjs(task1.deadline);
        const deadline2 = dayjs(task2.deadline);
        if (deadline1.isAfter(deadline2)) {
          return -1;
        }
        else if (deadline2.isAfter(deadline1)) {
          return +1;
        }
        else {
          return 0;
        }
      }
    });
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
        grouped.scheduled[date] = [];
        for (const [i, task] of tasks.entries()) {
          if ((task.tags || []).includes(group.filter)) {
            grouped.scheduled[date].push([i, task]);
          }
        }
        // Remove if empty or all tasks are done
        const empty = grouped.scheduled[date].length === 0;
        const allDone = grouped.scheduled[date].every(([_, task]) => task.done);
        if (empty || this.hideDone && allDone) {
          delete grouped.scheduled[date];
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
    if (task !== null) {
      this.editTarget = JSON.parse(JSON.stringify(task));
      this.editTarget!.name     ||= '';
      this.editTarget!.deadline ||= null;
      this.editTarget!.schedule ||= null;
      this.editTarget!.done     ||= false;
      this.editTarget!.tags     ||= [];
      this.editTarget!.note     ||= '';
    }
    else {
      this.editTarget = null;
    }
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

  closeNewTaskDialog() {
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

  closeNewGroupDialog() {
    // Close the dialog
    this.newGroupDialog = false;
    // Reset
    this.newGroupName = '';
    this.newGroupFilter = '';
  }

  closeEditTaskDialog() {
    // Close the dialog
    this.editTaskDialog = false;
    // Reset
    this.select(null, null, null);
  }

  openNewTaskDialogWithSelection() {
    this.newTask = JSON.parse(JSON.stringify(this.editTarget));
    this.newTask.name += ' (copy)';
    this.newTaskDialog = true;
    this.closeEditTaskDialog();
  }

  async moveUndoneToFront(date: string) {
    // Collect undone tasks
    const done = [];
    const undone = [];
    for (const task of this.tasks.scheduled[date]) {
      if (task.done) {
        done.push(task);
      }
      else {
        undone.push(task);
      }
    }
    this.tasks.scheduled[date] = undone.concat(done);
    // Save
    this.clean();
    await this.save();
  }

  async moveUndoneToToday(date: string) {
    const tasks = this.tasks.scheduled[date];
    // Collect undone tasks
    const undone = [];
    let i = 0;
    while (i < tasks.length) {
      const task = tasks[i];
      if (task.done) {
        i += 1;
      }
      else {
        tasks.splice(i, 1);
        undone.push(task);
      }
    }
    // Schedule them today
    const today = dayjs().startOf('day');
    const todayDate = today.format('YYYY-MM-DD');
    if (!Object.prototype.hasOwnProperty.call(this.tasks.scheduled, todayDate)) {
      this.tasks.scheduled[todayDate] = [];
    }
    this.tasks.scheduled[todayDate].unshift(...undone);
    // Save
    this.clean();
    await this.save();
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

  async loadIfNotEditing() {
    if (this.editTarget === null) {
      await this.load();
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
      if (axios.isAxiosError(error)) {
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
            this.errorText = error.toString();
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

  async add(closeDialog = true) {
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
    if (closeDialog) {
      this.closeNewTaskDialog();
    }
    else {
      // Reset partially
      this.newTask = {
        ...this.newTask,
        name: '',
        tags: [...this.newTask.tags],
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
    // Close
    this.closeEditTaskDialog();
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
    // Close
    this.closeEditTaskDialog();
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
  display: flex;
  width: fit-content;
  height: 100%;
  gap: $space;
  padding: $space;
}
.custom-groups {
  display: flex;
  width: fit-content;
  height: 100%;
  gap: $space;
}
.group {
  display: flex;
  flex-direction: column;
  align-self: flex-start;
  max-height: 100%;
  width: $group-width;
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
  overflow-y: auto;

  .date-header {
    padding: 2px 8px 0 8px;
  }
  .task-list-item {
    padding: 4px 8px;
  }
  div > .date-header {
    border-bottom: 2px solid #ddd;
    margin-bottom: 2px;
  }
  div + div > .date-header {
    margin-top: 12px;
  }
}
</style>
