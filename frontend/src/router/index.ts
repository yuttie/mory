import Vue from 'vue';
import VueRouter from 'vue-router';
import type { RouteConfig } from 'vue-router';

const Home      = () => import('../views/Home.vue');
const Calendar  = () => import('../views/Calendar.vue');
const Tasks     = () => import('../views/Tasks.vue');
const TasksNext = () => import('../views/TasksNext.vue');
const Files     = () => import('../views/Files.vue');
const Search    = () => import('../views/Search.vue');
const Note      = () => import('../views/Note.vue');
const Media     = () => import('../views/Media.vue');
const Config    = () => import('../views/Config.vue');
const About     = () => import('../views/About.vue');


Vue.use(VueRouter);

const routes: Array<RouteConfig> = [
    {
        path: '/',
        name: 'Home',
        component: Home,
    },
    {
        path: '/calendar',
        name: 'Calendar',
        redirect: (to) => {
            const today = new Date();
            const yyyy = today.getFullYear().toString();
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const dd = String(today.getDate()).padStart(2, '0');

            return {
                name: 'CalendarWithDate',
                params: { type: 'month', year: yyyy, month: mm, day: dd },
            };
        },
    },
    {
        path: '/calendar/:type/:year/:month/:day',
        name: 'CalendarWithDate',
        component: Calendar,
    },
    {
        path: '/tasks',
        name: 'Tasks',
        component: Tasks,
    },
    {
        path: '/tasks-next',
        name: 'TasksNext',
        redirect: to => {
            return {
                name: 'TasksNextWithParams',
                params: { selectedNodeId: '_', tab: 'descendants', viewMode: 'status' },
            };
        },
    },
    {
        path: '/tasks-next/:selectedNodeId/:tab/:viewMode',
        name: 'TasksNextWithParams',
        component: TasksNext,
    },
    {
        path: '/create',
        name: 'Create',
        redirect: to => {
            return {
                name: 'Note',
                params: { path: crypto.randomUUID() + '.md' },
                query: { mode: 'create', template: to.query.from },
            };
        },
    },
    {
        path: '/files',
        name: 'Files',
        component: Files,
    },
    {
        path: '/search',
        name: 'Search',
        component: Search,
    },
    {
        path: '/note/:path*',
        name: 'Note',
        component: Note,
    },
    {
        path: '/media/:path*',
        name: 'Media',
        component: Media,
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
    },
];

const router = new VueRouter({
    mode: 'history',
    base: import.meta.env.BASE_URL,
    routes,
    scrollBehavior(to, _from, savedPosition) {
        if (to.hash) {
            return { selector: decodeURIComponent(to.hash) };
        }
        else if (savedPosition) {
            return savedPosition;
        } else {
            return { x: 0, y: 0 };
        }
    },
});

export default router;
