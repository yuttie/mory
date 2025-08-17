<template>
    <v-app id="app" ref="app">
        <v-main v-if="appStore.serviceWorkerConfigured && appStore.serviceWorkerHasToken">
            <v-container fluid pa-0 style="height: 100%;">
                <router-view v-if="!(!appStore.hasToken && !routerViewEl)" v-bind:key="$route.path" v-on:tokenExpired="tokenExpired" class="router-view" ref="routerViewEl"/>
            </v-container>
        </v-main>

        <v-alert
            v-if="isDev"
            v-for="error of errors"
            v-bind:key="error.id"
            type="error"
            dense
            dismissible
            style="z-index: 100; margin-bottom: 2px;"
        >{{ error.message }}</v-alert>
        <v-navigation-drawer
            app
            clipped
            v-bind:mini-variant="miniMainSidebar"
            v-bind:expand-on-hover="miniMainSidebar"
            permanent
            v-if="!$vuetify.breakpoint.xs"
        >
            <v-list dense nav>
                <v-list-item
                    v-if="miniMainSidebar"
                    v-on:click="miniMainSidebar = false"
                >
                    <v-list-item-icon>
                        <v-icon>{{ mdiChevronDoubleRight }}</v-icon>
                    </v-list-item-icon>
                    <v-list-item-content><!-- Necessary for proper alignment and layout of v-list-item when only an icon is present --></v-list-item-content>
                </v-list-item>
                <v-list-item>
                    <v-img
                        src="/img/logo.svg"
                        aspect-ratio="1"
                        contain
                        max-width="24"
                        max-height="24"
                        class="mr-2"
                    ></v-img>
                    <v-list-item-content>
                        <v-list-item-title class="text-h5">
                            mory
                        </v-list-item-title>
                    </v-list-item-content>
                    <v-spacer></v-spacer>
                    <template v-if="!miniMainSidebar">
                        <v-btn
                            icon
                            tile
                            v-on:click="miniMainSidebar = true"
                        ><v-icon>{{ mdiChevronDoubleLeft }}</v-icon></v-btn>
                    </template>
                </v-list-item>
            </v-list>

            <v-list
                dense
                nav
            >
                <v-list-item color="primary" link to="/"><v-list-item-icon><v-icon dense>{{ mdiHomeOutline }}</v-icon></v-list-item-icon><v-list-item-title>Home</v-list-item-title></v-list-item>
                <v-list-item color="primary" link to="/calendar"><v-list-item-icon><v-icon dense>{{ mdiCalendarOutline }}</v-icon></v-list-item-icon><v-list-item-title>Calendar</v-list-item-title></v-list-item>
                <v-list-item color="primary" link to="/tasks"><v-list-item-icon><v-icon dense>{{ mdiBallotOutline }}</v-icon></v-list-item-icon><v-list-item-title>Tasks</v-list-item-title></v-list-item>
                <v-list-item color="primary" link to="/tasks-next"><v-list-item-icon><v-icon dense>{{ mdiBallotOutline }}</v-icon></v-list-item-icon><v-list-item-title>Tasks (New)</v-list-item-title></v-list-item>
                <v-list-item color="primary" link to="/files"><v-list-item-icon><v-icon dense>{{ mdiFileDocumentMultipleOutline }}</v-icon></v-list-item-icon><v-list-item-title>Files</v-list-item-title></v-list-item>
                <v-list-item color="primary" link to="/search"><v-list-item-icon><v-icon dense>{{ mdiMagnify }}</v-icon></v-list-item-icon><v-list-item-title>Search</v-list-item-title></v-list-item>
                <v-list-item color="primary" link to="/config"><v-list-item-icon><v-icon dense>{{ mdiCogOutline }}</v-icon></v-list-item-icon><v-list-item-title>Config</v-list-item-title></v-list-item>
                <v-list-item color="primary" link to="/about"><v-list-item-icon><v-icon dense>{{ mdiInformationOutline }}</v-icon></v-list-item-icon><v-list-item-title>About</v-list-item-title></v-list-item>
            </v-list>

            <v-divider></v-divider>

            <v-list>
                <v-treeview
                    v-bind:active.sync="noteTreeActive"
                    v-bind:items="noteTreeRoot"
                    v-bind:load-children="populateTagChildren"
                    v-bind:open.sync="noteTreeOpen"
                    activatable
                    open-on-click
                    transition
                    dense
                >
                    <template v-slot:prepend="{ item, open }">
                        <v-icon v-if="item.children" dense>
                            {{ open ? mdiFolderOpen : mdiFolder }}
                        </v-icon>
                        <v-icon v-else dense>
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
                text
                title="Enable notification"
                color="error"
                class="pa-0 ml-2"
                style="min-width: 36px"
                v-if="needRequestForNotificationPermission"
                v-on:click="requestNotificationPermission"
            >
                <v-icon>{{ mdiBell }}</v-icon>
            </v-btn>
            <v-menu
                offset-y
            >
                <template v-slot:activator="{ on, attrs }">
                    <v-btn
                        text
                        title="Add note"
                        class="pa-0 ml-2"
                        style="min-width: 36px"
                        v-bind="attrs"
                        v-on="on"
                    >
                        <v-icon>{{ mdiPencilBoxOutline }}</v-icon>
                    </v-btn>
                </template>
                <v-list dense>
                    <v-subheader>Create</v-subheader>
                    <v-list-item to="/create">
                        <v-list-item-icon>
                            <v-icon dense>{{ mdiFileOutline }}</v-icon>
                        </v-list-item-icon>
                        <v-list-item-content>
                            <v-list-item-title>New note</v-list-item-title>
                        </v-list-item-content>
                    </v-list-item>
                    <v-list-item
                        v-if="$route.name === 'Note'"
                        v-bind:to="{ name: 'Create', query: { from: $route.params.path } }"
                    >
                        <v-list-item-icon>
                            <v-icon dense>{{ mdiFileMultipleOutline }}</v-icon>
                        </v-list-item-icon>
                        <v-list-item-content>
                            <v-list-item-title>Copy of this note</v-list-item-title>
                        </v-list-item-content>
                    </v-list-item>
                    <v-subheader>Templates</v-subheader>
                    <v-list-item
                        v-for="path in templates"
                        v-bind:key="path"
                        v-bind:to="{ name: 'Create', query: { from: path } }"
                    >
                        <v-list-item-icon>
                            <v-icon dense>{{ mdiFileDocumentOutline }}</v-icon>
                        </v-list-item-icon>
                        <v-list-item-content>
                            <v-list-item-title>{{ path.replace(/\.template$/i, '') }}</v-list-item-title>
                        </v-list-item-content>
                        <v-tooltip top>
                            <template v-slot:activator="{ on, attrs }">
                                <v-btn
                                    icon
                                    x-small
                                    v-bind="attrs"
                                    v-on="on"
                                    v-bind:to="{ name: 'Note', params: { path: path } }"
                                >
                                    <v-icon>{{ mdiPencil }}</v-icon>
                                </v-btn>
                            </template>
                            <span>Edit template</span>
                        </v-tooltip>
                    </v-list-item>
                </v-list>
            </v-menu>
            <v-menu
                v-bind:close-on-content-click="false"
                v-model="uploadMenuIsVisible"
                offset-y
            >
                <template v-slot:activator="{ attrs, on }">
                    <v-btn
                        text
                        title="Upload file"
                        class="pa-0 ml-2"
                        style="min-width: 36px"
                        v-bind="attrs"
                        v-on="on"
                    >
                        <v-badge
                            v-bind:color="uploadListBadgeColor"
                            v-bind:value="uploadList.length > 0"
                            overlap
                        >
                            <template v-slot:badge>
                                <v-icon>{{ uploadListBadgeIcon }}</v-icon>
                            </template>
                            <v-icon>{{ mdiCloudUploadOutline }}</v-icon>
                        </v-badge>
                    </v-btn>
                </template>
                <v-card>
                    <v-list dense>
                        <v-list-item
                            v-on:click="chooseFile"
                        >
                            <v-list-item-icon><v-icon dense>{{ mdiUpload }}</v-icon></v-list-item-icon>
                            <v-list-item-title>Upload</v-list-item-title>
                        </v-list-item>
                    </v-list>
                    <v-divider v-if="uploadList.length > 0"></v-divider>
                    <v-list
                        v-if="uploadList.length > 0"
                        dense
                    >
                        <v-subheader>Uploaded files</v-subheader>
                        <v-list-item
                            v-for="entry of uploadList"
                            v-bind:key="entry.uuid"
                            v-on:click="copyToClipboard(entry.filename)"
                            style="white-space: nowrap;"
                        >
                            <v-list-item-icon>
                                <v-icon
                                    dense
                                    v-bind:color="uploadStatusColor(entry.status)"
                                >{{ uploadStatusIcon(entry.status) }}</v-icon>
                            </v-list-item-icon>
                            <v-list-item-content>
                                <v-list-item-title>
                                    <span>{{ entry.filename }}</span>
                                </v-list-item-title>
                            </v-list-item-content>
                        </v-list-item>
                        <v-list-item
                            v-on:click="cleanUploadList"
                        >
                            <v-list-item-icon><v-icon dense>{{ mdiBroom }}</v-icon></v-list-item-icon>
                            <v-list-item-title>Clear all</v-list-item-title>
                        </v-list-item>
                    </v-list>
                </v-card>
            </v-menu>
            <v-menu
                offset-y
            >
                <template v-slot:activator="{ attrs, on }">
                    <v-btn
                        text
                        class="pa-0 ml-2"
                        style="min-width: 36px"
                        v-bind="attrs"
                        v-on="on"
                    >
                        <Gravatar v-bind:email="email" v-bind:title="`Logged in as ${username}`"></Gravatar>
                    </v-btn>
                </template>
                <v-card>
                    <v-list dense>
                        <v-list-item>
                            <v-list-item-avatar>
                                <Gravatar v-bind:email="email" v-bind:title="`Logged in as ${username}`"></Gravatar>
                            </v-list-item-avatar>
                            <v-list-item-content>
                                <v-list-item-title>{{ username }}</v-list-item-title>
                                <v-list-item-subtitle>{{ email }}</v-list-item-subtitle>
                            </v-list-item-content>
                        </v-list-item>
                    </v-list>
                    <v-divider></v-divider>
                    <v-list dense>
                        <v-list-item
                            v-on:click="appStore.logout()"
                        >
                            <v-list-item-icon>
                                <v-icon dense>{{ mdiLogout }}</v-icon>
                            </v-list-item-icon>
                            <v-list-item-title>Logout</v-list-item-title>
                        </v-list-item>
                    </v-list>
                </v-card>
            </v-menu>
        </v-row>

        <v-app-bar
            app
            bottom
            dense
            color="white"
            elevation="0"
            v-if="$vuetify.breakpoint.xs"
        >
            <v-btn-toggle
                borderless
                color="primary"
                group
                tile
                class="flex-grow-1 d-flex pa-0"
            >
                <v-btn text to="/"         class="flex-grow-1"><v-icon>{{ mdiHomeOutline                 }}</v-icon></v-btn>
                <v-btn text to="/calendar" class="flex-grow-1"><v-icon>{{ mdiCalendarOutline             }}</v-icon></v-btn>
                <v-btn text to="/tasks"    class="flex-grow-1"><v-icon>{{ mdiBallotOutline               }}</v-icon></v-btn>
                <v-btn text to="/files"    class="flex-grow-1"><v-icon>{{ mdiFileDocumentMultipleOutline }}</v-icon></v-btn>
                <v-btn text to="/search"   class="flex-grow-1"><v-icon>{{ mdiMagnify                     }}</v-icon></v-btn>
                <v-btn text to="/config"   class="flex-grow-1"><v-icon>{{ mdiCogOutline                  }}</v-icon></v-btn>
                <v-btn text to="/about"    class="flex-grow-1"><v-icon>{{ mdiInformationOutline          }}</v-icon></v-btn>
            </v-btn-toggle>
        </v-app-bar>

        <div v-if="!appStore.hasToken" class="login-overlay">
            <div class="form">
                <v-alert type="error" v-show="appStore.loginError">
                    {{ appStore.loginError }}
                </v-alert>
                <v-icon x-large>{{ mdiLock }}</v-icon>
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
                        outlined
                    ></v-text-field>
                    <v-text-field
                        v-on:keydown.enter="appStore.login(loginUsername, loginPassword)"
                        v-model="loginPassword"
                        label="Password"
                        name="password"
                        autocomplete="current-password"
                        type="password"
                        outlined
                    ></v-text-field>
                    <v-btn
                        v-bind:loading="appStore.isLoggingIn"
                        v-on:click="appStore.login(loginUsername, loginPassword)"
                        color="primary"
                        block
                        text
                        outlined
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

import Gravatar from '@/components/Gravatar.vue';

import * as api from '@/api';
import { loadConfigValue, saveConfigValue } from '@/config';
import type { Claim, ListEntry2, UploadEntry } from '@/api';
import { jwtDecode } from 'jwt-decode';
import less from 'less';

interface TreeNode {
    name: string;
    id: string;
    context: string[];
    children: TreeNode[];
}

// Composables
const appStore = useAppStore();

// Reactive states
const notificationPermission = ref(Notification.permission);
const miniMainSidebar = ref(loadConfigValue("mini-main-sidebar", false));
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

function loadCustomCss() {
    api.getNote('.mory/custom.less')
        .then(res => {
            less.render(res.data, {
                globalVars: {
                    'nav-height': '64px',
                },
            }).then(output => {
                const style = document.createElement('style');
                style.setAttribute('type', 'text/css');
                style.setAttribute('id', 'custom-css');
                style.innerText = output.css;
                document.head.appendChild(style);
            }, error => {
                // FIXME
                console.log(error);
            });
        }).catch(error => {
            if (error.response) {
                if (error.response.status === 401) {
                    // Unauthorized
                    tokenExpired(() => loadCustomCss());
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
        });
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
