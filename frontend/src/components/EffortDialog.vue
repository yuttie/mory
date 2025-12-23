<template>
    <v-dialog
        v-bind:value="value"
        v-on:input="$emit('input', $event)"
        max-width="500px"
        persistent
    >
        <v-card>
            <v-card-title>
                <span class="text-h5">Task Action</span>
            </v-card-title>
            <v-card-text>
                <div class="mb-3">
                    <p>What would you like to do with <strong>{{ taskTitle }}</strong>?</p>
                    <p class="text-caption text--secondary">
                        Scheduled for: {{ scheduledDate }}
                    </p>
                </div>
                
                <v-radio-group v-model="selectedAction" class="mt-3">
                    <v-radio
                        label="Mark task as done"
                        value="done"
                    />
                    <v-radio
                        label="Log effort for this day"
                        value="effort"
                    />
                </v-radio-group>

                <div v-if="selectedAction === 'effort'" class="mt-4">
                    <v-textarea
                        v-model="effortDescription"
                        label="What did you work on?"
                        placeholder="Describe what you accomplished today..."
                        rows="3"
                        outlined
                        required
                    />
                    
                    <v-text-field
                        v-model.number="effortHours"
                        label="Hours spent (optional)"
                        type="number"
                        step="0.5"
                        min="0"
                        max="24"
                        outlined
                    />
                </div>
            </v-card-text>
            
            <v-card-actions>
                <v-spacer />
                <v-btn
                    text
                    v-on:click="onCancel"
                >
                    Cancel
                </v-btn>
                <v-btn
                    color="primary"
                    v-bind:disabled="!canConfirm"
                    v-on:click="onConfirm"
                >
                    {{ selectedAction === 'done' ? 'Mark as Done' : 'Log Effort' }}
                </v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script lang="ts" setup>
import { ref, computed, watch } from 'vue';
import type { Effort } from '@/task';

// Props
const props = defineProps<{
    value: boolean;
    taskTitle: string;
    scheduledDate: string;
}>();

// Emits
const emit = defineEmits<{
    (e: 'input', value: boolean): void;
    (e: 'done'): void;
    (e: 'effort', effort: Effort): void;
}>();

// Reactive state
const selectedAction = ref<'done' | 'effort'>('done');
const effortDescription = ref('');
const effortHours = ref<number | null>(null);

// Computed properties
const canConfirm = computed<boolean>(() => {
    if (selectedAction.value === 'done') {
        return true;
    }
    return effortDescription.value.trim() !== '';
});

// Methods
function onCancel(): void {
    emit('input', false);
    resetForm();
}

function onConfirm(): void {
    if (selectedAction.value === 'done') {
        emit('done');
    } else {
        const effort: Effort = {
            date: props.scheduledDate,
            description: effortDescription.value.trim(),
            ...(effortHours.value !== null && effortHours.value > 0 ? { hours: effortHours.value } : {}),
            created_at: new Date().toISOString(),
        };
        emit('effort', effort);
    }
    emit('input', false);
    resetForm();
}

function resetForm(): void {
    selectedAction.value = 'done';
    effortDescription.value = '';
    effortHours.value = null;
}

// Watch for dialog open to reset state
watch(() => props.value, (isOpen) => {
    if (isOpen) {
        resetForm();
    }
});
</script>