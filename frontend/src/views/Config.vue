<template>
  <div class="config">
    <h1>Config</h1>
    <v-alert text type="info">
      These settings are only applied to the current environment and never be saved in the repository.
    </v-alert>
    <v-select
      v-bind:items="keybindings"
      v-bind:value="currentKeybinding"
      v-on:change="updateKeybinding"
      label="Keybinding"
      item-text="name"
      item-value="value"
    >
    </v-select>
  </div>
</template>

<script lang="ts">
import { Component, Vue } from 'vue-property-decorator';

@Component
export default class Config extends Vue {
  keybindings  = [
    { name: 'Default', value: 'default' },
    { name: 'Vim', value: 'vim' },
    { name: 'Vim (with Emacs-like insert mode mappings)', value: 'vim-modified' },
  ];
  currentKeybinding = localStorage.getItem('keybinding') || 'default';

  mounted() {
    document.title = `Config | ${process.env.VUE_APP_NAME}`;
  }

  updateKeybinding(newKeybinding: string) {
    console.log(newKeybinding);
    localStorage.setItem('keybinding', newKeybinding);
  }
}
</script>

<style scoped lang="scss">
.config {
  padding: 50px 1em;

  display: flex;
  flex-direction: column;
  align-items: center;

  &::before, &::after {
    content: '';
    flex-grow: 1;
  }
}
</style>
