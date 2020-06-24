<template>
  <div class="home">
    <div
      v-for="category of categorizedEntries.entries()"
      v-bind:key="category"
      class="category"
    >
      <h1>{{ category[0] }}</h1>
      <ul>
        <li
          v-for="entry of category[1]"
          v-bind:key="entry[0]"
        ><router-link v-bind:to="{ name: 'View', params: { path: entry[0] } }">{{ entry[0] }}</router-link></li>
      </ul>
    </div>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Vue } from 'vue-property-decorator';

import axios from 'axios';

@Component
export default class Home extends Vue {
  entries: [string, any][] = [];

  get categorizedEntries() {
    const categorized: Map<string, [string, any][]> = new Map();
    for (const entry of this.entries) {
      if (entry[1] !== null) {
        if (Object.prototype.hasOwnProperty.call(entry[1], 'tags')) {
          for (const tag of entry[1].tags) {
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

  mounted() {
    axios.get('http://localhost:3030/notes')
      .then(res => {
        this.entries = res.data;
      });
  }

}
</script>

<style scoped lang="scss">
.category {
  border: 1px solid #ccc;
  border-radius: 0.5em;
}
</style>
