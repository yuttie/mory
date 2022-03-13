<template>
  <v-app id="app" ref="app">
    <v-navigation-drawer
      app
      permanent
      mini-variant
      width="56"
    >
      <v-list-item class="px-2">
        <v-list-item-avatar>
          <v-img contain v-bind:src="require('@/assets/logo.svg')"></v-img>
        </v-list-item-avatar>
        <v-list-item-title>Mory</v-list-item-title>
      </v-list-item>
      <v-divider></v-divider>
      <v-list-item link to="/"><v-list-item-icon><v-icon>mdi-home-outline</v-icon></v-list-item-icon><v-list-item-title>Home</v-list-item-title></v-list-item>
      <v-list-item link to="/calendar"><v-list-item-icon><v-icon>mdi-calendar-outline</v-icon></v-list-item-icon><v-list-item-title>Calendar</v-list-item-title></v-list-item>
      <v-list-item link to="/tasks"><v-list-item-icon><v-icon>mdi-ballot-outline</v-icon></v-list-item-icon><v-list-item-title>Tasks</v-list-item-title></v-list-item>
      <v-list-item link to="/find"><v-list-item-icon><v-icon>mdi-magnify</v-icon></v-list-item-icon><v-list-item-title>Find</v-list-item-title></v-list-item>
      <v-list-item link to="/config"><v-list-item-icon><v-icon>mdi-cog-outline</v-icon></v-list-item-icon><v-list-item-title>Config</v-list-item-title></v-list-item>
      <v-list-item link to="/about"><v-list-item-icon><v-icon>mdi-information-outline</v-icon></v-list-item-icon><v-list-item-title>About</v-list-item-title></v-list-item>
      <v-divider></v-divider>
      <input type="file" multiple class="d-none" ref="fileInput">
      <v-menu
        offset-x
      >
        <template v-slot:activator="{ on, attrs }">
          <v-list-item
            v-bind="attrs"
            v-on="on"
          >
            <v-list-item-icon>
              <v-icon>mdi-plus-box-outline</v-icon>
            </v-list-item-icon>
            <v-list-item-title>
              Add note
            </v-list-item-title>
          </v-list-item>
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
        offset-x
      >
        <template v-slot:activator="{ attrs, on }">
          <v-list-item
            v-bind="attrs"
            v-on="on"
          >
            <v-list-item-icon>
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
            </v-list-item-icon>
            <v-list-item-title>
              Upload file
            </v-list-item-title>
          </v-list-item>
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
        offset-x
      >
        <template v-slot:activator="{ attrs, on }">
          <v-list-item
            v-bind="attrs"
            v-on="on"
          >
            <Gravatar v-bind:email="email" v-bind:title="`Logged in as ${username}`"></Gravatar>
          </v-list-item>
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
              v-on:click="logout"
            >
              <v-list-item-icon>
                <v-icon>mdi-logout</v-icon>
              </v-list-item-icon>
              <v-list-item-title>Logout</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-card>
      </v-menu>
    </v-navigation-drawer>
    <v-main>
      <v-container fluid pa-0>
        <router-view v-if="!(!hasToken && !$refs.routerView)" v-bind:key="$route.path" v-on:tokenExpired="tokenExpired" class="router-view" ref="routerView"/>
      </v-container>
    </v-main>
    <v-app-bar
      app
      bottom
      color="white"
      elevation="0"
      v-if="$vuetify.breakpoint.xs"
    >
      <v-btn-toggle
        borderless
        color="primary"
        group
        tile
        class="flex-grow-1 d-flex"
      >
        <v-btn text to="/"         class="flex-grow-1"><v-icon>mdi-home-outline</v-icon>       </v-btn>
        <v-btn text to="/calendar" class="flex-grow-1"><v-icon>mdi-calendar-outline</v-icon>   </v-btn>
        <v-btn text to="/tasks"    class="flex-grow-1"><v-icon>mdi-ballot-outline</v-icon>     </v-btn>
        <v-btn text to="/find"     class="flex-grow-1"><v-icon>mdi-magnify</v-icon>    </v-btn>
        <v-btn text to="/config"   class="flex-grow-1"><v-icon>mdi-cog-outline</v-icon>        </v-btn>
        <v-btn text to="/about"    class="flex-grow-1"><v-icon>mdi-information-outline</v-icon></v-btn>
      </v-btn-toggle>
    </v-app-bar>
    <div v-if="!hasToken" class="login-overlay">
      <div class="form">
        <v-alert type="error" v-show="loginError">
          {{ loginError }}
        </v-alert>
        <v-icon x-large>mdi-lock</v-icon>
        <h2>Login</h2>
        <form>
          <v-text-field
            v-on:keydown.enter="login"
            v-model="loginUsername"
            label="Username"
            name="username"
            autocomplete="username"
            type="text"
            autofocus
            outlined
          ></v-text-field>
          <v-text-field
            v-on:keydown.enter="login"
            v-model="loginPassword"
            label="Password"
            name="password"
            autocomplete="current-password"
            type="password"
            outlined
          ></v-text-field>
          <v-btn
            v-bind:loading="isLoggingIn"
            v-on:click="login"
            color="primary"
            block
            text
            outlined
          >Login</v-btn>
        </form>
      </div>
    </div>
    <v-overlay v-bind:value="isLoggingIn" z-index="20" opacity="0">
      <v-progress-circular indeterminate color="blue-grey lighten-3" size="64"></v-progress-circular>
    </v-overlay>
  </v-app>
</template>

<script lang="ts">
import { Component, Watch, Vue } from 'vue-property-decorator';

import Gravatar from '@/components/Gravatar.vue';

import * as api from '@/api';
import { Claim, ListEntry2, UploadEntry } from '@/api';
import jwt_decode from 'jwt-decode';
import less from 'less';
import { register } from 'register-service-worker';
import { v4 as uuidv4 } from 'uuid';

@Component({
  components: {
    Gravatar,
  },
})
export default class App extends Vue {
  hasToken = !!localStorage.getItem('token');
  loginUsername = "";
  loginPassword = "";
  isLoggingIn = false;
  loginCallbacks = [] as (() => void)[];
  loginError = null as null | string;
  registration = null as null | ServiceWorkerRegistration;
  templates = [] as string[];
  uploadList = [] as UploadEntry[];
  uploadMenuIsVisible = false;

  get token() {
    return localStorage.getItem('token');
  }

  get decodedToken() {
    if (this.token) {
      return jwt_decode<Claim>(this.token);
    }
    else {
      return null;
    }
  }

  get username() {
    if (this.decodedToken) {
      return this.decodedToken.sub;
    }
    else {
      return null;
    }
  }

  get email() {
    if (this.decodedToken) {
      return this.decodedToken.email;
    }
    else {
      return null;
    }
  }

  get uploadListBadgeColor() {
    const [status, _] = this.uploadListStatus;

    if      (status === 'in-progress') { return 'blue';  }
    else if (status === 'error')       { return 'red';   }
    else if (status === 'success')     { return 'green'; }
    else {
      return 'gray';
    }
  }

  get uploadListBadgeIcon() {
    const [status, num] = this.uploadListStatus;

    if      (status === 'in-progress') { return 'mdi-autorenew';         }
    else if (status === 'error')       { return 'mdi-exclamation-thick'; }
    else if (status === 'success')     { return 'mdi-check';             }
    else {
      return 'mdi-help';
    }
  }

  get uploadListStatus() {
    let numInProgresses = 0;
    let numErrors = 0;
    let numSuccesses = 0;
    for (const e of this.uploadList) {
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

    if      (numInProgresses > 0)                     { return ['in-progress', numInProgresses]; }
    else if (numErrors > 0)                           { return ['error',       numErrors      ]; }
    else if (numSuccesses === this.uploadList.length) { return ['success',     numSuccesses   ]; }
    else {
      return ['unknown', -1];
    }
  }

  created() {
    register(`${process.env.BASE_URL}service-worker.js`, {
      registrationOptions: {
        scope: process.env.BASE_URL,
      },
      ready: (registration) => {
        console.log('ServiceWorker registration successful with scope: ', registration.scope);
        this.registration = registration;
        this.registration.active!.postMessage({
          type: 'api-url',
          value: new URL(process.env.VUE_APP_API_URL!, window.location.href).href,
        });
        this.registration.active!.postMessage({
          type: 'api-token',
          value: this.token,
        });
      },
      registered: (registration) => {
        console.log('Service worker has been registered.');
      },
      cached: (registration) => {
        console.log('Content has been cached for offline use.');
      },
      updatefound: (registration) => {
        console.log('New content is downloading.');
      },
      updated: (registration) => {
        console.log('New content is available; please refresh.');
      },
      offline: () => {
        console.log('No internet connection found. App is running in offline mode.');
      },
      error: (error) => {
        console.error('Error during service worker registration:', error);
      }
    });
  }

  mounted() {
    this.loadCustomCss();

    (this.$refs.fileInput as HTMLInputElement).addEventListener('change', (e: any) => {
      if (e.target.files.length > 0) {
        // Start to upload the selected files
        this.uploadFiles(e.target.files);
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

    this.loadTemplates();

    // Handle drag and drop of files
    const appEl = (this.$refs.app as Vue).$el;

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
        this.uploadFiles(e.dataTransfer.files);

        // Hide the drop area
        appEl.classList.remove('drop-target');
      }
    });
  }

  destroyed() {
    this.unloadCustomCss();
  }

  login() {
    this.isLoggingIn = true;

    api.login(
      this.loginUsername,
      this.loginPassword,
    ).then(res => {
      localStorage.setItem('token', res.data);
      this.hasToken = true;

      this.loginUsername = '';
      this.loginPassword = '';
      this.isLoggingIn = false;
      this.loginError = null;

      this.$nextTick(() => {
        for (const callback of this.loginCallbacks) {
          callback();
        }
        this.loginCallbacks = [];
      });

      if (this.registration) {
        this.registration.active!.postMessage({
          type: 'api-token',
          value: this.token,
        });
      }
    }).catch(error => {
      this.loginError = "Incorrect username or password";

      this.loginPassword = '';
      this.isLoggingIn = false;
    });
  }

  logout() {
    // Delete the current token
    localStorage.removeItem('token');
    this.hasToken = false;
  }

  tokenExpired(callback: () => void) {
    this.loginCallbacks.push(callback);

    // Delete the token and let a user to login again
    this.logout();
    if (this.registration) {
      this.registration.active!.postMessage({
        type: 'api-token',
        value: this.token,
      });
    }
  }

  loadTemplates() {
    api.listNotes()
      .then(res => {
        this.templates = res.data
          .map((entry: ListEntry2) => entry.path)
          .filter((path: string) => path.match(/\.template$/i));
      }).catch(error => {
        if (error.response) {
          if (error.response.status === 401) {
            // Unauthorized
            this.tokenExpired(() => this.loadTemplates());
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

  loadCustomCss() {
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
        });
      }).catch(error => {
        if (error.response) {
          if (error.response.status === 401) {
            // Unauthorized
            this.tokenExpired(() => this.loadCustomCss());
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

  unloadCustomCss() {
    for (const style of document.head.querySelectorAll('#custom-css')) {
      style.remove();
    }
  }

  cleanUploadList() {
    this.uploadList = this.uploadList.filter(e => e.status === 'in-progress');
    this.uploadMenuIsVisible = false;
  }

  uploadStatusColor(status: string) {
    if      (status === 'in-progress') { return 'blue';  }
    else if (status === 'error')       { return 'red';   }
    else if (status === 'success')     { return 'green'; }
    else {
      return 'gray';
    }
  }

  uploadStatusIcon(status: string) {
    if      (status === 'in-progress') { return 'mdi-autorenew';         }
    else if (status === 'error')       { return 'mdi-exclamation-thick'; }
    else if (status === 'success')     { return 'mdi-check';             }
    else {
      return 'mdi-help';
    }
  }

  chooseFile() {
    (this.$refs.fileInput as HTMLInputElement).click();
    this.uploadMenuIsVisible = false;
  }

  uploadFiles(files: File[]) {
    // Add the files to a FormData and uploadList
    const fd = new FormData();
    for (const file of files) {
      const uuid = uuidv4();

      fd.append(uuid, file);

      this.uploadList.push({
        uuid: uuid,
        filename: file.name,
        status: 'in-progress',
        statusMessage: 'Being uploaded...',
      });
    }

    // POST the FormData
    api.uploadFiles(fd).then(res => {
      for (const [uuid, result] of res.data) {
        const entry = this.uploadList.find(e => e.uuid === uuid);
        if (entry) {
          entry.status = result;
          entry.statusMessage = 'Successfully uploaded';
        }
      }
    }).catch(error => {
      for (const uuid of fd.keys()) {
        const entry = this.uploadList.find(e => e.uuid === uuid);
        if (entry) {
          entry.status = 'error';
          entry.statusMessage = error.message;
        }
      }
    });
  }

  copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
  }
}
</script>

<style scoped lang="scss">
#app {
  user-select: none;

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
