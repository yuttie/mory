<template>
  <div class="find">
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
export default class Home extends Vue {
  entries: string[] = [];

  mounted() {
    axios.get('http://localhost:3030/list')
      .then(res => {
        this.entries = res.data;
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
