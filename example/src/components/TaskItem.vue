<script setup lang="ts">
import { ref, watch } from 'vue'
import { useAuth } from 'vue-apollo-client'
import {
  type Task,
  useDeleteTaskMutation,
  useUpdateTaskMutation,
} from '../graphql/generated'

const props = defineProps<{
  task: Task
  selected: boolean
}>()

const emit = defineEmits<{
  select: []
  deleted: []
}>()

const auth = useAuth()
const { mutate: updateTask } = useUpdateTaskMutation()
const { mutate: deleteTask } = useDeleteTaskMutation()

const editing = ref(false)
const title = ref(props.task.title)
const busy = ref(false)

watch(() => props.task.title, value => {
  if (!editing.value) title.value = value
})

const mutationOptions = {
  refetchQueries: ['GetTasks'],
  awaitRefetchQueries: true,
}

const toggleDone = async () => {
  if (!auth.can('tasks:write')) return
  busy.value = true
  try {
    await updateTask({ id: props.task.id, done: !props.task.done }, mutationOptions)
  } finally {
    busy.value = false
  }
}

const saveTitle = async () => {
  const nextTitle = title.value.trim()
  if (!nextTitle || !auth.can('tasks:write')) return
  busy.value = true
  try {
    await updateTask({ id: props.task.id, title: nextTitle }, mutationOptions)
    editing.value = false
  } finally {
    busy.value = false
  }
}

const remove = async () => {
  if (!auth.can('tasks:delete')) return
  if (!window.confirm(`Delete “${props.task.title}”?`)) return
  busy.value = true
  try {
    await deleteTask({ id: props.task.id }, mutationOptions)
    emit('deleted')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <article class="task" :class="{ selected }">
    <button class="check" :disabled="busy" type="button" @click="toggleDone">
      {{ task.done ? '✓' : '○' }}
    </button>

    <div class="task-main" @click="$emit('select')">
      <template v-if="editing">
        <input v-model="title" class="inline-input" @click.stop @keyup.enter="saveTitle" />
      </template>
      <template v-else>
        <strong :class="{ done: task.done }">{{ task.title }}</strong>
        <small>{{ task.id }}</small>
      </template>
    </div>

    <div class="task-actions">
      <template v-if="editing">
        <button class="small" :disabled="busy" type="button" @click="saveTitle">Save</button>
        <button class="small secondary" type="button" @click="editing = false; title = task.title">Cancel</button>
      </template>
      <template v-else>
        <button class="small secondary" :disabled="busy" type="button" @click="editing = true">Edit</button>
        <button class="small danger-outline" :disabled="busy" type="button" @click="remove">Delete</button>
      </template>
    </div>
  </article>
</template>
