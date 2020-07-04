<template>
  <div class="find">
    <div>
      <input v-model="queryText" type="text" class="query" autofocus ref="query" placeholder="Search">
      <div class="tags">
        <span
          v-for="tag of [...tags].sort()"
          v-bind:key="tag"
          v-bind:class="{ 'not-in-query': !query.tags.has(tag) }"
          v-on:click="handleTagClick(tag, $event)"
          class="tag"
        >{{ tag }}</span>
      </div>
    </div>
    <ul class="list">
      <li
        v-for="entry of matchedEntries"
        v-bind:key="entry[0]"
      >
        <router-link v-bind:to="{ path: `/view/${entry[0]}` }">{{ entry[0] }}</router-link>
        <span class="note-tags">
          <span
            v-for="tag of [...(entry[1] || {}).tags || []].sort()"
            v-bind:key="tag"
            v-bind:class="{ 'not-in-query': !query.tags.has(tag) }"
            v-on:click="handleTagClick(tag, $event)"
            class="tag"
            >{{ tag }}</span>
        </span>
      </li>
    </ul>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Watch, Vue } from 'vue-property-decorator';

import axios from '@/axios';

interface Query {
  keywords: Set<any>;
  tags: Set<any>;
}

@Component
export default class Find extends Vue {
  @Prop(String) readonly token!: null | string;

  entries: [string, any][] = [];
  queryText = '';

  get tags() {
    const tags = new Set();
    for (const entry of this.entries) {
      if (entry[1] !== null) {
        if (Object.prototype.hasOwnProperty.call(entry[1], 'tags')) {
          for (const tag of entry[1].tags) {
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
        const entryPath = entry[0].toLowerCase();
        if (queryKeywords.some(kw => !entryPath.includes(kw))) {
          continue;
        }
      }
      if (queryTags.length > 0) {
        if (entry[1] === null) {
          continue;
        }
        else {
          if (!Object.prototype.hasOwnProperty.call(entry[1], 'tags')) {
            continue;
          }
          else {
            const entryTags = entry[1].tags.map((x: string) => x.toLowerCase());
            if (queryTags.some(tag => !entryTags.includes(tag))) {
              continue;
            }
          }
        }
      }
      matched.push(entry);
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

    axios.get('/notes')
      .then(res => {
        this.entries = res.data;
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
      this.selectTag(tag);
    }
  }

  selectTag(tag: string) {
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

  toggleTag(tag: string) {
    let hashtag = '#' + tag;
    if (/\s/.test(hashtag)) {
      hashtag = `"${hashtag}"`;
    }

    let queryElems = [...this.queryText.matchAll(/("[^"]+")|([^\s]+)/g)].map(x => x[1] || x[2]);
    if (this.query.tags.has(tag)) {
      queryElems = queryElems.filter(x => x !== hashtag);
    }
    else {
      queryElems.push(hashtag);
    }
    this.queryText = queryElems.join(' ');
  }
}
</script>

<style scoped lang="scss">
.find {
  display: flex;
  flex-direction: column;
  padding: 1em;
}

.query {
  display: block;
  width: 100%;
  font-size: 1.2em;
  padding: 0.2em 0.4em;
}

.list {
  flex: 1 1 0;
  overflow: auto;
  margin: 0;
  padding: 1em;
}

.tags {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
  margin: 1em;
}

.note-tags {
  .tag {
    font-size: 0.8em;
  }
}

.tag {
  display: inline-block;
  color: #ffffff;
  background-color: #cb4b63;
  border-radius: 4px;
  padding: 0.2em 0.4em;
  margin: 0.1em 0.2em;
  cursor: pointer;
  user-select: none;
  transition: color 100ms,
              background-color 100ms;

  &.not-in-query {
    color: #ccc;
    background-color: #fafafa;
  }

  &.not-in-query:hover {
    color: #ccc;
    background-color: #fef3f5;
  }
}
</style>
