<template>
  <div class="calendar d-flex flex-column">
    <v-sheet class="px-5 d-flex">
      <v-toolbar flat>
        <v-btn outlined v-on:click="setToday" class="mr-3">Today</v-btn>
        <v-btn icon small v-on:click="$refs.calendar.prev()">
          <v-icon>mdi-chevron-left</v-icon>
        </v-btn>
        <v-btn icon small v-on:click="$refs.calendar.next()" class="mr-3">
          <v-icon>mdi-chevron-right</v-icon>
        </v-btn>
        <v-toolbar-title v-if="$refs.calendar" class="mr-3">
          {{ $refs.calendar.title }}
        </v-toolbar-title>
      </v-toolbar>
    </v-sheet>
    <v-sheet class="flex-grow-1">
      <v-calendar
        ref="calendar"
        v-model="calendarCursor"
        v-bind:events="events"
        v-bind:event-color="getEventColor"
        v-bind:event-text-color="getEventTextColor"
        v-on:click:event="onEventClick"
        color="primary"
      ></v-calendar>
    </v-sheet>
    <v-overlay v-bind:value="isLoading" z-index="10">
      <v-progress-circular indeterminate size="64"></v-progress-circular>
    </v-overlay>
    <v-snackbar v-model="error" color="error" top timeout="5000">{{ errorText }}</v-snackbar>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Watch, Vue } from 'vue-property-decorator';

import axios from '@/axios';
import Color from 'color';
import materialColors from 'vuetify/lib/util/colors';
import XXH from 'xxhashjs';

interface MetadataEventSingle {
  start: string;
  end?: string;
  color?: string;
}

interface MetadataEventMultiple {
  color?: string;
  times: MetadataEventSingle[];
}

type MetadataEvent = MetadataEventSingle | MetadataEventMultiple;

function isMetadataEventMultiple(ev: MetadataEvent): ev is MetadataEventMultiple {
  return Array.isArray((ev as MetadataEventMultiple).times);
}

interface Metadata {
  tags?: string[];
  events?: { [key: string]: MetadataEvent };
  'event color'?: string;
}

interface ListEntry {
  path: string;
  metadata: Metadata;
}

function validateEvent(event: any): boolean {
  if (typeof event.name !== "string") {
    console.error("%s: Event's name is not a string: %o", event.notePath, event);
    return false;
  }
  if (typeof event.start !== "string") {
    console.error("%s: Event's start is not a string: %o", event.notePath, event);
    return false;
  }
  if (typeof event.end !== "string" && typeof event.end !== "undefined") {
    console.error("%s: Event's end is neither a string nor the undefined: %o", event.notePath, event);
    return false;
  }
  if (typeof event.color !== "string") {
    console.error("%s: Event's color is not a string: %o", event.notePath, event);
    return false;
  }
  return true;
}

@Component
export default class Calendar extends Vue {
  @Prop(String) readonly token!: null | string;

  entries: ListEntry[] = [];
  isLoading = false;
  error = false;
  errorText = '';
  calendarCursor = '';

  get events() {
    const events = [];
    for (const entry of this.entries) {
      if (entry.metadata !== null) {
        // Choose a default color for the note based on its path
        let defaultColor = "#666666";
        if (Object.prototype.hasOwnProperty.call(entry.metadata, 'event color') && typeof entry.metadata['event color'] === 'string') {
          defaultColor = entry.metadata['event color'];
        }
        if (Object.prototype.hasOwnProperty.call(entry.metadata, 'events') && typeof entry.metadata.events === 'object' && entry.metadata.events !== null) {
          for (const [eventName, eventDetail] of Object.entries(entry.metadata.events)) {
            if (typeof eventDetail === 'object' && eventDetail !== null) {
              // If eventDetail has the 'times' property and it is an array
              if (isMetadataEventMultiple(eventDetail)) {
                for (const time of eventDetail.times) {
                  const event = {
                    name: eventName,
                    start: time.start,
                    end: time.end,
                    color: time.color || eventDetail.color || defaultColor,
                    notePath: entry.path,
                  };
                  if (validateEvent(event)) {
                    events.push(event);
                  }
                }
              }
              else {
                const event = {
                  name: eventName,
                  start: eventDetail.start,
                  end: eventDetail.end,
                  color: eventDetail.color || defaultColor,
                  notePath: entry.path,
                };
                if (validateEvent(event)) {
                  events.push(event);
                }
              }
            }
          }
        }
      }
    }
    return events;
  }

  @Watch('token')
  onTokenChanged(token: null | string) {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    }
    else {
      delete axios.defaults.headers.common['Authorization'];
    }
  }

  mounted() {
    document.title = `Calendar | ${process.env.VUE_APP_NAME}`;

    this.onTokenChanged(this.token);

    this.load();
  }

  load() {
    this.isLoading = true;
    axios.get('/notes')
      .then(res => {
        this.entries = res.data;
        this.isLoading = false;
      }).catch(error => {
        if (error.response) {
          if (error.response.status === 401) {
            // Unauthorized
            this.$emit('tokenExpired', () => this.load());
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
      });
  }

  setToday() {
    this.calendarCursor = '';
  }

  onEventClick(e: any) {
    this.$router.push({
      name: 'Note',
      params: { path: e.event.notePath }
    });
  }

  getEventEndTime(event: any): Date {
    if (typeof event.end !== 'undefined') {
      return new Date(event.end);
    }
    else {
      const d = new Date(event.start);
      d.setHours(23, 59, 59, 999);
      return d;
    }
  }

  getEventColor(event: any): string {
    const toPropName = (s: string) => s.replace(/-./g, (match: string) => match[1].toUpperCase());
    const color = Object.prototype.hasOwnProperty.call(materialColors, toPropName(event.color))
                ? Color((materialColors as any)[toPropName(event.color)].base)
                : Color(event.color);

    const now = new Date();
    const time = this.getEventEndTime(event);
    if (time < now) {
      return color.fade(0.75).string();
    }
    else {
      return color.string();
    }
  }

  getEventTextColor(event: any): string {
    const now = new Date();
    const time = this.getEventEndTime(event);
    if (time < now) {
      return Color('#000000').fade(0.7).string();
    }
    else {
      const bg = Color(this.getEventColor(event));
      const white = Color('#ffffff');
      const black = Color('#000000');
      if (bg.contrast(white) >= 4.5) {  // Prefer white over black
        return white.string();
      }
      else if (bg.contrast(black) >= 4.5) {
        return black.string();
      }
      else if (bg.contrast(white) >= bg.contrast(black)) {
        return white.string();
      }
      else {
        return black.string();
      }
    }
  }
}
</script>

<style scoped lang="scss">
.calendar {
  height: 100%;
}
</style>
