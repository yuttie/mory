<template>
  <div id="find" class="d-flex flex-column">
    <v-menu
      v-model="showingTagList"
      v-bind:close-on-content-click="false"
      offset-y
      bottom
    >
      <template v-slot:activator="{ on }">
        <v-text-field
          v-model="queryText"
          dense
          filled
          rounded
          prepend-inner-icon="mdi-magnify"
          v-on:focus="on.click"
          type="text"
          label="Search"
          autofocus
          autocomplete="off"
          hide-details="auto"
          ref="query"
          class="mx-3 mt-3 flex-grow-0"
        >
          <template v-slot:append>
            <v-btn icon v-bind:ripple="false" v-on:click="clearQuery" v-if="queryText !== ''">
              <v-icon>mdi-close</v-icon>
            </v-btn>
          </template>
        </v-text-field>
      </template>
      <v-card>
        <v-card-text class="all-tags d-flex flex-row align-center flex-wrap">
          <v-chip
            small
            class="ma-1"
            v-for="tag of tags"
            v-bind:key="tag"
            v-bind:color="tagColor(tag)"
            v-bind:outlined="tagOutlined(tag)"
            v-on:click="handleTagClick(tag, $event)"
          >{{ tag }}</v-chip>
        </v-card-text>
      </v-card>
    </v-menu>
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
      class="mt-3 flex-grow-1"
    >
      <template v-slot:top="{ pagination, options, updateOptions }">
        <v-toolbar flat style="border-bottom: thin solid rgba(0, 0, 0, 0.12);">
          <v-btn
            v-bind:disabled="selected.length === 0"
            v-on:click="deleteSelected"
            icon
            color="pink"
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
        <span class="path"><v-icon class="mr-1">mdi-file-document-outline</v-icon><router-link v-bind:to="{ path: `/note/${item.path}` }">{{ item.path }}</router-link></span>
      </template>
      <template v-slot:item.time="{ item }">
        <div class="modified text-no-wrap">{{ item.time.format('YYYY-MM-DD HH:mm:ss') }}</div>
      </template>
      <template v-slot:item.size="{ item }">
        <div class="size text-no-wrap">{{ formatFileSize(item.size) }}</div>
      </template>
      <template v-slot:item.mimeType="{ item }">
        <div class="mime-type text-no-wrap">{{ item.mimeType }}</div>
      </template>
      <template v-slot:item.tags="{ item }">
        <div class="tags">
          <v-chip
            small
            class="ma-1"
            v-for="tag of item.tags"
            v-bind:key="tag"
            v-bind:color="tagColor(tag)"
            v-bind:outlined="tagOutlined(tag)"
            v-on:click="handleTagClick(tag, $event)"
            >{{ tag }}</v-chip>
        </div>
      </template>
    </v-data-table>
    <v-overlay v-bind:value="isLoading" z-index="10" opacity="0">
      <v-progress-circular indeterminate color="blue-grey lighten-3" size="64"></v-progress-circular>
    </v-overlay>
    <v-snackbar v-model="error" color="error" top timeout="5000">{{ errorText }}</v-snackbar>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Watch, Vue } from 'vue-property-decorator';

import * as api from '@/api';
import { Query, ListEntry2, compareTags } from '@/api';

import dayjs from 'dayjs';

@Component
export default class Find extends Vue {
  entries: ListEntry2[] = [];
  queryText = '';
  isLoading = false;
  error = false;
  errorText = '';
  selected = [] as any[];
  showingTagList = false;

  get headers() {
    return [
      { text: 'Path', value: 'path' },
      { text: 'Modified', value: 'time', sort: (a: any, b: any) => a - b },
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
          for (const tag of entry.metadata.tags.map(String)) {
            tags.add(tag);
          }
        }
      }
    }
    return Array.from(tags).sort(compareTags as (a: any, b: any) => number) as string[];
  }

  get query() {
    const queryPaths = new Set();
    const queryTags = new Set();
    const queryAny = new Set();
    for (const match of this.queryText.matchAll(/"([^"]+)"|([^\s]+)/g)) {
      const text = match[1] || match[2];
      if (text.startsWith('#')) {
        queryTags.add(text.slice(1));
      }
      else if (text.startsWith('/')) {
        queryPaths.add(text.slice(1));
      }
      else {
        queryAny.add(text);
      }
    }

    return {
      paths: queryPaths,
      tags: queryTags,
      any: queryAny,
    };
  }

  get matchedEntries() {
    const matched = [];

    const query: Query = this.query;
    const queryPaths: string[] = [...query.paths].map(x => x.toLowerCase());
    const queryTags: string[] = [...query.tags].map(x => x.toLowerCase());
    const queryAny: string[] = [...query.any].map(x => x.toLowerCase());

    for (const entry of this.entries) {
      const entryPath = entry.path.toLowerCase();
      const entryTags = (() => {
        if (entry.metadata === null) {
          return [];
        }
        else if (!Object.prototype.hasOwnProperty.call(entry.metadata, 'tags')) {
          return [];
        }
        else if (!Array.isArray(entry.metadata.tags)) {
          return [];
        }
        else {
          return entry.metadata.tags.map((tag: any) => String(tag).toLowerCase());
        }
      })();
      // Check if all conditions are met or notl
      if (queryPaths.some(kw => !entryPath.includes(kw))) {
        continue;
      }
      if (queryTags.some(tag => !entryTags.some(entryTag => entryTag.includes(tag)))) {
        continue;
      }
      if (queryAny.some(kw => !entryPath.includes(kw) && !entryTags.some(entryTag => entryTag.includes(kw)))) {
        continue;
      }
      // OK, this entry matches all the queries
      matched.push({
        path: entry.path,
        size: entry.size,
        mimeType: entry.mime_type,
        tags: ((entry.metadata || {}).tags || []).sort(compareTags as (a: any, b: any) => number),
        time: dayjs(entry.time),
      });
    }

    return matched;
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

  handleKeydown(e: KeyboardEvent) {
    if (e.key === '/') {
      (this.$refs.query as HTMLInputElement).focus();
      e.preventDefault();
    }
  }

  clearQuery(e: MouseEvent) {
    this.queryText = '';
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

  tagOutlined(tag: string) {
    const query: Query = this.query;
    const queryTags: string[] = [...query.tags].map(x => x.toLowerCase());
    const queryAny: string[] = [...query.any].map(x => x.toLowerCase());
    if (queryTags.some(x => tag.toLowerCase().includes(x)) || queryAny.some(x => tag.toLowerCase().includes(x))) {
      return false;
    }
    else {
      return true;
    }
  }

  tagColor(tag: string) {
    const query: Query = this.query;
    const queryTags: string[] = [...query.tags].map(x => x.toLowerCase());
    const queryAny: string[] = [...query.any].map(x => x.toLowerCase());
    if (queryTags.some(x => tag.toLowerCase().includes(x)) || queryAny.some(x => tag.toLowerCase().includes(x))) {
      return 'primary';
    }
    else {
      return 'normal';
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
      api.deleteNote(item.path)
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
#find {
  height: 100%;
}

.all-tags {
  max-height: 30em;
  overflow-y: auto;
}

.path,
.modified,
.size,
.mime-type {
  user-select: text;
}

.path {
  white-space: nowrap;

  a {
    color: rgba(0, 0, 0, 0.87);
    text-decoration: none;

    &:hover {
      color: var(--v-anchor-base);
      text-decoration: underline;
    }
  }
}

.tags {
  white-space: nowrap;
}
</style>
