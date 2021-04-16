import Vue from 'vue'
import VueRouter, { RouteConfig } from 'vue-router'

import { v4 as uuidv4 } from 'uuid';

Vue.use(VueRouter)

const routes: Array<RouteConfig> = [
  {
    path: '/',
    name: 'Home',
    component: () => import(/* webpackChunkName: "Home" */ '../views/Home.vue'),
  },
  {
    path: '/calendar',
    name: 'Calendar',
    component: () => import(/* webpackChunkName: "Calendar" */ '../views/Calendar.vue'),
  },
  {
    path: '/calendar/:type/:date*',
    name: 'CalendarWithDate',
    component: () => import(/* webpackChunkName: "Calendar" */ '../views/Calendar.vue'),
  },
  {
    path: '/tasks',
    name: 'Tasks',
    component: () => import(/* webpackChunkName: "Tasks" */ '../views/Tasks.vue'),
  },
  {
    path: '/create',
    name: 'Create',
    redirect: to => {
      return {
        name: 'Note',
        params: { path: uuidv4() + '.md' },
        query: { mode: 'create', template: to.query.from },
      };
    },
  },
  {
    path: '/find',
    name: 'Find',
    component: () => import(/* webpackChunkName: "Find" */ '../views/Find.vue'),
  },
  {
    path: '/note/:path*',
    name: 'Note',
    component: () => import(/* webpackChunkName: "Note" */ '../views/Note.vue'),
  },
  {
    path: '/config',
    name: 'Config',
    component: () => import(/* webpackChunkName: "Config" */ '../views/Config.vue'),
  },
  {
    path: '/about',
    name: 'About',
    // route level code-splitting
    // this generates a separate chunk (about.[hash].js) for this route
    // which is lazy-loaded when the route is visited.
    component: () => import(/* webpackChunkName: "About" */ '../views/About.vue')
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
