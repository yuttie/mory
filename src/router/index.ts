import Vue from 'vue'
import VueRouter, { RouteConfig } from 'vue-router'

const Home     = () => import('../views/Home.vue');
const Calendar = () => import('../views/Calendar.vue');
const Tasks    = () => import('../views/Tasks.vue');
const Find     = () => import('../views/Find.vue');
const Note     = () => import('../views/Note.vue');
const Config   = () => import('../views/Config.vue');
const About    = () => import('../views/About.vue');


import { v4 as uuidv4 } from 'uuid';

Vue.use(VueRouter)

const routes: Array<RouteConfig> = [
  {
    path: '/',
    name: 'Home',
    component: Home,
  },
  {
    path: '/calendar',
    name: 'Calendar',
    component: Calendar,
  },
  {
    path: '/calendar/:type/:date*',
    name: 'CalendarWithDate',
    component: Calendar,
  },
  {
    path: '/tasks',
    name: 'Tasks',
    component: Tasks,
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
    component: Find,
  },
  {
    path: '/note/:path*',
    name: 'Note',
    component: Note,
  },
  {
    path: '/config',
    name: 'Config',
    component: Config,
  },
  {
    path: '/about',
    name: 'About',
    // route level code-splitting
    // this generates a separate chunk (about.[hash].js) for this route
    // which is lazy-loaded when the route is visited.
    component: About,
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
