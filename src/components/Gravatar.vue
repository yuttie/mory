<template>
  <img v-if="email" class="gravatar" v-bind:src="url">
</template>

<script lang="ts">
import { Component, Prop, Vue } from 'vue-property-decorator';

import md5 from 'md5';

@Component
export default class Gravatar extends Vue {
  @Prop(String) private email!: string | null;

  private get emailHash() {
    if (this.email) {
      return md5(this.email);
    }
    else {
      return null;
    }
  }

  private get url() {
    return `https://www.gravatar.com/avatar/${this.emailHash}?size=24&default=identicon`;
  }
}
</script>

<style scoped lang="scss">
.gravatar {
  vertical-align: middle;
  border-radius: 50%;
  margin: 0;
}
</style>
