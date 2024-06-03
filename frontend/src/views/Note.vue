<template>
  <div id="note">
    <EditableViewer v-on:tokenExpired="$emit('tokenExpired')"></EditableViewer>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Watch, Vue } from 'vue-property-decorator';

import EditableViewer from '@/components/EditableViewer.vue';

@Component({
  components: {
    EditableViewer,
  },
})
export default class Note extends Vue {
}
</script>

<style scoped lang="scss">
#note {
  display: flex;
  flex-direction: row;

  & > * {
    flex: 1 1;
    min-width: 0;
  }
}
</style>
