import Vue from 'vue'
import VueRouter, { RouteConfig } from 'vue-router'
import Home from '../views/Home.vue'
import Find from '../views/Find.vue'
import View from '../views/View.vue'

import { v4 as uuidv4 } from 'uuid';

Vue.use(VueRouter)

const routes: Array<RouteConfig> = [
  {
    path: '/',
    name: 'Home',
    component: Home
  },
  {
    path: '/create',
    name: 'Create',
    redirect: to => {
      return {
        name: 'View',
        params: { path: uuidv4() },
        query: { mode: 'create' },
      };
    },
  },
  {
    path: '/find',
    name: 'Find',
    component: Find,
  },
  {
    path: '/view/:path*',
    name: 'View',
    component: View,
  },
  {
    path: '/about',
    name: 'About',
    // route level code-splitting
    // this generates a separate chunk (about.[hash].js) for this route
    // which is lazy-loaded when the route is visited.
    component: () => import(/* webpackChunkName: "about" */ '../views/About.vue')
  }
]

const router = new VueRouter({
  mode: 'history',
  base: process.env.BASE_URL,
  routes,
  scrollBehavior(to, from, savedPosition) {
    if (to.hash) {
      return { selector: decodeURIComponent(to.hash) };
    }
    else if (savedPosition) {
      return savedPosition;
    } else {
      return { x: 0, y: 0 };
    }
  }
})

export default router
