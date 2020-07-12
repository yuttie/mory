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
          v-for="tag of [...tags].sort()"
          v-bind:key="tag"
          v-bind:color="query.tags.has(tag) ? 'primary' : 'normal'"
          v-on:click="handleTagClick(tag, $event)"
        >{{ tag }}</v-chip>
      </div>
    </div>
    <v-data-table
      v-bind:headers="headers"
      v-bind:items="matchedEntries"
      class="mx-5"
    >
      <template v-slot:item.path="{ item }">
        <router-link class="path" v-bind:to="{ path: `/note/${item.path}` }">{{ item.path }}</router-link>
      </template>
      <template v-slot:item.tags="{ item }">
        <v-chip
          small
          class="ma-1"
          v-for="tag of [...(item.tags || {}).tags || []].sort()"
          v-bind:key="tag"
          v-bind:color="query.tags.has(tag) ? 'primary' : 'normal'"
          v-on:click="handleTagClick(tag, $event)"
          >{{ tag }}</v-chip>
      </template>
    </v-data-table>
    <v-overlay v-bind:value="isLoading" z-index="10">
      <v-progress-circular indeterminate size="64"></v-progress-circular>
    </v-overlay>
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
  metadata: { tags: string[] };
}

@Component
export default class Find extends Vue {
  @Prop(String) readonly token!: null | string;

  entries: ListEntry[] = [];
  queryText = '';
  isLoading = false;

  get headers() {
    return [
      { text: 'Path', value: 'path' },
      { text: 'Tags', value: 'tags', sortable: false },
    ];
  }

  get tags() {
    const tags = new Set();
    for (const entry of this.entries) {
      if (entry.metadata !== null) {
        if (Object.prototype.hasOwnProperty.call(entry.metadata, 'tags')) {
          for (const tag of entry.metadata.tags) {
            tags.add(tag);
          }
        }
      }
    }
    return Array.from(tags) as string[];
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
          if (!Object.prototype.hasOwnProperty.call(entry.metadata, 'tags')) {
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
        tags: entry.metadata,
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

    this.isLoading = true;
    axios.get('/notes')
      .then(res => {
        this.entries = res.data;
        this.isLoading = false;
      }).catch(error => {
        if (error.response) {
          if (error.response.status === 401) {
            // Unauthorized
            this.$emit('tokenExpired');
          }
          else {
            console.log('Unhandled error: {}', error.response);
          }
        }
        else {
          console.log('Unhandled error: {}', error);
        }
        this.isLoading = false;
      });

    if (this.$route.query.q) {
      this.queryText = this.$route.query.q as string;
    }
  }

  destroyed() {
    window.removeEventListener('keydown', this.handleKeydown);
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
