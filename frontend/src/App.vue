<template>
  <v-app id="app">
    <v-app-bar app id="nav" color="white" elevate-on-scroll fixed>
      <v-toolbar-title>
        <router-link to="/">
          <div class="logo">mory</div>
        </router-link>
      </v-toolbar-title>
      <v-spacer></v-spacer>
      <v-btn icon to="/"><v-icon>mdi-home</v-icon></v-btn>
      <v-btn icon to="/create"><v-icon>mdi-plus-box</v-icon></v-btn>
      <v-btn icon to="/find"><v-icon>mdi-view-list</v-icon></v-btn>
      <v-btn icon to="/about"><v-icon>mdi-information</v-icon></v-btn>
      <v-spacer></v-spacer>
      <v-menu offset-y>
        <template v-slot:activator="{ attrs, on }">
          <v-btn
            icon
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
              v-on:click="tokenExpired()"
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
    <v-main>
      <router-view v-if="!(!token && !$refs.routerView)" v-bind:key="$route.path" v-bind:token="token" v-on:tokenExpired="tokenExpired" class="router-view" ref="routerView"/>
    </v-main>
    <div v-if="!token" class="login-overlay">
      <div class="form">
        <h1>Login</h1>
        <v-text-field
          v-on:keydown.enter="login"
          v-model="loginUsername"
          label="Username"
          name="username"
          autocomplete="username"
          type="text"
          autofocus
        ></v-text-field>
        <v-text-field
          v-on:keydown.enter="login"
          v-model="loginPassword"
          label="Password"
          name="password"
          autocomplete="current-password"
          type="password"
        ></v-text-field>
        <v-btn v-on:click="login">Login</v-btn>
      </div>
    </div>
    <v-overlay v-bind:value="isLoggingIn" z-index="20">
      <v-progress-circular indeterminate size="64"></v-progress-circular>
    </v-overlay>
  </v-app>
</template>

<script lang="ts">
import { Component, Vue } from 'vue-property-decorator';

import Gravatar from '@/components/Gravatar.vue';

import axios from '@/axios';
import jwtDecode from 'jwt-decode';

interface Claim {
    sub: string;
    exp: number;
    email: string;
}

@Component({
  components: {
    Gravatar,
  },
})
export default class App extends Vue {
  token = localStorage.getItem('token') as null | string;
  loginUsername = "";
  loginPassword = "";
  isLoggingIn = false;
  loginCallback = null as (() => void) | null;
  registration = null as null | ServiceWorkerRegistration;

  get decodedToken() {
    if (this.token) {
      return jwtDecode<Claim>(this.token);
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

  created() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register(`${process.env.VUE_APP_APPLICATION_ROOT}files-proxy.js`, {
          scope: process.env.VUE_APP_APPLICATION_ROOT,
        })
        .then(registration => {
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
        })
        .catch(err => {
          console.log('ServiceWorker registration failed: ', err);
        });
    }
  }

  login() {
    this.isLoggingIn = true;

    axios.post(`/login`, {
      user: this.loginUsername,
      password: this.loginPassword,
    }).then(res => {
      this.token = res.data;
      localStorage.setItem('token', res.data);

      this.loginUsername = '';
      this.loginPassword = '';
      this.isLoggingIn = false;

      this.$nextTick(() => {
        if (this.loginCallback) {
          this.loginCallback();
        }
        this.loginCallback = null;
      });

      if (this.registration) {
        this.registration.active!.postMessage({
          type: 'api-token',
          value: this.token,
        });
      }
    });
  }

  tokenExpired(callback: () => void) {
    this.token = null;
    localStorage.removeItem('token');
    this.loginCallback = callback;

    if (this.registration) {
      this.registration.active!.postMessage({
        type: 'api-token',
        value: this.token,
      });
    }
  }
}
</script>

<style scoped lang="scss">
#nav {
  a {
    text-decoration: none;
  }
}

.logo {
  display: inline-flex;
  align-items: center;
  vertical-align: bottom;
  color: #333;
  font-family: 'Source Code Pro', monospace;
  font-size: 1.3em;
  font-weight: normal;
  letter-spacing: 0.4em;
  transition: transform 200ms ease;
  user-select: none;

  &::before {
    display: inline-block;
    content: '';
    width: 2.0em;
    height: 1.5em;
    background-size: contain;
    background-position: left center;
    background-repeat: no-repeat;
    background-image: url("assets/logo.png");
    border-right: 1px solid #cccccc;
    vertical-align: bottom;
    margin-right: 0.5em;
  }
}

.login-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 10;

  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(8px);

  text-align: center;
  display: flex;
  flex-direction: column;

  &::before,
  &::after {
    content: '';
    flex: 1 1 0;
  }

  .form {
    max-width: 60em;
    margin: 0 auto;

    display: flex;
    flex-direction: column;

    & > * {
      margin-top: 1em;
    }

    h1,
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
