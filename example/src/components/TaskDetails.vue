<script setup lang="ts">
import { useGetTaskQuery } from '../graphql/generated'

const props = defineProps<{ taskId: string }>()

const { result, loading, error } = useGetTaskQuery(
  () => ({ id: props.taskId }),
  () => ({ enabled: Boolean(props.taskId) }),
)
</script>

<template>
  <aside class="details">
    <p class="eyebrow">QUERY WITH VARIABLES</p>
    <template v-if="!taskId">
      <p class="muted">Select a task to run <code>GetTask($id)</code>.</p>
    </template>
    <p v-else-if="loading">Loading selected task…</p>
    <p v-else-if="error" class="notice error">{{ error.message }}</p>
    <template v-else-if="result?.task">
      <h3>{{ result.task.title }}</h3>
      <pre>{{ result.task }}</pre>
    </template>
  </aside>
</template>
