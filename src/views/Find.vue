<template>
  <div class="find">
    <div>
      <input v-on:input="onQueryInput($event)" type="text" class="query" autofocus ref="query">
      <div class="tags">
        <span
          v-for="tag of tags"
          v-bind:key="tag"
          v-bind:class="{ 'not-in-query': queryTags.size > 0 && !queryTags.has(tag) }"
          class="tag"
        >{{ tag }}</span>
      </div>
    </div>
    <ul class="list">
      <li
        v-for="entry of matchedEntries"
        v-bind:key="entry[0]"><a v-bind:href="`/view/${entry[0]}`">{{ entry[0] }}</a></li>
    </ul>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Vue } from 'vue-property-decorator';

import axios from 'axios';

@Component
export default class Find extends Vue {
  entries: [string, any][] = [];
  tags: string[] = [];
  queryKeywords: Set<any> = new Set();
  queryTags: Set<any> = new Set();

  get matchedEntries() {
    const matched = [];

    const queryKeywords = [...this.queryKeywords];
    const queryTags = [...this.queryTags];

    for (const entry of this.entries) {
      if (queryKeywords.length > 0) {
        if (queryKeywords.some(kw => !entry[0].includes(kw))) {
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
            if (queryTags.some(tag => !entry[1].tags.includes(tag))) {
              continue;
            }
          }
        }
      }
      matched.push(entry);
    }

    return matched;
  }

  mounted() {
    window.addEventListener('keydown', this.handleKeydown);

    axios.get('http://localhost:3030/notes')
      .then(res => {
        const tags = new Set();
        this.entries = res.data;
        for (const entry of this.entries) {
          if (entry[1] !== null) {
            if (Object.prototype.hasOwnProperty.call(entry[1], 'tags')) {
              for (const tag of entry[1].tags) {
                tags.add(tag);
              }
            }
          }
        }
        this.tags = Array.from(tags) as string[];
      });
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

  onQueryInput(e: InputEvent) {
    const query = (e.target as HTMLInputElement).value;
    const queryKeywords = new Set();
    const queryTags = new Set();
    for (const match of query.matchAll(/"([^"]+)"|([^\s]+)/g)) {
      const text = match[1] || match[2];
      if (text.startsWith('#')) {
        queryTags.add(text.slice(1));
      }
      else {
        queryKeywords.add(text);
      }
    }
    this.queryKeywords = queryKeywords;
    this.queryTags = queryTags;
  }
}
</script>

<style scoped lang="scss">
.find {
  display: flex;
  flex-direction: column;
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

.tag {
  border: 1px solid #ccc;
  border-radius: 4px;
  margin: 0 4px;

  &.not-in-query {
    opacity: 0.5;
  }
}
</style>
