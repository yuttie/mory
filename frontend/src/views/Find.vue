<template>
  <div class="find">
    <div class="mx-5 my-3">
      <v-text-field
        v-model="queryText"
        solo
        prepend-inner-icon="mdi-magnify"
        type="text"
        label="Search"
        autofocus
        autocomplete="off"
        hide-details="auto"
        ref="query"
      >
        <template v-slot:append>
          <v-btn icon v-bind:ripple="false" v-on:click="queryText = ''" v-if="queryText !== ''">
            <v-icon>mdi-close</v-icon>
          </v-btn>
        </template>
      </v-text-field>
      <div class="d-flex flex-row align-center flex-wrap my-5">
        <v-chip
          small
          class="ma-1"
          v-for="tag of tags"
          v-bind:key="tag"
          v-bind:color="query.tags.has(tag) ? 'primary' : 'normal'"
          v-on:click="handleTagClick(tag, $event)"
        >{{ tag }}</v-chip>
      </div>
    </div>
    <v-data-table
      v-bind:headers="headers"
      v-bind:items="matchedEntries"
      v-model="selected"
      item-key="path"
      hide-default-footer
      sortBy="time"
      sort-desc
      must-sort
      show-select
      class="mx-5"
    >
      <template v-slot:top="{ pagination, options, updateOptions }">
        <v-toolbar flat style="border-bottom: thin solid rgba(0, 0, 0, 0.12);">
          <v-btn
            v-bind:disabled="selected.length === 0"
            v-on:click="deleteSelected"
            icon
          >
            <v-icon>mdi-delete</v-icon>
          </v-btn>
          <v-spacer></v-spacer>
          <v-data-footer
            v-bind:pagination="pagination"
            v-bind:options="options"
            v-on:update:options="updateOptions"
            items-per-page-text="$vuetify.dataTable.itemsPerPageText"
            style="border-top: none; margin-right: -16px;"
            ></v-data-footer>
        </v-toolbar>
      </template>
      <template v-slot:item.path="{ item }">
        <v-icon class="mr-1">mdi-file-document-outline</v-icon><router-link class="path" v-bind:to="{ path: `/note/${item.path}` }">{{ item.path }}</router-link>
      </template>
      <template v-slot:item.time="{ item }">
        <div class="text-no-wrap">{{ item.time.toLocaleString() }}</div>
      </template>
      <template v-slot:item.size="{ item }">
        <div class="text-no-wrap">{{ formatFileSize(item.size) }}</div>
      </template>
      <template v-slot:item.mimeType="{ item }">
        <div class="text-no-wrap">{{ item.mimeType }}</div>
      </template>
      <template v-slot:item.tags="{ item }">
        <v-chip
          small
          class="ma-1"
          v-for="tag of item.tags"
          v-bind:key="tag"
          v-bind:color="query.tags.has(tag) ? 'primary' : 'normal'"
          v-on:click="handleTagClick(tag, $event)"
          >{{ tag }}</v-chip>
      </template>
    </v-data-table>
    <v-overlay v-bind:value="isLoading" z-index="10">
      <v-progress-circular indeterminate size="64"></v-progress-circular>
    </v-overlay>
    <v-snackbar v-model="error" color="error" top timeout="5000">{{ errorText }}</v-snackbar>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Watch, Vue } from 'vue-property-decorator';

import axios from '@/axios';

interface Query {
  keywords: Set<any>;
  tags: Set<any>;
}

interface ListEntry {
  path: string;
  size: number;
  mime_type: string;
  metadata: { tags: string[] } | null;
  time: string;
}

function compareTags(a: string, b: string): number {
  const A = a.toUpperCase();
  const B = b.toUpperCase();
  if (A < B) {
    return -1;
  }
  if (A > B) {
    return 1;
  }
  return 0;
}

@Component
export default class Find extends Vue {
  @Prop(String) readonly token!: null | string;

  entries: ListEntry[] = [];
  queryText = '';
  isLoading = false;
  error = false;
  errorText = '';
  selected = [] as any[];

  get headers() {
    return [
      { text: 'Path', value: 'path' },
      { text: 'Modified', value: 'time', sort: (a: any, b: any) => a.getTime() - b.getTime() },
      { text: 'Size', value: 'size' },
      { text: 'Type', value: 'mimeType' },
      { text: 'Tags', value: 'tags', sortable: false },
    ];
  }

  get tags() {
    const tags = new Set();
    for (const entry of this.entries) {
      if (entry.metadata !== null) {
        if (Object.prototype.hasOwnProperty.call(entry.metadata, 'tags') && Array.isArray(entry.metadata.tags)) {
          for (const tag of entry.metadata.tags) {
            tags.add(tag);
          }
        }
      }
    }
    return Array.from(tags).sort(compareTags as (a: any, b: any) => number) as string[];
  }

  get query() {
    const queryKeywords = new Set();
    const queryTags = new Set();
    for (const match of this.queryText.matchAll(/"([^"]+)"|([^\s]+)/g)) {
      const text = match[1] || match[2];
      if (text.startsWith('#')) {
        queryTags.add(text.slice(1));
      }
      else {
        queryKeywords.add(text);
      }
    }

    return {
      keywords: queryKeywords,
      tags: queryTags,
    };
  }

  get matchedEntries() {
    const matched = [];

    const query: Query = this.query;
    const queryKeywords: string[] = [...query.keywords].map(x => x.toLowerCase());
    const queryTags: string[] = [...query.tags].map(x => x.toLowerCase());

    for (const entry of this.entries) {
      if (queryKeywords.length > 0) {
        const entryPath = entry.path.toLowerCase();
        if (queryKeywords.some(kw => !entryPath.includes(kw))) {
          continue;
        }
      }
      if (queryTags.length > 0) {
        if (entry.metadata === null) {
          continue;
        }
        else {
          if (!(Object.prototype.hasOwnProperty.call(entry.metadata, 'tags') && Array.isArray(entry.metadata.tags))) {
            continue;
          }
          else {
            const entryTags = entry.metadata.tags.map((x: string) => x.toLowerCase());
            if (queryTags.some(tag => !entryTags.includes(tag))) {
              continue;
            }
          }
        }
      }
      matched.push({
        path: entry.path,
        size: entry.size,
        mimeType: entry.mime_type,
        tags: ((entry.metadata || {}).tags || []).sort(compareTags as (a: any, b: any) => number),
        time: new Date(entry.time),
      });
    }

    return matched;
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

  @Watch('queryText')
  onQueryTextChanged(q: string) {
    if (q !== this.$route.query.q) {
      this.$router.replace({
        query: {
          ...this.$route.query,
          q: q,
        },
      });
    }
  }

  mounted() {
    document.title = `Find | ${process.env.VUE_APP_NAME}`;

    this.onTokenChanged(this.token);

    window.addEventListener('keydown', this.handleKeydown);

    this.load();

    if (this.$route.query.q) {
      this.queryText = this.$route.query.q as string;
    }
  }

  destroyed() {
    window.removeEventListener('keydown', this.handleKeydown);
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

  handleKeydown(e: KeyboardEvent) {
    if (e.key === '/') {
      (this.$refs.query as HTMLInputElement).focus();
      e.preventDefault();
    }
  }

  handleTagClick(tag: string, e: MouseEvent) {
    if (e.ctrlKey) {
      this.toggleTag(tag);
    }
    else {
      if (this.query.tags.size === 1 && this.query.tags.has(tag)) {
        this.removeTag(tag);
      }
      else {
        this.selectSingleTag(tag);
      }
    }
  }

  selectSingleTag(tag: string) {
    let hashtag = '#' + tag;
    if (/\s/.test(hashtag)) {
      hashtag = `"${hashtag}"`;
    }

    let queryElems = [...this.queryText.matchAll(/("[^"]+")|([^\s]+)/g)].map(x => x[1] || x[2]);
    queryElems = queryElems.filter(x => x === hashtag || !(x.startsWith('#') || x.startsWith('"#')));
    if (!this.query.tags.has(tag)) {
      queryElems.push(hashtag);
    }
    this.queryText = queryElems.join(' ');
  }

  addTag(tag: string) {
    let hashtag = '#' + tag;
    if (/\s/.test(hashtag)) {
      hashtag = `"${hashtag}"`;
    }

    const queryElems = [...this.queryText.matchAll(/("[^"]+")|([^\s]+)/g)].map(x => x[1] || x[2]);
    if (!this.query.tags.has(tag)) {
      queryElems.push(hashtag);
    }

    this.queryText = queryElems.join(' ');
  }

  removeTag(tag: string) {
    let hashtag = '#' + tag;
    if (/\s/.test(hashtag)) {
      hashtag = `"${hashtag}"`;
    }

    let queryElems = [...this.queryText.matchAll(/("[^"]+")|([^\s]+)/g)].map(x => x[1] || x[2]);
    queryElems = queryElems.filter(x => x !== hashtag);

    this.queryText = queryElems.join(' ');
  }

  toggleTag(tag: string) {
    if (this.query.tags.has(tag)) {
      this.removeTag(tag);
    }
    else {
      this.addTag(tag);
    }
  }

  formatFileSize(size: number) {
    const units = ['B', 'KiB', 'MiB', 'GiB'];
    let i = 0;
    while (size >= 0.9 * 1024 && i < units.length - 1) {
      size /= 1024;
      i += 1;
    }
    if (i === 0) {
      return `${size.toFixed(0)} ${units[i]}`;
    }
    else {
      return `${size.toFixed(1)} ${units[i]}`;
    }
  }

  deleteSelected() {
    for (const item of this.selected) {
      axios.delete(`/notes/${item.path}`)
        .then(res => {
          if (res.data === true) {
            const i = this.entries.findIndex(e => e.path === item.path);
            this.entries.splice(i, 1);
          }
          else {
            this.error = true;
            this.errorText = `Something wrong happened when deleting ${item.path}`;
          }
        }).catch(error => {
          if (error.response) {
            if (error.response.status === 401) {
              // Unauthorized
              this.$emit('tokenExpired', () => this.deleteSelected());
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
}
</script>

<style scoped lang="scss">
.path {
  color: rgba(0, 0, 0, 0.87);
  text-decoration: none;

  &:hover {
    color: var(--v-anchor-base);
    text-decoration: underline;
  }
}
</style>
