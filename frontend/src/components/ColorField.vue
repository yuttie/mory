<template>
    <v-text-field
        v-bind:label="label"
        v-bind:model-value="modelValue"
        v-bind:placeholder="fallback"
        persistent-placeholder
        v-on:update:model-value="emit('update:modelValue', $event)"
    >
        <template v-slot:prepend-inner>
            <v-menu
                v-bind:close-on-content-click="false"
                location="bottom start"
            >
                <template v-slot:activator="{ props: activator }">
                    <!-- A button rather than a plain swatch, so the picker is reachable by
                         keyboard like every other control in the dialog. -->
                    <v-btn
                        v-bind="activator"
                        v-bind:color="resolved"
                        class="swatch"
                        icon
                        size="x-small"
                        title="Pick a colour"
                        variant="flat"
                    ></v-btn>
                </template>
                <v-color-picker
                    v-bind:model-value="resolved"
                    v-bind:modes="['hex']"
                    mode="hex"
                    show-swatches
                    swatches-max-height="12em"
                    v-on:update:model-value="emit('update:modelValue', $event)"
                ></v-color-picker>
            </v-menu>
        </template>
    </v-text-field>
</template>

<script lang="ts" setup>
// A colour, typed or picked.
//
// The text stays authoritative: `color:` in a note and in `.mory/calendars.yaml` is free text, and
// the picker can only express what it can parse -- a Vuetify palette name like `blue`, which the
// views accept, survives being shown beside a picker that does not understand it.
//
// An empty value means "whatever the caller falls back to", so the picker opens on `fallback`
// rather than on nothing. Picking then writes that colour explicitly; clearing the field is how
// the default comes back.

import { computed } from 'vue';

const props = defineProps<{
    // Optional, so a draft field that has not been filled in yet can be bound directly.
    modelValue?: string;
    label: string;
    /// The colour used when the field is left empty, shown as its placeholder and swatch.
    fallback: string;
}>();

const emit = defineEmits<{
    (e: 'update:modelValue', value: string): void;
}>();

const resolved = computed(() => props.modelValue?.trim() || props.fallback);
</script>

<style scoped lang="scss">
.swatch {
    // Set off from the text it precedes, so the field reads as a swatch and a value.
    margin-inline-end: 0.5rem;
}
</style>
