<template>
  <div id="calendar" class="d-flex flex-column">
    <v-toolbar flat outlined dense class="flex-grow-0">
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
      <v-progress-linear
        absolute
        bottom
        indeterminate
        color="primary"
        v-bind:active="isLoading"
      ></v-progress-linear>
    </v-toolbar>
    <v-calendar
      ref="calendar"
      v-bind:type="calendarType"
      v-bind:value="calendarCursor"
      v-bind:events="events"
      v-bind:event-color="getEventColor"
      v-bind:event-text-color="getEventTextColor"
      v-on:input="onCalendarInput"
      v-on:click:event="showEvent"
      v-on:click:more="viewDay"
      v-on:click:date="viewDay"
      v-touch="{
        left: () => $refs.calendar.next(),
        right: () => $refs.calendar.prev(),
      }"
      color="primary"
      class="flex-grow-1"
    ></v-calendar>
    <v-menu
      v-model="selectedOpen"
      v-bind:close-on-content-click="false"
      v-bind:activator="selectedElement"
      offset-x
      offset-y
      max-width="30em"
    >
      <v-card flat class="event-card">
        <v-toolbar
          v-bind:color="selectedEvent.color"
          dark
          flat
        >
          <v-toolbar-title>{{ selectedEvent.name }}</v-toolbar-title>
          <v-spacer></v-spacer>
          <v-icon v-if="selectedEvent.finished">mdi-check</v-icon>
        </v-toolbar>
        <v-card-text>
          <v-list dense>
            <v-list-item>
              <v-list-item-icon>
                <v-icon>mdi-clock-start</v-icon>
              </v-list-item-icon>
              <v-list-item-content>
                {{ selectedEvent.start }}
              </v-list-item-content>
            </v-list-item>
            <v-list-item v-if="selectedEvent.end">
              <v-list-item-icon>
                <v-icon>mdi-clock-end</v-icon>
              </v-list-item-icon>
              <v-list-item-content>
                {{ selectedEvent.end }}
              </v-list-item-content>
            </v-list-item>
            <v-list-item>
              <v-list-item-icon>
                <v-icon>mdi-file-document-outline</v-icon>
              </v-list-item-icon>
              <v-list-item-content>
                <router-link v-bind:to="{ name: 'Note', params: { path: selectedEvent.notePath } }">{{ selectedEvent.notePath }}</router-link>
              </v-list-item-content>
            </v-list-item>
          </v-list>
          <template v-if="selectedEvent.note">
            <v-divider></v-divider>
            <div class="mt-3" v-html="renderEventNote(selectedEvent.note)"></div>
          </template>
        </v-card-text>
      </v-card>
    </v-menu>
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
import MarkdownIt from 'markdown-it';
import XXH from 'xxhashjs';

const mdit = new MarkdownIt('default', {
  html: true,
  linkify: true,
});

@Component
export default class Calendar extends Vue {
  entries: ListEntry[] = [];
  isLoading = false;
  error = false;
  errorText = '';
  calendarType = 'month';
  calendarCursor = dayjs().format('YYYY-MM-DD');
  selectedEvent = {};
  selectedElement = null;
  selectedOpen = false;

  get events() {
    function normalizeEndTime(end: any, start: any): any {
      const durationShortRegexp =
        /^\+([\d.]+) *(y|M|w|d|h|m|s|ms)$/;
      const durationLongRegexp =
        /^\+([\d.]+) *(years?|months?|weeks?|days?|hours?|minutes?|seconds?|milliseconds?)$/i;
      const match = durationShortRegexp.exec(end || '') || durationLongRegexp.exec(end || '');
      if (match === null) {
        return end;
      }
      else {
        const amount = parseFloat(match[1]);
        const unit = match[2] as dayjs.ManipulateType;
        return dayjs(start)
          .add(amount, unit)
          .format('YYYY-MM-DD HH:mm:ss');
      }
    }
    const events = [];
    for (const entry of this.entries) {
      if (entry.metadata !== null) {
        // Choose a default color for the note based on its path
        let defaultColor = "#666666";
        if (Object.prototype.hasOwnProperty.call(entry.metadata, 'events') && typeof entry.metadata.events === 'object' && entry.metadata.events !== null) {
          for (const [eventName, eventDetail] of Object.entries(entry.metadata.events)) {
            if (typeof eventDetail === 'object' && eventDetail !== null) {
              // If eventDetail has the 'times' property and it is an array
              if (isMetadataEventMultiple(eventDetail)) {
                for (const time of eventDetail.times) {
                  time.end = normalizeEndTime(time.end || eventDetail.end, time.start);
                  const event = {
                    name: eventName,
                    start: time.start,
                    end: time.end,
                    finished: time.finished,
                    color: time.color || eventDetail.color || defaultColor,
                    note: time.note || eventDetail.note,
                    notePath: entry.path,
                  };
                  if (validateEvent(event)) {
                    events.push(event);
                  }
                }
              }
              else {
                eventDetail.end = normalizeEndTime(eventDetail.end, eventDetail.start);
                const event = {
                  name: eventName,
                  start: eventDetail.start,
                  end: eventDetail.end,
                  finished: eventDetail.finished,
                  color: eventDetail.color || defaultColor,
                  note: eventDetail.note,
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

  onCalendarInput(date: string) {
    this.$router.push({
      path: `/calendar/${this.calendarType}/${dayjs(date, 'YYYY-MM-DD').format('YYYY/MM/DD')}`,
    });
  }

  mounted() {
    document.title = `Calendar | ${process.env.VUE_APP_NAME}`;

    if (this.$route.name === 'CalendarWithDate') {
      this.calendarType = this.$route.params.type;
      this.calendarCursor = dayjs(this.$route.params.date, 'YYYY/MM/DD').format('YYYY-MM-DD');
    }

    window.addEventListener('keydown', this.onKeydown);
    window.addEventListener('wheel', this.onWheel);
    window.addEventListener('focus', this.load);

    this.load();
  }

  destroyed() {
    window.removeEventListener('keydown', this.onKeydown);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('focus', this.load);
  }

  onKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft') {
      (this.$refs.calendar as any).prev();
    }
    else if (e.key === 'ArrowRight') {
      (this.$refs.calendar as any).next();
    }
  }

  onWheel(e: WheelEvent) {
    if (e.deltaY < 0) {
      (this.$refs.calendar as any).prev();
    }
    else if (e.deltaY > 0) {
      (this.$refs.calendar as any).next();
    }
  }

  load() {
    this.isLoading = true;
    api.listNotes()
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
    this.$router.push({
      name: 'Calendar',
    });
  }

  viewDay({ date }: { date: string }) {
    this.$router.push({
      path: `/calendar/day/${dayjs(date, 'YYYY-MM-DD').format('YYYY/MM/DD')}`,
    });
  }

  showEvent ({ nativeEvent, event }: { nativeEvent: any, event: any }) {
    const open = () => {
      this.selectedEvent = event;
      this.selectedElement = nativeEvent.target;
      setTimeout(() => {
        this.selectedOpen = true;
      }, 10);
    };

    if (this.selectedOpen) {
      this.selectedOpen = false;
      setTimeout(open, 10);
    } else {
      open();
    }

    nativeEvent.stopPropagation();
  }

  getEventEndTime(event: any): dayjs.Dayjs {
    if (typeof event.end !== 'undefined') {
      return dayjs(event.end);
    }
    else {
      return dayjs(event.start).endOf('day');
    }
  }

  getEventColor(event: any): string {
    const toPropName = (s: string) => s.replace(/-./g, (match: string) => match[1].toUpperCase());
    const color = Object.prototype.hasOwnProperty.call(materialColors, toPropName(event.color))
                ? Color((materialColors as any)[toPropName(event.color)].base)
                : Color(event.color);

    const now = dayjs();
    const time = this.getEventEndTime(event);
    if (time < now || event.finished) {
      return color.fade(0.75).string();
    }
    else {
      return color.string();
    }
  }

  getEventTextColor(event: any): string {
    const now = dayjs();
    const time = this.getEventEndTime(event);
    if (time < now || event.finished) {
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

  renderEventNote(text: string): string {
    return mdit.render(text);
  }
}
</script>

<style scoped lang="scss">
#calendar {
  height: 100%;
}

.event-card {
  user-select: text;
}
</style>
