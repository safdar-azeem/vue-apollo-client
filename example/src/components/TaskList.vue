<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGetTasksQuery } from '../graphql/generated'
import TaskDetails from './TaskDetails.vue'
import TaskItem from './TaskItem.vue'

const { result, loading, error, refetch } = useGetTasksQuery()
const selectedTaskId = ref('')

const tasks = computed(() => result.value?.tasks || [])
</script>

<template>
  <section class="card task-section">
    <div class="section-heading">
      <div>
        <p class="eyebrow">LIST QUERY + UPDATE + DELETE</p>
        <h2>Tasks</h2>
      </div>
      <button class="secondary" type="button" @click="refetch()">Refetch</button>
    </div>

    <p v-if="loading">Loading tasks…</p>
    <p v-else-if="error" class="notice error">{{ error.message }}</p>
    <p v-else-if="!tasks.length" class="muted">No tasks yet.</p>

    <div v-else class="task-list">
      <TaskItem
        v-for="task in tasks"
        :key="task.id"
        :task="task"
        :selected="selectedTaskId === task.id"
        @select="selectedTaskId = task.id"
        @deleted="selectedTaskId === task.id && (selectedTaskId = '')"
      />
    </div>

    <TaskDetails :task-id="selectedTaskId" />
  </section>
</template>
