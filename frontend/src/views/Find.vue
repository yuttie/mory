<template>
  <div class="find">
    <div>
      <span
        v-for="tag of tags"
        v-bind:key="tag"
        style="border: 1px solid #ccc; border-radius: 4px; margin: 0 4px;"
      >{{ tag }}</span>
    </div>
    <ul>
      <li
        v-for="entry of entries"
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

  mounted() {
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
}
</script>

<style scoped lang="scss">
.editor {
  position: absolute;
  width: 50%;
  height: 100%;
  margin-left: -50%;
  transition: margin-left 500ms;
  resize: none;
}

.rendered {
  margin-left: 0;
  width: 100%;
  height: 100%;
  transition: margin-left 500ms,
              width 500ms;
}

.editor.shifted {
  margin-left: 0;
}

.rendered.shifted {
  margin-left: 50%;
  width: 50%;
}
</style>
