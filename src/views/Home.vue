<template>
  <div class="home">
    <v-card
      v-for="category of categorizedEntries.entries()"
      v-bind:key="category[0]"
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
    <v-overlay v-bind:value="isLoading" z-index="10" opacity="0">
      <v-progress-circular indeterminate color="blue-grey lighten-3" size="64"></v-progress-circular>
    </v-overlay>
    <v-snackbar v-model="error" color="error" top timeout="5000">{{ errorText }}</v-snackbar>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Watch, Vue } from 'vue-property-decorator';

import axios from '@/axios';
import { ListEntry } from '@/api';
import Color from 'color';
import materialColors from 'vuetify/lib/util/colors';
import XXH from 'xxhashjs';

@Component
export default class Home extends Vue {
  @Prop(String) readonly token!: null | string;

  entries: ListEntry[] = [];
  isLoading = false;
  error = false;
  errorText = '';

  get categorizedEntries() {
    const categorized: Map<string, ListEntry[]> = new Map();
    for (const entry of this.entries) {
      if (entry.metadata !== null) {
        if (Object.prototype.hasOwnProperty.call(entry.metadata, 'tags') && Array.isArray(entry.metadata.tags)) {
          for (const tag of entry.metadata.tags.map(String)) {
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
}
</script>

<style scoped lang="scss">
</style>
