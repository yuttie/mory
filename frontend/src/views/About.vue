<template>
  <div class="about">
    <div class="logo"><img src="@/assets/logo.png"></div>
    <div class="name">{{ name }}</div>
    <div class="version">Version {{ version }}</div>
    <div class="copyright">Copyright © {{ fromYear }}&ndash;{{ buildYear }} {{ author }}</div>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Vue } from 'vue-property-decorator';

@Component
export default class About extends Vue {
  name: string = process.env.VUE_APP_NAME;
  version: string = process.env.VUE_APP_VERSION;
  author: string = process.env.VUE_APP_AUTHOR;
  fromYear = 2020;
  buildYear: number = process.env.VUE_APP_BUILD_YEAR;
}
</script>

<style scoped lang="scss">
.about {
  padding: 1em;

  display: flex;
  flex-direction: column;
  align-items: center;

  &::before, &::after {
    content: '';
    flex-grow: 1;
  }
}

.logo {
  padding-bottom: 1em;
  border-bottom: 1px solid #ccc;
}

.name {
  color: #333;
  font-family: sans-serif;
  font-size: 4em;
  font-weight: normal;
  line-height: 1.2em;
  $letter-spacing: 0.5em;
  padding-left: $letter-spacing;
  letter-spacing: $letter-spacing;
}

.copyright {
  margin-top: 2em;
}
</style>
