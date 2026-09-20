<template>
    <v-app id="app" ref="app">
        <v-main v-if="appStore.serviceWorkerConfigured && appStore.serviceWorkerHasToken">
            <v-container fluid class="pa-0" style="height: 100%;">
                <router-view v-slot="{ Component }">
                    <component
                        v-bind:is="Component"
                        v-if="!(!appStore.hasToken && !routerViewEl)"
                        v-on:tokenExpired="tokenExpired"
                        class="router-view"
                        ref="routerViewEl"
                    />
                </router-view>
            </v-container>
        </v-main>

        <template v-if="isDev">
            <v-alert
                v-for="error of errors"
                v-bind:key="error.id"
                type="error"
                closable
                style="z-index: 100; margin-bottom: 2px;"
            >{{ error.message }}</v-alert>
        </template>
        <!-- Navigation drawer from `md` up, where the screen has room to give it a column of
             its own. Below that it would take a quarter of the width from the view, so the one
             below stands in and slides over the view instead. -->
        <v-navigation-drawer
            v-if="$vuetify.display.mdAndUp"
            v-bind:rail="miniMainSidebar"
            permanent
        >
            <div class="d-flex flex-column h-100">
                <v-list nav class="flex-grow-0 flex-shrink-0">
                    <!-- The rail is too narrow for a control beside the logo, so the logo becomes
                         one: hovering it swaps the nav icon in, and the open drawer carries the
                         button that collapses it again at its right. -->
                    <v-list-item
                        title="mory"
                        v-bind:link="miniMainSidebar"
                        v-bind:class="{ 'drawer-header--rail': miniMainSidebar }"
                        v-bind:aria-label="miniMainSidebar ? 'Open the navigation drawer' : undefined"
                        v-on:click="miniMainSidebar = false"
                    >
                        <template v-slot:prepend>
                            <div class="logo-swap mr-2">
                                <v-img
                                    src="/img/logo.svg"
                                    aspect-ratio="1"
                                    max-width="24"
                                    max-height="24"
                                    width="24"
                                    class="logo-swap__logo"
                                ></v-img>
                                <v-icon class="logo-swap__icon">{{ mdiForwardburger }}</v-icon>
                            </div>
                        </template>
                        <template v-slot:append>
                            <!-- The click would otherwise bubble to the row above, whose own
                                 handler opens the drawer it has just collapsed. -->
                            <v-icon-btn
                                v-if="!miniMainSidebar"
                                v-bind:icon="mdiBackburger"
                                variant="text"
                                title="Collapse the navigation drawer"
                                v-on:click.stop="miniMainSidebar = true"
                            ></v-icon-btn>
                        </template>
                    </v-list-item>
                </v-list>

                <v-divider></v-divider>

                <v-list
                    nav
                    class="flex-grow-0 flex-shrink-0"
                >
                    <v-list-item
                        variant="text"
                        title="Enable notification"
                        base-color="error"
                        style="min-width: 36px"
                        v-if="needRequestForNotificationPermission"
                        v-bind:prepend-icon="mdiBell"
                        v-on:click="requestNotificationPermission"
                    ></v-list-item>
                    <IndexingStopsItem
                        v-if="indexingStops.length > 0"
                        v-bind:stops="indexingStops"
                    />
                    <v-menu location="right">
                        <template v-slot:activator="{ props }">
                            <v-list-item
                                variant="text"
                                title="Add note"
                                style="min-width: 36px"
                                v-bind="props"
                                v-bind:prepend-icon="mdiPlus"
                            ></v-list-item>
                        </template>
                        <v-list>
                            <v-list-subheader>Create</v-list-subheader>
                            <v-list-item to="/create" v-bind:prepend-icon="mdiFileOutline" title="New note"></v-list-item>
                            <v-list-item
                                v-if="$route.name === 'Note'"
                                v-bind:to="{ name: 'Create', query: { from: Array.isArray($route.params.path) ? $route.params.path.join('/') : $route.params.path } }"
                                v-bind:prepend-icon="mdiFileMultipleOutline"
                                title="Copy of this note"
                            ></v-list-item>
                            <v-list-subheader>Templates</v-list-subheader>
                            <v-list-item
                                v-for="path in templates"
                                v-bind:key="path"
                                v-bind:to="{ name: 'Create', query: { from: path } }"
                                v-bind:prepend-icon="mdiFileDocumentOutline"
                                v-bind:title="path.replace(/\.template$/i, '')"
                            >
                                <template v-slot:append>
                                    <!-- v-icon-btn has no `to`. The click still bubbles to the list item, whose own link
                                         would create a note from the template instead; the router skips a click whose
                                         default is already prevented. -->
                                    <v-tooltip location="top">
                                        <template v-slot:activator="{ props }">
                                            <v-icon-btn
                                                v-bind:icon="mdiPencil"
                                                size="small"
                                                icon-size="small"
                                                variant="text"
                                                v-bind="props"
                                                v-on:click.prevent="$router.push({ name: 'Note', params: { path: path.split('/') } })"
                                            ></v-icon-btn>
                                        </template>
                                        <span>Edit template</span>
                                    </v-tooltip>
                                </template>
                            </v-list-item>
                        </v-list>
                    </v-menu>
                    <v-menu
                        v-bind:close-on-content-click="false"
                        v-model="uploadMenuIsVisible"
                        location="right"
                    >
                        <template v-slot:activator="{ props }">
                            <v-list-item
                                variant="text"
                                title="Upload file"
                                style="min-width: 36px"
                                v-bind="props"
                            >
                                <template v-slot:prepend>
                                    <v-badge
                                        v-bind:color="uploadListBadgeColor"
                                        v-bind:model-value="uploadList.length > 0"
                                    >
                                        <template v-slot:badge>
                                            <v-icon>{{ uploadListBadgeIcon }}</v-icon>
                                        </template>
                                        <v-icon>{{ mdiCloudUploadOutline }}</v-icon>
                                    </v-badge>
                                </template>
                            </v-list-item>
                        </template>
                        <v-card>
                            <v-list>
                                <v-list-item
                                    v-bind:prepend-icon="mdiUpload"
                                    title="Upload"
                                    v-on:click="chooseFile"
                                ></v-list-item>
                            </v-list>
                            <v-divider v-if="uploadList.length > 0"></v-divider>
                            <v-list
                                v-if="uploadList.length > 0"
                            >
                                <v-list-subheader>Uploaded files</v-list-subheader>
                                <v-list-item
                                    v-for="entry of uploadList"
                                    v-bind:key="entry.uuid"
                                    v-bind:title="entry.filename"
                                    v-on:click="copyToClipboard(entry.filename)"
                                    style="white-space: nowrap;"
                                >
                                    <template v-slot:prepend>
                                        <v-icon
                                            v-bind:color="uploadStatusColor(entry.status)"
                                        >{{ uploadStatusIcon(entry.status) }}</v-icon>
                                    </template>
                                </v-list-item>
                                <v-list-item
                                    v-bind:prepend-icon="mdiBroom"
                                    title="Clear all"
                                    v-on:click="cleanUploadList"
                                ></v-list-item>
                            </v-list>
                        </v-card>
                    </v-menu>
                </v-list>

                <v-divider></v-divider>

                <v-list
                    nav
                    class="flex-grow-0 flex-shrink-0"
                >
                    <v-list-item color="primary" to="/"           v-bind:prepend-icon="mdiHomeOutline"                   title="Home"    ></v-list-item>
                    <v-list-item color="primary" to="/calendar"   v-bind:prepend-icon="mdiCalendarOutline"               title="Calendar"></v-list-item>
                    <v-list-item color="primary" to="/tasks-next" v-bind:prepend-icon="mdiCheckboxMultipleMarkedOutline" title="Tasks"   ></v-list-item>
                    <v-list-item color="primary" to="/files"      v-bind:prepend-icon="mdiFolderOutline"                 title="Files"   ></v-list-item>
                    <v-list-item color="primary" to="/search"     v-bind:prepend-icon="mdiMagnify"                       title="Search"  ></v-list-item>
                </v-list>

                <v-divider></v-divider>

                <v-fade-transition>
                    <v-list
                        v-show="!miniMainSidebar"
                        nav
                        class="flex-shrink-1 overflow-y-auto"
                    >
                        <v-list-subheader>Notes</v-list-subheader>
                        <NoteTree />
                    </v-list>
                </v-fade-transition>

                <v-spacer></v-spacer>

                <v-divider></v-divider>

                <v-list nav class="flex-shrink-0">
                    <v-menu location="top">
                        <template v-slot:activator="{ props }">
                            <v-list-item
                                v-bind="props"
                                v-bind:title="username ?? undefined"
                                v-bind:subtitle="email ?? undefined"
                            >
                                <template v-slot:prepend>
                                    <Gravatar v-bind:email="email" style="margin-right: 8px"></Gravatar>
                                </template>
                            </v-list-item>
                        </template>
                        <v-card>
                            <v-list>
                                <v-list-item to="/tasks" v-bind:prepend-icon="mdiCheckboxMultipleMarkedOutline" title="Tasks (deprecated)"></v-list-item>
                                <v-list-item to="/config" v-bind:prepend-icon="mdiCogOutline" title="Config"></v-list-item>
                                <v-list-item to="/about" v-bind:prepend-icon="mdiInformationOutline" title="About"></v-list-item>
                                <v-divider></v-divider>
                                <v-list-item v-bind:prepend-icon="mdiLogout" title="Logout" v-on:click="appStore.logout()"></v-list-item>
                            </v-list>
                        </v-card>
                    </v-menu>
                </v-list>
            </div>
        </v-navigation-drawer>

        <!-- Navigation drawer below `md` -->
        <v-navigation-drawer
            v-else
            temporary
            v-model="mobileDrawer"
        >
            <v-list nav>
                <v-list-item title="mory">
                    <template v-slot:prepend>
                        <v-img
                            src="/img/logo.svg"
                            aspect-ratio="1"
                            max-width="24"
                            max-height="24"
                            width="24"
                            class="mr-2"
                        ></v-img>
                    </template>
                    <template v-slot:append>
                        <v-icon-btn
                            v-bind:icon="mdiBackburger"
                            variant="text"
                            title="Close the navigation drawer"
                            v-on:click="mobileDrawer = false"
                        ></v-icon-btn>
                    </template>
                </v-list-item>
            </v-list>

            <v-divider></v-divider>

            <v-list
                nav
            >
                <v-list-item
                    variant="text"
                    title="Enable notification"
                    base-color="error"
                    style="min-width: 36px"
                    v-if="needRequestForNotificationPermission"
                    v-bind:prepend-icon="mdiBell"
                    v-on:click="requestNotificationPermission"
                ></v-list-item>
                <IndexingStopsItem
                    v-if="indexingStops.length > 0"
                    v-bind:stops="indexingStops"
                    location="bottom"
                />
                <v-menu location="right">
                    <template v-slot:activator="{ props }">
                        <v-list-item
                            variant="text"
                            title="Add note"
                            style="min-width: 36px"
                            v-bind="props"
                            v-bind:prepend-icon="mdiPlus"
                        ></v-list-item>
                    </template>
                    <v-list>
                        <v-list-subheader>Create</v-list-subheader>
                        <v-list-item to="/create" v-bind:prepend-icon="mdiFileOutline" title="New note"></v-list-item>
                        <v-list-item
                            v-if="$route.name === 'Note'"
                            v-bind:to="{ name: 'Create', query: { from: Array.isArray($route.params.path) ? $route.params.path.join('/') : $route.params.path } }"
                            v-bind:prepend-icon="mdiFileMultipleOutline"
                            title="Copy of this note"
                        ></v-list-item>
                        <v-list-subheader>Templates</v-list-subheader>
                        <v-list-item
                            v-for="path in templates"
                            v-bind:key="path"
                            v-bind:to="{ name: 'Create', query: { from: path } }"
                            v-bind:prepend-icon="mdiFileDocumentOutline"
                            v-bind:title="path.replace(/\.template$/i, '')"
                        >
                            <template v-slot:append>
                                <!-- v-icon-btn has no `to`. The click still bubbles to the list item, whose own link
                                     would create a note from the template instead; the router skips a click whose
                                     default is already prevented. -->
                                <v-tooltip location="top">
                                    <template v-slot:activator="{ props }">
                                        <v-icon-btn
                                            v-bind:icon="mdiPencil"
                                            size="small"
                                            icon-size="small"
                                            variant="text"
                                            v-bind="props"
                                            v-on:click.prevent="$router.push({ name: 'Note', params: { path: path.split('/') } })"
                                        ></v-icon-btn>
                                    </template>
                                    <span>Edit template</span>
                                </v-tooltip>
                            </template>
                        </v-list-item>
                    </v-list>
                </v-menu>
                <v-menu
                    v-bind:close-on-content-click="false"
                    v-model="uploadMenuIsVisible"
                    location="right"
                >
                    <template v-slot:activator="{ props }">
                        <v-list-item
                            variant="text"
                            title="Upload file"
                            style="min-width: 36px"
                            v-bind="props"
                        >
                            <template v-slot:prepend>
                                <v-badge
                                    v-bind:color="uploadListBadgeColor"
                                    v-bind:model-value="uploadList.length > 0"
                                >
                                    <template v-slot:badge>
                                        <v-icon>{{ uploadListBadgeIcon }}</v-icon>
                                    </template>
                                    <v-icon>{{ mdiCloudUploadOutline }}</v-icon>
                                </v-badge>
                            </template>
                        </v-list-item>
                    </template>
                    <v-card>
                        <v-list>
                            <v-list-item
                                v-bind:prepend-icon="mdiUpload"
                                title="Upload"
                                v-on:click="chooseFile"
                            ></v-list-item>
                        </v-list>
                        <v-divider v-if="uploadList.length > 0"></v-divider>
                        <v-list
                            v-if="uploadList.length > 0"
                        >
                            <v-list-subheader>Uploaded files</v-list-subheader>
                            <v-list-item
                                v-for="entry of uploadList"
                                v-bind:key="entry.uuid"
                                v-bind:title="entry.filename"
                                v-on:click="copyToClipboard(entry.filename)"
                                style="white-space: nowrap;"
                            >
                                <template v-slot:prepend>
                                    <v-icon
                                        v-bind:color="uploadStatusColor(entry.status)"
                                    >{{ uploadStatusIcon(entry.status) }}</v-icon>
                                </template>
                            </v-list-item>
                            <v-list-item
                                v-bind:prepend-icon="mdiBroom"
                                title="Clear all"
                                v-on:click="cleanUploadList"
                            ></v-list-item>
                        </v-list>
                    </v-card>
                </v-menu>
            </v-list>

            <v-divider></v-divider>

            <v-list
                nav
            >
                <v-list-item color="primary" to="/"           v-bind:prepend-icon="mdiHomeOutline"                   title="Home"    ></v-list-item>
                <v-list-item color="primary" to="/calendar"   v-bind:prepend-icon="mdiCalendarOutline"               title="Calendar"></v-list-item>
                <v-list-item color="primary" to="/tasks-next" v-bind:prepend-icon="mdiCheckboxMultipleMarkedOutline" title="Tasks"   ></v-list-item>
                <v-list-item color="primary" to="/files"      v-bind:prepend-icon="mdiFolderOutline"                 title="Files"   ></v-list-item>
                <v-list-item color="primary" to="/search"     v-bind:prepend-icon="mdiMagnify"                       title="Search"  ></v-list-item>
            </v-list>

            <v-divider></v-divider>

            <v-list nav>
                <NoteTree />
            </v-list>

            <v-divider></v-divider>

            <v-list nav>
                <v-menu location="top">
                    <template v-slot:activator="{ props }">
                        <v-list-item
                            v-bind="props"
                            v-bind:title="username ?? undefined"
                            v-bind:subtitle="email ?? undefined"
                        >
                            <template v-slot:prepend>
                                <Gravatar v-bind:email="email" style="margin-right: 8px"></Gravatar>
                            </template>
                        </v-list-item>
                    </template>
                    <v-card>
                        <v-list>
                            <v-list-item to="/tasks" v-bind:prepend-icon="mdiCheckboxMultipleMarkedOutline" title="Tasks (deprecated)"></v-list-item>
                            <v-list-item to="/config" v-bind:prepend-icon="mdiCogOutline" title="Config"></v-list-item>
                            <v-list-item to="/about" v-bind:prepend-icon="mdiInformationOutline" title="About"></v-list-item>
                            <v-divider></v-divider>
                            <v-list-item v-bind:prepend-icon="mdiLogout" title="Logout" v-on:click="appStore.logout()"></v-list-item>
                        </v-list>
                    </v-card>
                </v-menu>
            </v-list>
        </v-navigation-drawer>

        <v-app-bar
            scroll-behavior="elevate"
            color="white"
        >
            <!-- Below `md` the drawer is gone from the screen once closed, so the icon that opens
                 it stays here. Above that the drawer is always in view and carries its own
                 controls. -->
            <v-app-bar-nav-icon
                v-if="$vuetify.display.smAndDown"
                v-on:click="mobileDrawer = !mobileDrawer"
                class="mx-2"
            />
            <v-toolbar-title v-if="appStore.appBarClaims === 0">
                {{ $route.name?.replace(/With.*$/, '') ?? '' }}
            </v-toolbar-title>
            <!-- Where a view puts its own controls, through <AppBarContent>. It draws no box of its
                 own, so what lands here is laid out as the toolbar's own children are. Only
                 Vuetify's spacing, written as `.v-toolbar__content > …`, misses them: a view
                 spaces its controls from the edges and gives a title its margin itself. -->
            <div
                id="app-bar-content"
                class="app-bar-content"
            />
            <!-- The drawer is hidden below `md`, so point at the notice it holds. -->
            <v-btn
                v-if="$vuetify.display.smAndDown && indexingStops.length > 0"
                icon
                color="error"
                title="Indexing stopped"
                v-on:click="mobileDrawer = true"
            >
                <v-icon>{{ mdiAlertCircleOutline }}</v-icon>
            </v-btn>
        </v-app-bar>

        <input type="file" multiple class="d-none" ref="fileInputEl">

        <div v-if="!appStore.hasToken" class="login-overlay">
            <div class="form">
                <v-alert type="error" v-show="appStore.loginError">
                    {{ appStore.loginError }}
                </v-alert>
                <v-icon size="x-large" class="mx-auto">{{ mdiLock }}</v-icon>
                <h2>Login</h2>
                <form>
                    <v-text-field
                        v-on:keydown.enter="appStore.login(loginUsername, loginPassword)"
                        v-model="loginUsername"
                        label="Username"
                        name="username"
                        autocomplete="username"
                        type="text"
                        autofocus
                        variant="outlined"
                    ></v-text-field>
                    <v-text-field
                        v-on:keydown.enter="appStore.login(loginUsername, loginPassword)"
                        v-model="loginPassword"
                        label="Password"
                        name="password"
                        autocomplete="current-password"
                        type="password"
                        variant="outlined"
                    ></v-text-field>
                    <v-btn
                        v-bind:loading="appStore.isLoggingIn"
                        v-on:click="appStore.login(loginUsername, loginPassword)"
                        color="primary"
                        block
                    >Login</v-btn>
                </form>
            </div>
        </div>
    </v-app>
</template>

<script lang="ts" setup>
/* global document */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';

import { useRoute } from 'vue-router';

import {
    mdiAlertCircleOutline,
    mdiAutorenew,
    mdiBackburger,
    mdiBell,
    mdiBroom,
    mdiCalendarOutline,
    mdiCheck,
    mdiCheckboxMultipleMarkedOutline,
    mdiCloudUploadOutline,
    mdiCogOutline,
    mdiExclamationThick,
    mdiFileDocumentOutline,
    mdiFileMultipleOutline,
    mdiFileOutline,
    mdiFolderOutline,
    mdiForwardburger,
    mdiHelp,
    mdiHomeOutline,
    mdiInformationOutline,
    mdiLock,
    mdiLogout,
    mdiMagnify,
    mdiPencil,
    mdiPlus,
    mdiUpload,
} from '@mdi/js';

import { useAppStore } from '@/stores/app';

import { loadConfigValue, saveConfigValue } from '@/config';
import type { Claim, IndexingStop, ListEntry2, UploadEntry } from '@/api';
import IndexingStopsItem from '@/components/IndexingStopsItem.vue';
import { useFilesStore } from '@/stores/files';
import { jwtDecode } from 'jwt-decode';

// Composables
const appStore = useAppStore();
const fileStore = useFilesStore();
const route = useRoute();

// Reactive states
const notificationPermission = ref<'granted'| 'denied' | 'default'>('Notification' in window ? Notification.permission : 'denied');
const miniMainSidebar = ref(loadConfigValue("mini-main-sidebar", false));
const mobileDrawer = ref(false);
const loginUsername = ref("");
const loginPassword = ref("");
const templates = ref([] as string[]);
const uploadList = ref([] as UploadEntry[]);
const uploadMenuIsVisible = ref(false);
const errors = ref([]);
const indexingStops = ref<IndexingStop[]>([]);

// Template Refs
const app = ref(null);
const fileInputEl = ref(null);
const routerViewEl = ref(null);

// Computed properties
const isDev = computed(() => {
    return import.meta.env.DEV;
});

const needRequestForNotificationPermission = computed(() => {
    return notificationPermission.value === "default";
});

const decodedToken = computed(() => {
    if (appStore.token) {
        return jwtDecode<Claim>(appStore.token);
    }
    else {
        return null;
    }
});

const username = computed(() => {
    if (decodedToken.value) {
        return decodedToken.value.sub;
    }
    else {
        return null;
    }
});

const email = computed((): string | null => {
    if (decodedToken.value) {
        return decodedToken.value.email;
    }
    else {
        return null;
    }
});

const uploadListBadgeColor = computed(() => {
    const [status, _] = uploadListStatus.value;

    if      (status === 'in-progress') { return 'blue';  }
    else if (status === 'error')       { return 'red';   }
    else if (status === 'success')     { return 'green'; }
    else {
        return 'gray';
    }
});

const uploadListBadgeIcon = computed(() => {
    const [status, _num] = uploadListStatus.value;

    if      (status === 'in-progress') { return mdiAutorenew;        }
    else if (status === 'error')       { return mdiExclamationThick; }
    else if (status === 'success')     { return mdiCheck;            }
    else {
        return mdiHelp;
    }
});

const uploadListStatus = computed(() => {
    let numInProgresses = 0;
    let numErrors = 0;
    let numSuccesses = 0;
    for (const e of uploadList.value) {
        if (e.status === 'in-progress') {
            numInProgresses += 1;
        }
        else if (e.status === 'error') {
            numErrors += 1;
        }
        else if (e.status === 'success') {
            numSuccesses += 1;
        }
    }

    if      (numInProgresses > 0)                      { return ['in-progress', numInProgresses]; }
    else if (numErrors > 0)                            { return ['error',       numErrors      ]; }
    else if (numSuccesses === uploadList.value.length) { return ['success',     numSuccesses   ]; }
    else {
        return ['unknown', -1];
    }
});

// Lifecycle hooks
onMounted(() => {
    loadCustomCss();

    (fileInputEl.value as HTMLInputElement).addEventListener('change', (e: any) => {
        if (e.target.files.length > 0) {
            // Start to upload the selected files
            uploadFiles(e.target.files);
            // Clear the selection
            e.target.value = '';
        }
    });

    // Function to determine if files are dragged or not
    function containsFiles(event: any) {
        if (event.dataTransfer.types) {
            for (const typ of event.dataTransfer.types) {
                if (typ == "Files") {
                    return true;
                }
            }
        }

        return false;
    }

    loadTemplates();
    refreshIndexingStops();
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Handle drag and drop of files
    // TODO v-onで書き直す
    // TODO 参考: https://qiita.com/punkshiraishi/items/49b91767b5143bcb1fcc
    // TODO 参考: https://learnvue.co/articles/vue-drag-and-drop
    // TODO 参考: https://hackmd.io/@rhHzPg4WS26yfiXdOaOMTg/ryyQFR-K8
    const appEl = app.value.$el;
    appEl.addEventListener('dragenter', (e: any) => {
        if (containsFiles(e) && !appStore.draggingViewerContent) {
            // Show the drop area
            appEl.classList.add('drop-target');
        }
    });

    appEl.addEventListener('dragleave', (e: any) => {
        // Ignore if it's still inside appEl
        if (!e.currentTarget.contains(e.relatedTarget)) {
            if (containsFiles(e) && !appStore.draggingViewerContent) {
                // Hide the drop area
                appEl.classList.remove('drop-target');
            }
        }
    });

    appEl.addEventListener('dragover', (e: any) => {
        e.preventDefault();
    });

    appEl.addEventListener('drop', (e: any) => {
        if (containsFiles(e) && !appStore.draggingViewerContent) {
            // Start to upload the dropped files
            uploadFiles(e.dataTransfer.files);

            // Hide the drop area
            appEl.classList.remove('drop-target');

            e.preventDefault();
        }
    });
});

onUnmounted(() => {
    unloadCustomCss();
    document.removeEventListener('visibilitychange', onVisibilityChange);
});

// Methods
async function requestNotificationPermission() {
    if (!('Notification' in window)) { return; }

    const result = await Notification.requestPermission();
    notificationPermission.value = result;

    // Show an example notification if allowed
    if (result === "granted") {
        const n = new Notification("Example notification from mory", {
            icon: import.meta.env.VITE_APP_APPLICATION_ROOT + 'favicon.png',
        });
    }
}

function tokenExpired(callback: () => void) {
    appStore.invalidateToken(callback);
}

// A stop lasts until moried restarts, so noticing it the next time the app is looked at is soon
// enough. Polling would keep an idle tab talking to the server for a state that rarely changes.
async function refreshIndexingStops(): Promise<void> {
    if (!appStore.hasToken) {
        indexingStops.value = [];
        return;
    }
    try {
        const response = await fileStore.indexing();
        indexingStops.value = Array.isArray(response?.stopped) ? response.stopped : [];
    }
    catch {
        // A failed check says nothing about indexing, so keep showing what was last known.
    }
}

function onVisibilityChange() {
    if (document.visibilityState === 'visible') {
        refreshIndexingStops();
    }
}

function loadTemplates() {
    fileStore.list()
        .then(entries => {
            templates.value = entries
                .map((entry: ListEntry2) => entry.path)
                .filter((path: string) => path.match(/\.template$/i));
        }).catch(error => {
            if (error.response) {
                if (error.response.status === 401) {
                    // Unauthorized
                    tokenExpired(() => loadTemplates());
                }
                else {
                    throw error;
                }
            }
            else {
                throw error;
            }
        });
}

async function loadCustomCss() {
    try {
        // Try CSS file first
        const css = await fileStore.read('.mory/custom.css');
        // CSS file exists, use it directly
        const style = document.createElement('style');
        style.setAttribute('type', 'text/css');
        style.setAttribute('id', 'custom-css');
        style.innerText = css;
        document.head.appendChild(style);
    } catch (error) {
        if (error.response) {
            if (error.response.status === 401) {
                // Unauthorized
                tokenExpired(async () => await loadCustomCss());
                return;
            }
            else if (error.response.status === 404) {
                // CSS file not found, try LESS file
                await loadCustomLess();
                return;
            }
            else {
                throw error;
            }
        }
        else {
            throw error;
        }
    }
}

async function loadCustomLess() {
    try {
        // Start both operations in parallel
        const [source, { default: less }] = await Promise.all([
            fileStore.read('.mory/custom.less'),
            import('less'),
        ]);
        
        const output = await less.render(source, {
            globalVars: {
                'nav-height': '64px',
            },
        });
        
        const style = document.createElement('style');
        style.setAttribute('type', 'text/css');
        style.setAttribute('id', 'custom-css');
        style.innerText = output.css;
        document.head.appendChild(style);
    } catch (error) {
        if (error.response) {
            if (error.response.status === 401) {
                // Unauthorized
                tokenExpired(async () => await loadCustomCss());
            }
            else if (error.response.status === 404) {
                // We can simply ignore the error
            }
            else {
                throw error;
            }
        }
        else {
            throw error;
        }
    }
}

function unloadCustomCss() {
    for (const style of document.head.querySelectorAll('#custom-css')) {
        style.remove();
    }
}

function cleanUploadList() {
    uploadList.value = uploadList.value.filter(e => e.status === 'in-progress');
    uploadMenuIsVisible.value = false;
}

function uploadStatusColor(status: string) {
    if      (status === 'in-progress') { return 'blue';  }
    else if (status === 'error')       { return 'red';   }
    else if (status === 'success')     { return 'green'; }
    else {
        return 'gray';
    }
}

function uploadStatusIcon(status: string) {
    if      (status === 'in-progress') { return mdiAutorenew;        }
    else if (status === 'error')       { return mdiExclamationThick; }
    else if (status === 'success')     { return mdiCheck;            }
    else {
        return mdiHelp;
    }
}

function chooseFile() {
    (fileInputEl.value as HTMLInputElement).click();
    uploadMenuIsVisible.value = false;
}

function uploadFiles(files: File[]) {
    // Add the files to a FormData and uploadList
    const fd = new FormData();
    for (const file of files) {
        const uuid = crypto.randomUUID();

        fd.append(uuid, file);

        uploadList.value.push({
            uuid: uuid,
            filename: file.name,
            status: 'in-progress',
            statusMessage: 'Being uploaded...',
        });
    }

    // POST the FormData
    fileStore.upload(fd).then(results => {
        for (const [uuid, result] of results) {
            const entry = uploadList.value.find(e => e.uuid === uuid);
            if (entry) {
                entry.status = result;
                entry.statusMessage = 'Successfully uploaded';
            }
        }
    }).catch(error => {
        for (const uuid of fd.keys()) {
            const entry = uploadList.value.find(e => e.uuid === uuid);
            if (entry) {
                entry.status = 'error';
                entry.statusMessage = error.message;
            }
        }
    });
}

function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
}

// Watchers
watch(miniMainSidebar, (newMiniMainSidebar: boolean) => {
  saveConfigValue("mini-main-sidebar", newMiniMainSidebar);
});

watch(() => appStore.hasToken, () => {
    refreshIndexingStops();
});

watch(() => route.name, () => {
    refreshIndexingStops();
});
</script>

<style scoped lang="scss">
#app {
    user-select: none;
    overflow: hidden;

    &.drop-target {
        &::after {
            content: '';
            display: block;
            pointer-events: none;

            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 5;

            outline: 4px solid hsl(212, 100%, 50%);
            outline-offset: -4px;
            background-color: hsla(212, 100%, 50%, 0.33);
        }
    }
}

.app-bar-content {
    display: contents;
}

#nav {
    a {
        text-decoration: none;
    }
}

// The logo and the nav icon share one box, so the swap changes nothing around them.
.logo-swap {
    position: relative;
    width: 24px;
    height: 24px;

    &__logo,
    &__icon {
        transition: opacity 0.15s ease-in-out;
    }

    &__icon {
        position: absolute;
        top: 0;
        left: 0;
        opacity: 0;
    }
}

.drawer-header--rail {
    &:hover,
    &:focus-visible {
        .logo-swap__logo {
            opacity: 0;
        }

        .logo-swap__icon {
            opacity: 1;
        }
    }
}

.logo {
    display: inline-block;
    width: 48px;
    height: 48px;
    background-size: contain;
    background-position: center;
    background-repeat: no-repeat;
    background-image: url("/img/logo.svg");
}

.logo-text {
    font-weight: 300 !important;
    letter-spacing: 0.2em !important;
    overflow: visible;
}

.login-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 100;

    backdrop-filter: blur(16px);

    text-align: center;
    display: flex;
    flex-direction: column;

    &::before,
    &::after {
        content: '';
        flex: 1 1 0;
    }

    .form {
        width: calc(100% - 20px);
        max-width: 400px;
        margin: 0 auto;
        padding: 2em;

        display: flex;
        flex-direction: column;

        & > * {
            margin-top: 1em;
        }

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
