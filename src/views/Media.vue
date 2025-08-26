<!-- eslint-disable vue/multi-word-component-names -->
<template>
    <div id="media">
        <template v-if="notFound">
            <div class="not-found">
                <h1>File Not Found</h1>
                <p>The requested media file could not be found.</p>
            </div>
        </template>
        <template v-else-if="error">
            <div class="error">
                <h1>Error</h1>
                <p>{{ errorMessage }}</p>
            </div>
        </template>
        <template v-else-if="isLoading">
            <div class="loading">
                <v-progress-circular
                    indeterminate
                    color="primary"
                    size="64"
                />
                <p>Loading media...</p>
            </div>
        </template>
        <template v-else>
            <div class="media-container">
                <!-- Image viewer -->
                <template v-if="mediaType === 'image'">
                    <div class="image-viewer">
                        <img
                            v-bind:src="mediaUrl"
                            v-bind:alt="filename"
                            v-on:error="onMediaError"
                        >
                        <div class="media-info">
                            <h2>{{ filename }}</h2>
                            <p>{{ mimeType }}</p>
                        </div>
                    </div>
                </template>

                <!-- Video viewer -->
                <template v-else-if="mediaType === 'video'">
                    <div class="video-viewer">
                        <video
                            v-bind:src="mediaUrl"
                            controls
                            v-on:error="onMediaError"
                        >
                            Your browser does not support the video element.
                        </video>
                        <div class="media-info">
                            <h2>{{ filename }}</h2>
                            <p>{{ mimeType }}</p>
                        </div>
                    </div>
                </template>

                <!-- PDF viewer -->
                <template v-else-if="mediaType === 'pdf'">
                    <div class="pdf-viewer">
                        <object
                            v-bind:data="mediaUrl"
                            type="application/pdf"
                            width="100%"
                            height="800px"
                        >
                            <p>Your browser does not support embedded PDFs. <a v-bind:href="mediaUrl" target="_blank">Click here to view the PDF</a></p>
                        </object>
                        <div class="media-info">
                            <h2>{{ filename }}</h2>
                            <p>{{ mimeType }}</p>
                        </div>
                    </div>
                </template>

                <!-- Unsupported media type -->
                <template v-else>
                    <div class="unsupported">
                        <h2>Unsupported Media Type</h2>
                        <p>Cannot display media of type: {{ mimeType }}</p>
                        <p>File: {{ filename }}</p>
                        <a
                            v-bind:href="mediaUrl"
                            download
                        >Download File</a>
                    </div>
                </template>
            </div>
        </template>
    </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router/composables';
import * as api from '@/api';
import { getAxios } from '@/axios';

const apiFilesUrl = new URL('files/', new URL(import.meta.env.VITE_APP_API_URL!, window.location.href)).href;

// Emits
const emit = defineEmits<{
  (e: 'tokenExpired', callback: () => void): void;
}>();

// Composables
const route = useRoute();

// Reactive state
const isLoading = ref(true);
const notFound = ref(false);
const error = ref(false);
const errorMessage = ref('');
const mimeType = ref('');
const pdfBlobUrl = ref('');

// Computed properties
const filename = computed(() => {
  // In Vue Router 3, :path* creates route.params.path as an array or string
  // For /media/:path*, the parameter will be available as route.params.path
  return route.params.path || 'unknown';
});

const mediaUrl = computed(() => {
  // For PDFs, use the blob URL if available
  if (mediaType.value === 'pdf' && pdfBlobUrl.value) {
    return pdfBlobUrl.value;
  }
  // Construct the API endpoint URL for the media file
  // Using the same /files/ endpoint that serves file content
  return apiFilesUrl + filename.value;
});

const mediaType = computed(() => {
  if (mimeType.value.startsWith('image/')) {
    return 'image';
  } else if (mimeType.value.startsWith('video/')) {
    return 'video';
  } else if (mimeType.value === 'application/pdf') {
    return 'pdf';
  } else {
    return 'unknown';
  }
});

// Lifecycle hooks
onMounted(() => {
    if (typeof document !== 'undefined') {
        document.title = `${filename.value} | ${import.meta.env.VITE_APP_NAME}`;
    }
    loadMediaInfo();
});

onUnmounted(() => {
    // Clean up blob URL to prevent memory leaks
    if (pdfBlobUrl.value) {
        URL.revokeObjectURL(pdfBlobUrl.value);
    }
});

// Methods
async function loadMediaInfo() {
    try {
        isLoading.value = true;
        error.value = false;
        notFound.value = false;

        // First, get the file list to find MIME type information
        const listResponse = await api.listNotes();
        const fileEntry = listResponse.data.find((entry: any) => entry.path === filename.value); // eslint-disable-line @typescript-eslint/no-explicit-any

        if (!fileEntry) {
            notFound.value = true;
            return;
        }

        mimeType.value = fileEntry.mime_type;

        // Validate that this is actually a media file
        if (!isMediaFile(fileEntry.mime_type)) {
            error.value = true;
            errorMessage.value = `File type ${fileEntry.mime_type} is not supported for media viewing. Use the regular note viewer instead.`;
            return;
        }

        // For PDFs, fetch the content and convert to data URL
        if (fileEntry.mime_type === 'application/pdf') {
            await loadPdfContent();
        }

    } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (err.response?.status === 401) {
            emit('tokenExpired', () => loadMediaInfo());
        } else if (err.response?.status === 404) {
            notFound.value = true;
        } else {
            error.value = true;
            errorMessage.value = 'Failed to load media information';
        }
    } finally {
        isLoading.value = false;
    }
}

function isMediaFile(mimeType: string): boolean {
    return mimeType.startsWith('image/') ||
           mimeType.startsWith('video/') ||
           mimeType === 'application/pdf';
}

function onMediaError() {
    error.value = true;
    errorMessage.value = 'Failed to load media content';
}

async function loadPdfContent() {
    try {
        const axios = getAxios();
        const response = await axios.get(`/files/${filename.value}`, {
            responseType: 'arraybuffer'
        });

        // Convert the PDF arraybuffer to a blob URL
        const blob = new Blob([response.data], { type: 'application/pdf' });

        // Clean up previous blob URL if it exists
        if (pdfBlobUrl.value) {
            URL.revokeObjectURL(pdfBlobUrl.value);
        }

        // Create new blob URL
        pdfBlobUrl.value = URL.createObjectURL(blob);

    } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        console.error('Failed to load PDF content:', err);
        // Fall back to direct URL if blob URL fails
        pdfBlobUrl.value = '';
        throw err;
    }
}
</script>

<style scoped lang="scss">
#media {
  height: 100vh;
  display: flex;
  flex-direction: column;
}

.not-found,
.error,
.loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  padding: 2rem;
}

.media-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.image-viewer,
.video-viewer,
.pdf-viewer {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.image-viewer img {
  max-width: 100%;
  max-height: calc(100vh - 120px);
  object-fit: contain;
  margin: auto;
}

.video-viewer video {
  width: 100%;
  max-height: calc(100vh - 120px);
  margin: auto;
}

.pdf-viewer object {
  flex: 1;
  min-height: 800px;
}

.media-info {
  padding: 1rem;
  background: rgba(0, 0, 0, 0.05);
  border-top: 1px solid rgba(0, 0, 0, 0.1);
  text-align: center;

  h2 {
    margin: 0 0 0.5rem 0;
    font-size: 1.2em;
  }

  p {
    margin: 0;
    color: rgba(0, 0, 0, 0.6);
    font-size: 0.9em;
  }
}

.unsupported {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  padding: 2rem;

  a {
    margin-top: 1rem;
    padding: 0.5rem 1rem;
    background: #1976d2;
    color: white;
    text-decoration: none;
    border-radius: 4px;

    &:hover {
      background: #1565c0;
    }
  }
}
</style>
