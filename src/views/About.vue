<template>
  <div id="about">
    <div class="logo"></div>
    <div class="logo-text">{{ name }}</div>
    <div class="version">Version {{ version }}</div>
    <div class="copyright">Copyright © {{ fromYear }}&ndash;{{ buildYear }} {{ author }}</div>
  </div>
</template>

<script lang="ts">
import { Component, Vue } from 'vue-property-decorator';

@Component
export default class About extends Vue {
  name: string = process.env.VUE_APP_NAME!;  // eslint-disable-line @typescript-eslint/no-non-null-assertion
  version: string = process.env.VUE_APP_VERSION!;  // eslint-disable-line @typescript-eslint/no-non-null-assertion
  author: string = process.env.VUE_APP_AUTHOR!;  // eslint-disable-line @typescript-eslint/no-non-null-assertion
  fromYear = 2020;
  buildYear: number = parseInt(process.env.VUE_APP_BUILD_YEAR!);  // eslint-disable-line @typescript-eslint/no-non-null-assertion

  mounted() {
    document.title = `About | ${process.env.VUE_APP_NAME}`;
  }
}
</script>

<style scoped lang="scss">
#about {
  padding: 50px 1em;

  display: flex;
  flex-direction: column;
  align-items: center;

  user-select: text;

  &::before, &::after {
    content: '';
    flex-grow: 1;
  }
}

.logo {
  width: 256px;
  height: 256px;

  background-size: contain;
  background-position: center;
  background-repeat: no-repeat;
  background-image: url("../assets/logo.svg");

  margin-bottom: 0.2em;
}

.logo-text {
  font-size: 4rem;
  font-weight: 100;
  $letter-space: 0.2em;
  letter-spacing: $letter-space;
  margin-right: -$letter-space;
}

.copyright {
  margin-top: 2em;
}
</style>
