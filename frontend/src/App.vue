<template>
  <v-app id="app" ref="app">
    <v-navigation-drawer
      app
      clipped
      mini-variant
      permanent
      expand-on-hover
      v-if="!$vuetify.breakpoint.xs"
    >
      <v-list
        dense
        nav
      >
        <v-list-item color="primary" link to="/"><v-list-item-icon><v-icon>mdi-home-outline</v-icon></v-list-item-icon><v-list-item-title>Home</v-list-item-title></v-list-item>
        <v-list-item color="primary" link to="/calendar"><v-list-item-icon><v-icon>mdi-calendar-outline</v-icon></v-list-item-icon><v-list-item-title>Calendar</v-list-item-title></v-list-item>
        <v-list-item color="primary" link to="/tasks"><v-list-item-icon><v-icon>mdi-ballot-outline</v-icon></v-list-item-icon><v-list-item-title>Tasks</v-list-item-title></v-list-item>
        <v-list-item color="primary" link to="/find"><v-list-item-icon><v-icon>mdi-magnify</v-icon></v-list-item-icon><v-list-item-title>Find</v-list-item-title></v-list-item>
        <v-list-item color="primary" link to="/config"><v-list-item-icon><v-icon>mdi-cog-outline</v-icon></v-list-item-icon><v-list-item-title>Config</v-list-item-title></v-list-item>
        <v-list-item color="primary" link to="/about"><v-list-item-icon><v-icon>mdi-information-outline</v-icon></v-list-item-icon><v-list-item-title>About</v-list-item-title></v-list-item>
      </v-list>

      <v-divider></v-divider>

      <v-treeview
        v-bind:active.sync="noteTreeActive"
        v-bind:items="noteTreeRoot"
        v-bind:load-children="populateTagChildren"
        v-bind:open.sync="noteTreeOpen"
        activatable
        open-on-click
        transition
        dense
      >
        <template v-slot:prepend="{ item, open }">
          <v-icon v-if="item.children">
            {{ open ? 'mdi-folder-open' : 'mdi-folder' }}
          </v-icon>
          <v-icon v-else>
            mdi-file-document-outline
          </v-icon>
        </template>
      </v-treeview>
    </v-navigation-drawer>

    <v-app-bar
      app
      dense
      clipped-left
      color="white"
      elevation="0"
    >
      <v-img
        src="./assets/logo.svg"
        aspect-ratio="1"
        contain
        max-width="24"
        max-height="24"
        class="mr-2"
      ></v-img>
      <v-toolbar-title>mory</v-toolbar-title>
      <v-spacer></v-spacer>
      <input type="file" multiple class="d-none" ref="fileInputEl">
      <v-menu
        offset-y
      >
        <template v-slot:activator="{ on, attrs }">
          <v-btn
            text
            title="Add note"
            class="mr-2"
            style="padding: 0; min-width: 36px"
            v-bind="attrs"
            v-on="on"
          >
            <v-icon>mdi-plus-box-outline</v-icon>
          </v-btn>
        </template>
        <v-list>
          <v-subheader>Create</v-subheader>
          <v-list-item to="/create">
            <v-list-item-icon>
              <v-icon>mdi-file-outline</v-icon>
            </v-list-item-icon>
            <v-list-item-content>
              <v-list-item-title>New note</v-list-item-title>
            </v-list-item-content>
          </v-list-item>
          <v-list-item
            v-if="$route.name === 'Note'"
            v-bind:to="{ name: 'Create', query: { from: $route.params.path } }"
          >
            <v-list-item-icon>
              <v-icon>mdi-file-multiple-outline</v-icon>
            </v-list-item-icon>
            <v-list-item-content>
              <v-list-item-title>Copy of this note</v-list-item-title>
            </v-list-item-content>
          </v-list-item>
          <v-subheader>Templates</v-subheader>
          <v-list-item
            v-for="path in templates"
            v-bind:key="path"
            v-bind:to="{ name: 'Create', query: { from: path } }"
          >
            <v-list-item-icon>
              <v-icon>mdi-file-document-outline</v-icon>
            </v-list-item-icon>
            <v-list-item-content>
              <v-list-item-title>{{ path.replace(/\.template$/i, '') }}</v-list-item-title>
            </v-list-item-content>
            <v-list-item-action>
              <v-tooltip top>
                <template v-slot:activator="{ on, attrs }">
                  <v-btn
                    icon
                    v-bind="attrs"
                    v-on="on"
                    v-bind:to="{ name: 'Note', params: { path: path } }"
                  >
                    <v-icon>mdi-pencil</v-icon>
                  </v-btn>
                </template>
                <span>Edit template</span>
              </v-tooltip>
            </v-list-item-action>
          </v-list-item>
        </v-list>
      </v-menu>
      <v-menu
        v-bind:close-on-content-click="false"
        v-model="uploadMenuIsVisible"
        offset-y
      >
        <template v-slot:activator="{ attrs, on }">
          <v-btn
            text
            title="Upload file"
            class="mr-2"
            style="padding: 0; min-width: 36px"
            v-bind="attrs"
            v-on="on"
          >
            <v-badge
              v-bind:color="uploadListBadgeColor"
              v-bind:icon="uploadListBadgeIcon"
              v-bind:value="uploadList.length > 0"
              overlap
              offset-x="20"
              offset-y="20"
              bordered
            >
              <v-icon>mdi-cloud-upload-outline</v-icon>
            </v-badge>
          </v-btn>
        </template>
        <v-card>
          <v-card-actions>
            <v-btn
              text
              block
              color="primary"
              v-on:click="chooseFile"
            >Upload</v-btn>
          </v-card-actions>
          <v-divider v-if="uploadList.length > 0"></v-divider>
          <v-list
            v-if="uploadList.length > 0"
            dense
          >
            <v-list-item
              v-for="entry of uploadList"
              v-bind:key="entry.uuid"
              v-on:click="copyToClipboard(entry.filename)"
              style="white-space: nowrap;"
            >
              <v-list-item-content>
                <v-list-item-title>
                <v-tooltip top>
                  <template v-slot:activator="{ on, attrs }">
                    <v-icon
                      v-bind:color="uploadStatusColor(entry.status)"
                      v-bind="attrs"
                      v-on="on"
                      small
                      class="mr-1"
                    >{{ uploadStatusIcon(entry.status) }}</v-icon>
                  </template>
                  <span>{{ entry.statusMessage }}</span>
                </v-tooltip>
                <span>{{ entry.filename }}</span>
                </v-list-item-title>
              </v-list-item-content>
            </v-list-item>
          </v-list>
          <v-card-actions
            v-if="uploadList.length > 0"
          >
            <v-btn
              v-on:click="cleanUploadList"
              text
              block
              color="error"
            >Clean</v-btn>
          </v-card-actions>
        </v-card>
      </v-menu>
      <v-menu
        offset-y
      >
        <template v-slot:activator="{ attrs, on }">
          <v-btn
            text
            class="mr-2"
            style="padding: 0; min-width: 36px"
            v-bind="attrs"
            v-on="on"
          >
            <Gravatar v-bind:email="email" v-bind:title="`Logged in as ${username}`"></Gravatar>
          </v-btn>
        </template>
        <v-card>
          <v-list>
            <v-list-item>
              <v-list-item-avatar>
                <Gravatar v-bind:email="email" v-bind:title="`Logged in as ${username}`"></Gravatar>
              </v-list-item-avatar>
              <v-list-item-content>
                <v-list-item-title>{{ username }}</v-list-item-title>
                <v-list-item-subtitle>{{ email }}</v-list-item-subtitle>
              </v-list-item-content>
            </v-list-item>
            <v-divider></v-divider>
            <v-list-item
              dense
              v-on:click="appStore.logout()"
            >
              <v-list-item-icon>
                <v-icon>mdi-logout</v-icon>
              </v-list-item-icon>
              <v-list-item-title>Logout</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-card>
      </v-menu>
    </v-app-bar>

    <v-main v-if="appStore.serviceWorkerConfigured && appStore.serviceWorkerHasToken">
      <v-container fluid pa-0 style="height: 100%;">
        <router-view v-if="!(!appStore.hasToken && !routerView)" v-bind:key="$route.path" v-on:tokenExpired="tokenExpired" class="router-view" ref="routerViewEl"/>
      </v-container>
    </v-main>

    <v-app-bar
      app
      bottom
      dense
      color="white"
      elevation="0"
      v-if="$vuetify.breakpoint.xs"
    >
      <v-btn-toggle
        borderless
        color="primary"
        group
        tile
        class="flex-grow-1 d-flex pa-0"
      >
        <v-btn text to="/"         class="flex-grow-1"><v-icon>mdi-home-outline</v-icon>       </v-btn>
        <v-btn text to="/calendar" class="flex-grow-1"><v-icon>mdi-calendar-outline</v-icon>   </v-btn>
        <v-btn text to="/tasks"    class="flex-grow-1"><v-icon>mdi-ballot-outline</v-icon>     </v-btn>
        <v-btn text to="/find"     class="flex-grow-1"><v-icon>mdi-magnify</v-icon>    </v-btn>
        <v-btn text to="/config"   class="flex-grow-1"><v-icon>mdi-cog-outline</v-icon>        </v-btn>
        <v-btn text to="/about"    class="flex-grow-1"><v-icon>mdi-information-outline</v-icon></v-btn>
      </v-btn-toggle>
    </v-app-bar>

    <div v-if="!appStore.hasToken" class="login-overlay">
      <div class="form">
        <v-alert type="error" v-show="appStore.loginError">
          {{ appStore.loginError }}
        </v-alert>
        <v-icon x-large>mdi-lock</v-icon>
        <h2>Login</h2>
        <form>
          <v-text-field
            v-on:keydown.enter="appStore.login(loginUsername, loginPassword)"
            v-model="loginUsername"
            label="Username"
            name="username"
            autocomplete="username"
            type="text"
            autofocus
            outlined
          ></v-text-field>
          <v-text-field
            v-on:keydown.enter="appStore.login(loginUsername, loginPassword)"
            v-model="loginPassword"
            label="Password"
            name="password"
            autocomplete="current-password"
            type="password"
            outlined
          ></v-text-field>
          <v-btn
            v-bind:loading="appStore.isLoggingIn"
            v-on:click="appStore.login(loginUsername, loginPassword)"
            color="primary"
            block
            text
            outlined
          >Login</v-btn>
        </form>
      </div>
    </div>

    <v-overlay v-bind:value="appStore.isLoggingIn" z-index="20" opacity="0">
      <v-progress-circular indeterminate color="blue-grey lighten-3" size="64"></v-progress-circular>
    </v-overlay>
  </v-app>
</template>

<script lang="ts" setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick, defineProps, defineEmits, defineExpose } from 'vue';
import type { Ref } from 'vue';

import { useRouter, useRoute } from '@/composables/vue-router';
import { useVuetify } from '@/composables/vuetify';

import { useAppStore } from '@/stores/app';

import Gravatar from '@/components/Gravatar.vue';

import * as api from '@/api';
import { Claim, ListEntry2, UploadEntry } from '@/api';
import jwt_decode from 'jwt-decode';
import less from 'less';
import { v4 as uuidv4 } from 'uuid';

interface TreeNode {
  name: string;
  id: string;
  context: string[];
  children: TreeNode[];
}

// Composables
const router = useRouter();
const route = useRoute();
const vuetify = useVuetify();
const appStore = useAppStore();

// Reactive states
const loginUsername = ref("");
const loginPassword = ref("");
const templates = ref([] as string[]);
const uploadList = ref([] as UploadEntry[]);
const uploadMenuIsVisible = ref(false);
const noteTree = ref([] as TreeNode[]);
const noteTreeOpen = ref([]);
const noteTreeActive = ref([]);

// Refs
const app = ref(null);
const fileInputEl = ref(null);
const routerViewEl = ref(null);

// Computed properties
const decodedToken = computed(() => {
  if (appStore.token) {
    return jwt_decode<Claim>(appStore.token);
  }
  else {
    return null;
  }
});

const username = computed(() => {
  if (decodedToken.value) {
    return decodedToken.value.sub;
  }
  else {
    return null;
  }
});

const email = computed(() => {
  if (decodedToken.value) {
    return decodedToken.value.email;
  }
  else {
    return null;
  }
});

const uploadListBadgeColor = computed(() => {
  const [status, _] = uploadListStatus.value;

  if      (status === 'in-progress') { return 'blue';  }
  else if (status === 'error')       { return 'red';   }
  else if (status === 'success')     { return 'green'; }
  else {
    return 'gray';
  }
});

const uploadListBadgeIcon = computed(() => {
  const [status, num] = uploadListStatus.value;

  if      (status === 'in-progress') { return 'mdi-autorenew';         }
  else if (status === 'error')       { return 'mdi-exclamation-thick'; }
  else if (status === 'success')     { return 'mdi-check';             }
  else {
    return 'mdi-help';
  }
});

const uploadListStatus = computed(() => {
  let numInProgresses = 0;
  let numErrors = 0;
  let numSuccesses = 0;
  for (const e of uploadList.value) {
    if (e.status === 'in-progress') {
      numInProgresses += 1;
    }
    else if (e.status === 'error') {
      numErrors += 1;
    }
    else if (e.status === 'success') {
      numSuccesses += 1;
    }
  }

  if      (numInProgresses > 0)                      { return ['in-progress', numInProgresses]; }
  else if (numErrors > 0)                            { return ['error',       numErrors      ]; }
  else if (numSuccesses === uploadList.value.length) { return ['success',     numSuccesses   ]; }
  else {
    return ['unknown', -1];
  }
});

const noteTreeRoot = computed(() => {
  return [
    {
      name: 'Tags',
      id: '',
      context: [],
      children: noteTree.value,
    },
  ];
});

// Lifecycle hooks
onMounted(() => {
  loadCustomCss();

  (fileInputEl.value as HTMLInputElement).addEventListener('change', (e: any) => {
    if (e.target.files.length > 0) {
      // Start to upload the selected files
      uploadFiles(e.target.files);
      // Clear the selection
      e.target.value = '';
    }
  });

  // Function to determine if files are dragged or not
  function containsFiles(event: any) {
    if (event.dataTransfer.types) {
      for (const typ of event.dataTransfer.types) {
        if (typ == "Files") {
          return true;
        }
      }
    }

    return false;
  }

  loadTemplates();

  // Handle drag and drop of files
  // TODO v-onで書き直す
  // TODO 参考: https://qiita.com/punkshiraishi/items/49b91767b5143bcb1fcc
  // TODO 参考: https://learnvue.co/articles/vue-drag-and-drop
  // TODO 参考: https://hackmd.io/@rhHzPg4WS26yfiXdOaOMTg/ryyQFR-K8
  const appEl = app.value.$el;
  appEl.addEventListener('dragenter', (e: any) => {
    if (containsFiles(e)) {
      // Show the drop area
      appEl.classList.add('drop-target');
    }
  });

  appEl.addEventListener('dragleave', (e: any) => {
    // Ignore if it's still inside appEl
    if (!e.currentTarget.contains(e.relatedTarget)) {
      if (containsFiles(e)) {
        // Hide the drop area
        appEl.classList.remove('drop-target');
      }
    }
  });

  appEl.addEventListener('dragover', (e: any) => {
    e.preventDefault();
  });

  appEl.addEventListener('drop', (e: any) => {
    e.preventDefault();

    if (containsFiles(e)) {
      // Start to upload the dropped files
      uploadFiles(e.dataTransfer.files);

      // Hide the drop area
      appEl.classList.remove('drop-target');
    }
  });

  initNotification();
});

onUnmounted(() => {
  unloadCustomCss();
});

// Methods
function initNotification() {
  Notification.requestPermission().then((result) => {
    if (result === 'granted') {
      //
    }
  });
}

function tokenExpired(callback: () => void) {
  appStore.invalidateToken(callback);
}

function loadTemplates() {
  api.listNotes()
    .then(res => {
      templates.value = res.data
        .map((entry: ListEntry2) => entry.path)
        .filter((path: string) => path.match(/\.template$/i));
    }).catch(error => {
      if (error.response) {
        if (error.response.status === 401) {
          // Unauthorized
          tokenExpired(() => loadTemplates());
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

function loadCustomCss() {
  api.getNote('.mory/custom.less')
    .then(res => {
      less.render(res.data, {
        globalVars: {
          'nav-height': '64px',
        },
      }).then(output => {
        const style = document.createElement('style');
        style.setAttribute('type', 'text/css');
        style.setAttribute('id', 'custom-css');
        style.innerText = output.css;
        document.head.appendChild(style);
      }, error => {
        // FIXME
        console.log(error);
      });
    }).catch(error => {
      if (error.response) {
        if (error.response.status === 401) {
          // Unauthorized
          tokenExpired(() => loadCustomCss());
        }
        else if (error.response.status === 404) {
          // We can simply ignore the error
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

function unloadCustomCss() {
  for (const style of document.head.querySelectorAll('#custom-css')) {
    style.remove();
  }
}

function cleanUploadList() {
  uploadList.value = uploadList.value.filter(e => e.status === 'in-progress');
  uploadMenuIsVisible.value = false;
}

function uploadStatusColor(status: string) {
  if      (status === 'in-progress') { return 'blue';  }
  else if (status === 'error')       { return 'red';   }
  else if (status === 'success')     { return 'green'; }
  else {
    return 'gray';
  }
}

function uploadStatusIcon(status: string) {
  if      (status === 'in-progress') { return 'mdi-autorenew';         }
  else if (status === 'error')       { return 'mdi-exclamation-thick'; }
  else if (status === 'success')     { return 'mdi-check';             }
  else {
    return 'mdi-help';
  }
}

function chooseFile() {
  (fileInputEl.value as HTMLInputElement).click();
  uploadMenuIsVisible.value = false;
}

function uploadFiles(files: File[]) {
  // Add the files to a FormData and uploadList
  const fd = new FormData();
  for (const file of files) {
    const uuid = uuidv4();

    fd.append(uuid, file);

    uploadList.value.push({
      uuid: uuid,
      filename: file.name,
      status: 'in-progress',
      statusMessage: 'Being uploaded...',
    });
  }

  // POST the FormData
  api.uploadFiles(fd).then(res => {
    for (const [uuid, result] of res.data) {
      const entry = uploadList.value.find(e => e.uuid === uuid);
      if (entry) {
        entry.status = result;
        entry.statusMessage = 'Successfully uploaded';
      }
    }
  }).catch(error => {
    for (const uuid of fd.keys()) {
      const entry = uploadList.value.find(e => e.uuid === uuid);
      if (entry) {
        entry.status = 'error';
        entry.statusMessage = error.message;
      }
    }
  });
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text);
}

async function populateTagChildren(item: TreeNode) {
  const entries = await api.listNotes().then(res => res.data);
  console.log(entries);

  const tags: Map<string, number> = new Map();
  for (const entry of entries) {
    if ('metadata' in entry && entry.metadata !== null) {
      if ('tags' in entry.metadata && entry.metadata.tags !== null) {
        if (item.context.every((t) => entry.metadata.tags.includes(t))) {
          for (const tag of entry.metadata.tags) {
            tags.set(tag, (tags.get(tag) || 0) + 1);
          }
        }
      }
    }
  }
  for (const tag of item.context) {
    tags.delete(tag);
  }
  for (const tag of [...tags.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0])) {
    const context = item.context.concat([tag]);
    item.children.push({
      name: tag,
      id: context.join('/'),
      context: context,
      children: [],
    });
  }
}

// Expose properties
defineExpose({
  initNotification,
  tokenExpired,
  loadTemplates,
  loadCustomCss,
  unloadCustomCss,
  cleanUploadList,
  uploadStatusColor,
  uploadStatusIcon,
  chooseFile,
  uploadFiles,
  copyToClipboard,
  populateTagChildren,
});
</script>

<style scoped lang="scss">
#app {
  user-select: none;
  overflow: hidden;

  &.drop-target {
    &::after {
      content: '';
      display: block;
      pointer-events: none;

      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 5;

      outline: 4px solid hsl(212, 100%, 50%);
      outline-offset: -4px;
      background-color: hsla(212, 100%, 50%, 0.33);
    }
  }
}

#nav {
  a {
    text-decoration: none;
  }
}

.logo {
  display: inline-block;
  width: 48px;
  height: 48px;
  background-size: contain;
  background-position: center;
  background-repeat: no-repeat;
  background-image: url("assets/logo.svg");
}

.login-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 500;

  backdrop-filter: blur(16px);

  text-align: center;
  display: flex;
  flex-direction: column;

  &::before,
  &::after {
    content: '';
    flex: 1 1 0;
  }

  .form {
    width: calc(100% - 20px);
    max-width: 400px;
    margin: 0 auto;
    padding: 2em;

    display: flex;
    flex-direction: column;

    & > * {
      margin-top: 1em;
    }

    .field label {
      color: #000;
      text-shadow: 0 0 2px rgba(255, 255, 255, 0.5);
    }

    .field {
      text-align: left;
      display: flex;
      flex-direction: column;
      width: 20em;

      label {
        font-weight: bold;
      }
    }

    button {
      padding: 0.5em 1em;
    }
  }
}
</style>
