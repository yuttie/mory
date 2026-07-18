<template>
    <v-app id="app" ref="app">
        <!-- App bar for mobile -->
        <v-app-bar
            v-if="$vuetify.display.xs"
            scroll-behavior="elevate"
            color="white"
        >
            <v-app-bar-nav-icon v-on:click="mobileDrawer = true" />
            <v-toolbar-title>{{ $route.name.replace(/With.*$/, '') }}</v-toolbar-title>
        </v-app-bar>

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
                density="compact"
                closable
                style="z-index: 100; margin-bottom: 2px;"
            >{{ error.message }}</v-alert>
        </template>
        <!-- Navigation drawer for desktop -->
        <v-navigation-drawer
            v-if="!$vuetify.display.xs"
            v-bind:rail="miniMainSidebar"
            v-bind:expand-on-hover="miniMainSidebar"
            permanent
        >
            <v-list density="compact" nav>
                <v-list-item
                    v-if="miniMainSidebar"
                    v-on:click="miniMainSidebar = false"
                >
                    <template v-slot:prepend>
                        <v-icon>{{ mdiChevronDoubleRight }}</v-icon>
                    </template>
                </v-list-item>
                <v-list-item>
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
                    <v-list-item-title class="text-h6 logo-text">
                        mory
                    </v-list-item-title>
                    <template v-slot:append v-if="!miniMainSidebar">
                        <v-btn
                            icon
                            variant="text"
                            rounded="0"
                            v-on:click="miniMainSidebar = true"
                        ><v-icon>{{ mdiChevronDoubleLeft }}</v-icon></v-btn>
                    </template>
                </v-list-item>
            </v-list>

            <v-list
                dense
                nav
            >
                <v-list-item color="primary" to="/"><template v-slot:prepend><v-icon size="small">{{ mdiHomeOutline }}</v-icon></template><v-list-item-title>Home</v-list-item-title></v-list-item>
                <v-list-item color="primary" to="/calendar"><template v-slot:prepend><v-icon size="small">{{ mdiCalendarOutline }}</v-icon></template><v-list-item-title>Calendar</v-list-item-title></v-list-item>
                <v-list-item color="primary" to="/tasks"><template v-slot:prepend><v-icon size="small">{{ mdiBallotOutline }}</v-icon></template><v-list-item-title>Tasks</v-list-item-title></v-list-item>
                <v-list-item color="primary" to="/tasks-next"><template v-slot:prepend><v-icon size="small">{{ mdiBallotOutline }}</v-icon></template><v-list-item-title>Tasks (New)</v-list-item-title></v-list-item>
                <v-list-item color="primary" to="/files"><template v-slot:prepend><v-icon size="small">{{ mdiFileDocumentMultipleOutline }}</v-icon></template><v-list-item-title>Files</v-list-item-title></v-list-item>
                <v-list-item color="primary" to="/search"><template v-slot:prepend><v-icon size="small">{{ mdiMagnify }}</v-icon></template><v-list-item-title>Search</v-list-item-title></v-list-item>
                <v-list-item color="primary" to="/config"><template v-slot:prepend><v-icon size="small">{{ mdiCogOutline }}</v-icon></template><v-list-item-title>Config</v-list-item-title></v-list-item>
                <v-list-item color="primary" to="/about"><template v-slot:prepend><v-icon size="small">{{ mdiInformationOutline }}</v-icon></template><v-list-item-title>About</v-list-item-title></v-list-item>
            </v-list>

            <v-divider></v-divider>

            <v-list>
                <v-treeview
                    v-model:activated="noteTreeActive"
                    v-model:opened="noteTreeOpen"
                    v-bind:items="noteTreeRoot"
                    v-bind:load-children="populateTagChildren"
                    item-title="name"
                    item-value="id"
                    activatable
                    open-on-click
                    density="compact"
                >
                    <template v-slot:prepend="{ item, isOpen }">
                        <v-icon v-if="item.children" size="small">
                            {{ isOpen ? mdiFolderOpen : mdiFolder }}
                        </v-icon>
                        <v-icon v-else size="small">
                            {{ mdiFileDocumentOutline }}
                        </v-icon>
                    </template>
                </v-treeview>
            </v-list>
        </v-navigation-drawer>

        <!-- Navigation drawer for mobile -->
        <v-navigation-drawer
            v-else
            temporary
            v-model="mobileDrawer"
        >
            <v-list
                density="compact"
                nav
            >
                <v-list-item>
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
                    <v-list-item-title class="text-h5">
                        mory
                    </v-list-item-title>
                </v-list-item>
                <v-list-item color="primary" to="/"><template v-slot:prepend><v-icon size="small">{{ mdiHomeOutline }}</v-icon></template><v-list-item-title>Home</v-list-item-title></v-list-item>
                <v-list-item color="primary" to="/calendar"><template v-slot:prepend><v-icon size="small">{{ mdiCalendarOutline }}</v-icon></template><v-list-item-title>Calendar</v-list-item-title></v-list-item>
                <v-list-item color="primary" to="/tasks"><template v-slot:prepend><v-icon size="small">{{ mdiBallotOutline }}</v-icon></template><v-list-item-title>Tasks</v-list-item-title></v-list-item>
                <v-list-item color="primary" to="/tasks-next"><template v-slot:prepend><v-icon size="small">{{ mdiBallotOutline }}</v-icon></template><v-list-item-title>Tasks (New)</v-list-item-title></v-list-item>
                <v-list-item color="primary" to="/files"><template v-slot:prepend><v-icon size="small">{{ mdiFileDocumentMultipleOutline }}</v-icon></template><v-list-item-title>Files</v-list-item-title></v-list-item>
                <v-list-item color="primary" to="/search"><template v-slot:prepend><v-icon size="small">{{ mdiMagnify }}</v-icon></template><v-list-item-title>Search</v-list-item-title></v-list-item>
                <v-list-item color="primary" to="/config"><template v-slot:prepend><v-icon size="small">{{ mdiCogOutline }}</v-icon></template><v-list-item-title>Config</v-list-item-title></v-list-item>
                <v-list-item color="primary" to="/about"><template v-slot:prepend><v-icon size="small">{{ mdiInformationOutline }}</v-icon></template><v-list-item-title>About</v-list-item-title></v-list-item>
            </v-list>

            <v-divider></v-divider>

            <v-list>
                <v-treeview
                    v-model:activated="noteTreeActive"
                    v-model:opened="noteTreeOpen"
                    v-bind:items="noteTreeRoot"
                    v-bind:load-children="populateTagChildren"
                    item-title="name"
                    item-value="id"
                    activatable
                    open-on-click
                    density="compact"
                >
                    <template v-slot:prepend="{ item, isOpen }">
                        <v-icon v-if="item.children" size="small">
                            {{ isOpen ? mdiFolderOpen : mdiFolder }}
                        </v-icon>
                        <v-icon v-else size="small">
                            {{ mdiFileDocumentOutline }}
                        </v-icon>
                    </template>
                </v-treeview>
            </v-list>
        </v-navigation-drawer>

        <v-row
            style="position: fixed; top: 0; right: 0; z-index: 10;"
            class="mr-2 mt-2"
        >
            <input type="file" multiple class="d-none" ref="fileInputEl">
            <v-btn
                variant="text"
                title="Enable notification"
                color="error"
                class="pa-0 ml-2"
                style="min-width: 36px"
                v-if="needRequestForNotificationPermission"
                v-on:click="requestNotificationPermission"
            >
                <v-icon>{{ mdiBell }}</v-icon>
            </v-btn>
            <v-menu>
                <template v-slot:activator="{ props }">
                    <v-btn
                        variant="text"
                        title="Add note"
                        class="pa-0 ml-2"
                        style="min-width: 36px"
                        v-bind="props"
                    >
                        <v-icon>{{ mdiPencilBoxOutline }}</v-icon>
                    </v-btn>
                </template>
                <v-list density="compact">
                    <v-list-subheader>Create</v-list-subheader>
                    <v-list-item to="/create">
                        <template v-slot:prepend>
                            <v-icon size="small">{{ mdiFileOutline }}</v-icon>
                        </template>
                        <v-list-item-title>New note</v-list-item-title>
                    </v-list-item>
                    <v-list-item
                        v-if="$route.name === 'Note'"
                        v-bind:to="{ name: 'Create', query: { from: Array.isArray($route.params.path) ? $route.params.path.join('/') : $route.params.path } }"
                    >
                        <template v-slot:prepend>
                            <v-icon size="small">{{ mdiFileMultipleOutline }}</v-icon>
                        </template>
                        <v-list-item-title>Copy of this note</v-list-item-title>
                    </v-list-item>
                    <v-list-subheader>Templates</v-list-subheader>
                    <v-list-item
                        v-for="path in templates"
                        v-bind:key="path"
                        v-bind:to="{ name: 'Create', query: { from: path } }"
                    >
                        <template v-slot:prepend>
                            <v-icon size="small">{{ mdiFileDocumentOutline }}</v-icon>
                        </template>
                        <v-list-item-title>{{ path.replace(/\.template$/i, '') }}</v-list-item-title>
                        <template v-slot:append>
                            <v-tooltip location="top">
                                <template v-slot:activator="{ props }">
                                    <v-btn
                                        icon
                                        size="x-small"
                                        variant="text"
                                        v-bind="props"
                                        v-bind:to="{ name: 'Note', params: { path: path.split('/') } }"
                                    >
                                        <v-icon>{{ mdiPencil }}</v-icon>
                                    </v-btn>
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
            >
                <template v-slot:activator="{ props }">
                    <v-btn
                        variant="text"
                        title="Upload file"
                        class="pa-0 ml-2"
                        style="min-width: 36px"
                        v-bind="props"
                    >
                        <v-badge
                            v-bind:color="uploadListBadgeColor"
                            v-bind:model-value="uploadList.length > 0"
                        >
                            <template v-slot:badge>
                                <v-icon>{{ uploadListBadgeIcon }}</v-icon>
                            </template>
                            <v-icon>{{ mdiCloudUploadOutline }}</v-icon>
                        </v-badge>
                    </v-btn>
                </template>
                <v-card>
                    <v-list density="compact">
                        <v-list-item
                            v-on:click="chooseFile"
                        >
                            <template v-slot:prepend><v-icon size="small">{{ mdiUpload }}</v-icon></template>
                            <v-list-item-title>Upload</v-list-item-title>
                        </v-list-item>
                    </v-list>
                    <v-divider v-if="uploadList.length > 0"></v-divider>
                    <v-list
                        v-if="uploadList.length > 0"
                        density="compact"
                    >
                        <v-list-subheader>Uploaded files</v-list-subheader>
                        <v-list-item
                            v-for="entry of uploadList"
                            v-bind:key="entry.uuid"
                            v-on:click="copyToClipboard(entry.filename)"
                            style="white-space: nowrap;"
                        >
                            <template v-slot:prepend>
                                <v-icon
                                    size="small"
                                    v-bind:color="uploadStatusColor(entry.status)"
                                >{{ uploadStatusIcon(entry.status) }}</v-icon>
                            </template>
                            <v-list-item-title>
                                <span>{{ entry.filename }}</span>
                            </v-list-item-title>
                        </v-list-item>
                        <v-list-item
                            v-on:click="cleanUploadList"
                        >
                            <template v-slot:prepend><v-icon size="small">{{ mdiBroom }}</v-icon></template>
                            <v-list-item-title>Clear all</v-list-item-title>
                        </v-list-item>
                    </v-list>
                </v-card>
            </v-menu>
            <v-menu>
                <template v-slot:activator="{ props }">
                    <v-btn
                        variant="text"
                        class="pa-0 ml-2"
                        style="min-width: 36px"
                        v-bind="props"
                    >
                        <Gravatar v-bind:email="email" v-bind:title="`Logged in as ${username}`"></Gravatar>
                    </v-btn>
                </template>
                <v-card>
                    <v-list density="compact">
                        <v-list-item>
                            <template v-slot:prepend>
                                <Gravatar v-bind:email="email" v-bind:title="`Logged in as ${username}`" class="mr-2"></Gravatar>
                            </template>
                            <v-list-item-title>{{ username }}</v-list-item-title>
                            <v-list-item-subtitle>{{ email }}</v-list-item-subtitle>
                        </v-list-item>
                    </v-list>
                    <v-divider></v-divider>
                    <v-list density="compact">
                        <v-list-item
                            v-on:click="appStore.logout()"
                        >
                            <template v-slot:prepend>
                                <v-icon size="small">{{ mdiLogout }}</v-icon>
                            </template>
                            <v-list-item-title>Logout</v-list-item-title>
                        </v-list-item>
                    </v-list>
                </v-card>
            </v-menu>
        </v-row>

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
                        variant="outlined"
                    >Login</v-btn>
                </form>
            </div>
        </div>
    </v-app>
</template>

<script lang="ts" setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';

import {
    mdiAutorenew,
    mdiBallotOutline,
    mdiBell,
    mdiBroom,
    mdiCalendarOutline,
    mdiCheck,
    mdiChevronDoubleLeft,
    mdiChevronDoubleRight,
    mdiCloudUploadOutline,
    mdiCogOutline,
    mdiExclamationThick,
    mdiFileDocumentOutline,
    mdiFileDocumentMultipleOutline,
    mdiFileMultipleOutline,
    mdiFileOutline,
    mdiFolder,
    mdiFolderOpen,
    mdiHelp,
    mdiHomeOutline,
    mdiInformationOutline,
    mdiLock,
    mdiLogout,
    mdiMagnify,
    mdiPencil,
    mdiPencilBoxOutline,
    mdiUpload,
} from '@mdi/js';

import { useAppStore } from '@/stores/app';

import * as api from '@/api';
import { loadConfigValue, saveConfigValue } from '@/config';
import type { Claim, ListEntry2, UploadEntry } from '@/api';
import { jwtDecode } from 'jwt-decode';

interface TreeNode {
    name: string;
    id: string;
    context: string[];
    children: TreeNode[];
}

// Composables
const appStore = useAppStore();

// Reactive states
const notificationPermission = ref<'granted'| 'denied' | 'default'>('Notification' in window ? Notification.permission : 'denied');
const miniMainSidebar = ref(loadConfigValue("mini-main-sidebar", false));
const mobileDrawer = ref(false);
const loginUsername = ref("");
const loginPassword = ref("");
const templates = ref([] as string[]);
const uploadList = ref([] as UploadEntry[]);
const uploadMenuIsVisible = ref(false);
const noteTree = ref([] as TreeNode[]);
const noteTreeOpen = ref([]);
const noteTreeActive = ref([]);
const errors = ref([]);

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

const noteTreeRoot = computed(() => {
    return [
        {
            name: 'Tags',
            id: '',
            context: [],
            children: noteTree.value,
        },
    ];
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

function loadTemplates() {
    api.listNotes()
        .then(res => {
            templates.value = res.data
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
        const res = await api.getNote('.mory/custom.css');
        // CSS file exists, use it directly
        const style = document.createElement('style');
        style.setAttribute('type', 'text/css');
        style.setAttribute('id', 'custom-css');
        style.innerText = res.data;
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
        const [res, { default: less }] = await Promise.all([
            api.getNote('.mory/custom.less'),
            import('less'),
        ]);
        
        const output = await less.render(res.data, {
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
    api.uploadFiles(fd).then(res => {
        for (const [uuid, result] of res.data) {
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

async function populateTagChildren(item: TreeNode) {
    const entries = await api.listNotes().then(res => res.data);

    const tags: Map<string, number> = new Map();
    for (const entry of entries) {
        if ('metadata' in entry && entry.metadata !== null) {
            if ('tags' in entry.metadata && entry.metadata.tags !== null) {
                if (item.context.every((t) => entry.metadata.tags.includes(t))) {
                    for (const tag of entry.metadata.tags) {
                        tags.set(tag, (tags.get(tag) || 0) + 1);
                    }
                }
            }
        }
    }
    for (const tag of item.context) {
        tags.delete(tag);
    }
    for (const tag of [...tags.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0])) {
        const context = item.context.concat([tag]);
        item.children.push({
            name: tag,
            id: context.join('/'),
            context: context,
            children: [],
        });
    }
}

// Watchers
watch(miniMainSidebar, (newMiniMainSidebar: boolean) => {
  saveConfigValue("mini-main-sidebar", newMiniMainSidebar);
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

#nav {
    a {
        text-decoration: none;
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
