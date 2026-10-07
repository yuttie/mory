<!-- A titled group of task cards, as the task views draw a status, a day or a quadrant. The title
     stays in sight while the cards scroll beneath it. -->
<template>
    <section class="task-group">
        <header class="task-group-header">
            <div class="task-group-title">
                <slot name="title">
                    {{ title }}
                </slot>
            </div>
            <div
                v-if="subtitle"
                class="task-group-subtitle"
            >
                {{ subtitle }}
            </div>
            <slot name="header" />
        </header>
        <div class="task-group-body">
            <slot />
        </div>
    </section>
</template>

<script lang="ts" setup>
// Props
defineProps<{
    title?: string;
    subtitle?: string;
}>();
</script>

<style scoped lang="scss">
/* Sized by the view it is in. `min-*: 0` lets a grid cell or a flex line be smaller than the
   cards, so the body scrolls them rather than the group outgrowing its place. */
.task-group {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
}

/* Inset as far as the cards are, so the title lines up with them. */
.task-group-header {
    flex: none;
    padding-inline: 4px;
}

.task-group-title {
    font-size: 1.4em;
}

.task-group-subtitle {
    font-size: 0.875em;
    color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

/* The padding is room for the cards' shadows: a scroll container clips what it holds at its
   padding edge, so a card touching that edge loses the shadow on that side. */
.task-group-body {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 4px;
}
</style>
