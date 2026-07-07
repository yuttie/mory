import Vue from 'vue';
import App from './App.vue';
import router from './router';
import { createPinia, PiniaVuePlugin } from 'pinia';
import vuetify from './plugins/vuetify';
import { faviconService } from './services/faviconService';

Vue.use(PiniaVuePlugin);
const pinia = createPinia();

Vue.config.productionTip = false;

// Initialize favicon based on initial route
router.onReady(() => {
  const currentRoute = router.currentRoute;
  if (currentRoute.name) {
    faviconService.updateFavicon(currentRoute.name);
  }
});

new Vue({
  router,
  pinia,
  vuetify,
  render: h => h(App)
}).$mount('#app');
