<template>
  <div class="home">
    <v-card
      v-for="category of categorizedEntries.entries()"
      v-bind:key="category"
      class="ma-5"
      outlined
    >
      <v-card-title>{{ category[0] }}</v-card-title>
      <v-card-text>
        <ul>
          <li
            v-for="entry of category[1]"
            v-bind:key="entry[0]"
            ><router-link v-bind:to="{ name: 'Note', params: { path: entry[0] } }">{{ entry[0] }}</router-link></li>
        </ul>
      </v-card-text>
    </v-card>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Watch, Vue } from 'vue-property-decorator';

import axios from '@/axios';

@Component
export default class Home extends Vue {
  @Prop(String) readonly token!: null | string;

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

  @Watch('token')
  onTokenChanged(token: null | string) {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    }
    else {
      delete axios.defaults.headers.common['Authorization'];
    }
  }

  mounted() {
    document.title = `Home | ${process.env.VUE_APP_NAME}`;

    this.onTokenChanged(this.token);

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
  }

}
</script>

<style scoped lang="scss">
</style>
