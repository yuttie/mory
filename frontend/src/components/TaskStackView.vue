<template>
    <div class="stack-view">
        <div v-for="track of stackTracks" v-bind:key="track.rootId" class="stack-track">
            <div class="track-header">
                <h4>{{ track.rootTask.title || 'Untitled' }}</h4>
            </div>
            <div class="flame-chart">
                <div 
                    v-for="level of track.levels" 
                    v-bind:key="`level-${level.depth}`"
                    class="flame-level"
                    v-bind:style="{ marginLeft: `${level.depth * 20}px` }"
                >
                    <div 
                        v-for="task of level.tasks"
                        v-bind:key="task.uuid"
                        class="flame-bar"
                        v-bind:class="getTaskStatusClass(task)"
                        v-bind:style="getTaskBarStyle()"
                        v-on:click="onTaskClick(task.uuid)"
                        v-bind:title="task.title || 'Untitled'"
                    >
                        <span class="task-title">{{ task.title || 'Untitled' }}</span>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { type TreeNodeRecord } from '@/stores/taskForest';
import { type UUID } from '@/task';

// Types
interface FlameLevel {
    depth: number;
    tasks: TreeNodeRecord[];
}

interface StackTrack {
    rootId: UUID;
    rootTask: TreeNodeRecord;
    levels: FlameLevel[];
}

// Props
defineProps<{
    stackTracks: StackTrack[];
}>();

// Emits
const emit = defineEmits<{
    (e: 'task-click', taskUuid: UUID): void;
}>();

// Methods
function onTaskClick(taskUuid: UUID) {
    emit('task-click', taskUuid);
}

function getTaskStatusClass(task: TreeNodeRecord): string {
    const metadata = task.metadata as any;
    const status = metadata?.task?.status?.kind;
    return `status-${status || 'unknown'}`;
}

function getTaskBarStyle(): object {
    // Calculate width based on number of descendants
    const minWidth = 120;
    const width = 150; // Fixed width for now
    
    return {
        width: `${width}px`,
        minWidth: `${minWidth}px`,
    };
}
</script>

<style scoped lang="scss">
$space: 12px;

.stack-view {
    flex: 1 1 0;
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow-y: auto;
    padding: $space;
    gap: $space * 2;
}

.stack-track {
    display: flex;
    flex-direction: column;
    gap: $space / 2;
    margin-bottom: $space;
}

.track-header {
    h4 {
        margin: 0;
        font-weight: 600;
        color: rgba(0, 0, 0, 0.87);
        padding-bottom: 8px;
        border-bottom: 2px solid #e0e0e0;
    }
}

.flame-chart {
    display: flex;
    flex-direction: column;
    gap: 4px;
    position: relative;
}

.flame-level {
    display: flex;
    flex-direction: row;
    gap: 2px;
    flex-wrap: wrap;
}

.flame-bar {
    display: flex;
    align-items: center;
    padding: 6px 12px;
    border-radius: 4px;
    border: 1px solid rgba(0, 0, 0, 0.12);
    cursor: pointer;
    transition: all 0.2s ease;
    background: linear-gradient(135deg, #f5f5f5, #eeeeee);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    
    &:hover {
        transform: translateY(-1px);
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
    }

    .task-title {
        font-size: 0.875rem;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: rgba(0, 0, 0, 0.87);
    }
}

// Status-based coloring
.flame-bar.status-todo {
    background: linear-gradient(135deg, #e3f2fd, #bbdefb);
    border-color: #2196f3;
}

.flame-bar.status-in_progress {
    background: linear-gradient(135deg, #fff3e0, #ffcc80);
    border-color: #ff9800;
}

.flame-bar.status-waiting {
    background: linear-gradient(135deg, #f3e5f5, #ce93d8);
    border-color: #9c27b0;
}

.flame-bar.status-blocked {
    background: linear-gradient(135deg, #ffebee, #ffab91);
    border-color: #f44336;
}

.flame-bar.status-on_hold {
    background: linear-gradient(135deg, #f1f8e9, #c8e6c9);
    border-color: #4caf50;
}

.flame-bar.status-done {
    background: linear-gradient(135deg, #e8f5e8, #a5d6a7);
    border-color: #4caf50;
    opacity: 0.7;
}

.flame-bar.status-canceled {
    background: linear-gradient(135deg, #fafafa, #e0e0e0);
    border-color: #9e9e9e;
    opacity: 0.6;
}

/* Mobile responsive adjustments */
@media (max-width: 959px) { /* md breakpoint in Vuetify 2 */
    .stack-view {
        padding: $space / 2;
        gap: $space;
    }
    
    .flame-bar {
        padding: 4px 8px;
        min-width: 80px !important;
        
        .task-title {
            font-size: 0.75rem;
        }
    }
    
    .flame-level {
        margin-left: 0 !important;
        
        &[style*="margin-left"] {
            margin-left: calc(var(--level-depth, 0) * 10px) !important;
        }
    }
}
</style>