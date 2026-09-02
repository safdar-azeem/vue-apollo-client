<script setup lang="ts">
import { ref } from 'vue'
import { useAuth } from 'vue-apollo-client'
import { useCreateTaskMutation } from '../graphql/generated'

const auth = useAuth()
const { mutate: createTask } = useCreateTaskMutation()

const title = ref('')
const submitting = ref(false)
const errorMessage = ref('')

const submit = async () => {
  const value = title.value.trim()
  if (!value || !auth.can('tasks:write')) return

  submitting.value = true
  errorMessage.value = ''
  try {
    await createTask(
      { title: value },
      { refetchQueries: ['GetTasks'], awaitRefetchQueries: true },
    )
    title.value = ''
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Could not create task.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <section class="card">
    <p class="eyebrow">CREATE MUTATION</p>
    <h2>Create task</h2>
    <form class="form-stack" @submit.prevent="submit">
      <label>
        Title
        <input v-model="title" placeholder="Example: inspect TaskItem.vue" />
      </label>
      <button :disabled="submitting || !title.trim() || !auth.can('tasks:write')" type="submit">
        {{ submitting ? 'Creating…' : 'Create task' }}
      </button>
    </form>
    <p v-if="errorMessage" class="notice error">{{ errorMessage }}</p>
  </section>
</template>
