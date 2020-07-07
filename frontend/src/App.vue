<template>
  <div id="app">
    <div id="nav">
      <div class="left">
        <router-link to="/">
          <div class="logo">mory</div>
        </router-link>
      </div>
      <div class="middle">
        <router-link to="/create">Create</router-link> |
        <router-link to="/find">Find</router-link> |
        <router-link to="/about">About</router-link>
      </div>
      <div class="right">
        <Gravatar v-bind:email="email" v-bind:title="`Logged in as ${username}`"></Gravatar>
      </div>
    </div>
    <router-view v-if="!(!token && !$refs.routerView)" v-bind:key="$route.path" v-bind:token="token" v-on:tokenExpired="tokenExpired" class="router-view" ref="routerView"/>
    <div v-if="!token" class="login-overlay">
      <div class="form">
        <h1>Login</h1>
        <div class="field">
          <label for="username">Username</label>
          <input v-on:keypress.enter="login" id="username" type="text" ref="username" autofocus>
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input v-on:keypress.enter="login" id="password" type="password" ref="password">
        </div>
        <button v-on:click="login">Login</button>
      </div>
    </div>
  </div>
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

  login() {
    axios.post(`/login`, {
      user: (this.$refs.username as HTMLInputElement).value,
      password: (this.$refs.password as HTMLInputElement).value,
    }).then(res => {
      this.token = res.data;
      localStorage.setItem('token', res.data);
    });
  }

  tokenExpired() {
    this.token = null;
    localStorage.removeItem('token');
  }
}
</script>

<style lang="scss">
* {
  box-sizing: border-box;
}

html, body {
  padding: 0;
  margin: 0;
}

html {
  font-family: sans-serif;
}
</style>

<style scoped lang="scss">
$nav-height: 50px;

#app {
  display: flex;
  flex-direction: column;
}

#nav {
  display: flex;
  align-items: center;

  position: fixed;
  width: 100%;
  height: $nav-height;
  padding: 0.5em 1em;
  background: #fff;
  z-index: 100;

  & > * {
    flex: 1 1 0;
  }

  .left {
    text-align: left;

    a {
      text-decoration: none;
    }
  }

  .middle {
    text-align: center;
  }

  .right {
    text-align: right;
  }

  a {
    font-weight: bold;
    color: #456487;

    &.router-link-exact-active {
      color: #5e83ae;
    }
  }
}

.router-view {
  margin-top: $nav-height;
  flex: 1 1 0;
  position: relative;
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
  z-index: 100;

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
