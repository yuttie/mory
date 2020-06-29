<template>
  <div id="app">
    <div id="nav">
      <div class="left logo">mory</div>
      <div class="middle">
        <router-link to="/">Home</router-link> |
        <router-link to="/create">Create</router-link> |
        <router-link to="/find">Find</router-link> |
        <router-link to="/about">About</router-link>
      </div>
      <div class="right"></div>
    </div>
    <router-view v-bind:key="$route.path" class="router-view"/>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Watch, Vue } from 'vue-property-decorator';

@Component
export default class App extends Vue {
  @Watch('$route')
  on$routeChanged(to: any) {
    console.log(to);
    if (to.name === "Home") {
      document.title = `Home - ${process.env.VUE_APP_NAME}`;
    }
    else if (to.name === "Find") {
      document.title = `Find - ${process.env.VUE_APP_NAME}`;
    }
    else if (to.name === "View") {
      document.title = `${to.params.path} - ${process.env.VUE_APP_NAME}`;
    }
    else if (to.name === "About") {
      document.title = `About - ${process.env.VUE_APP_NAME}`;
    }
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

html, body {
  width: 100%;
  height: 100%;
}
</style>

<style scoped lang="scss">
#app {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

#nav {
  display: flex;
  align-items: center;
  padding: 0.5em 1em;

  & > * {
    flex: 1 1 0;
  }

  .middle {
    text-align: center;
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
  flex: 1 1 0;
  overflow: hidden;
  position: relative;
}

.logo {
  display: flex;
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
</style>
