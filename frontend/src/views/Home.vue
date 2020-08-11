<template>
  <div class="home">
    <div class="pa-5">
      <v-calendar
        v-bind:events="events"
        v-on:click:event="onEventClick"
      ></v-calendar>
    </div>
    <v-card
      v-for="category of categorizedEntries.entries()"
      v-bind:key="category"
      class="ma-5"
      outlined
    >
      <v-card-title>{{ category[0] }}</v-card-title>
      <v-card-text>
        <ul>
          <li
            v-for="entry of category[1]"
            v-bind:key="entry.path"
            ><router-link v-bind:to="{ name: 'Note', params: { path: entry.path } }">{{ entry.path }}</router-link></li>
        </ul>
      </v-card-text>
    </v-card>
    <v-overlay v-bind:value="isLoading" z-index="10">
      <v-progress-circular indeterminate size="64"></v-progress-circular>
    </v-overlay>
    <v-snackbar v-model="error" color="error" top timeout="5000">{{ errorText }}</v-snackbar>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Watch, Vue } from 'vue-property-decorator';

import axios from '@/axios';

interface MetadataEvent {
  start: string;
  end?: string;
}

interface Metadata {
  tags?: string[];
  events?: { [key: string]: MetadataEvent };
}

interface ListEntry {
  path: string;
  metadata: Metadata;
}

@Component
export default class Home extends Vue {
  @Prop(String) readonly token!: null | string;

  entries: ListEntry[] = [];
  isLoading = false;
  error = false;
  errorText = '';

  get events() {
    const events = [];
    for (const entry of this.entries) {
      if (entry.metadata !== null) {
        if (Object.prototype.hasOwnProperty.call(entry.metadata, 'events')) {
          console.log(entry.metadata);
          console.log(entry.metadata.events);
          for (const [eventName, event] of Object.entries(entry.metadata.events!)) {
            events.push({
              name: eventName,
              start: event.start,
              end: event.end,
              notePath: entry.path,
            });
          }
        }
      }
    }
    return events;
  }

  get categorizedEntries() {
    const categorized: Map<string, ListEntry[]> = new Map();
    for (const entry of this.entries) {
      if (entry.metadata !== null) {
        if (Object.prototype.hasOwnProperty.call(entry.metadata, 'tags')) {
          for (const tag of entry.metadata.tags!) {
            const match = tag.match(/^home:(.+)$/);
            if (match) {
              const category = match[1];
              if (!categorized.has(category)) {
                categorized.set(category, []);
              }
              categorized.get(category)!.push(entry);
            }
          }
        }
      }
    }
    return categorized;
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
    document.title = `Home | ${process.env.VUE_APP_NAME}`;

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

  onEventClick(e: any) {
    this.$router.push({
      name: 'Note',
      params: { path: e.event.notePath }
    });
  }
}
</script>

<style scoped lang="scss">
</style>
