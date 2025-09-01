import Vue from 'vue';
import App from './App.vue';
import router from './router';
import { createPinia, PiniaVuePlugin } from 'pinia';
import vuetify from './plugins/vuetify';
import { i18n } from './plugins/i18n';

Vue.use(PiniaVuePlugin);
const pinia = createPinia();

Vue.config.productionTip = false;

new Vue({
  router,
  pinia,
  vuetify,
  i18n,
  render: h => h(App)
}).$mount('#app');
