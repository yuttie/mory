<template>
  <div id="app">
    <div id="nav">
      <router-link to="/">Home</router-link> |
      <router-link to="/about">About</router-link>
    </div>
    <router-view class="router-view"/>
  </div>
</template>

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

#app {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

#nav {
  padding: 30px;

  a {
    font-weight: bold;
    color: #2c3e50;

    &.router-link-exact-active {
      color: #42b983;
    }
  }
}

.router-view {
  flex: 1 1 0;
  overflow: auto;
  position: relative;
}
</style>
