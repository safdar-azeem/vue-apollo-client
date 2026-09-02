<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAuth } from 'vue-apollo-client'
import LoginCard from './components/LoginCard.vue'
import SessionCard from './components/SessionCard.vue'
import TaskCreateForm from './components/TaskCreateForm.vue'
import TaskList from './components/TaskList.vue'

const auth = useAuth()
const ready = ref(false)
const bootError = ref('')

const userName = computed(() => auth.user.value?.name || 'Guest')

onMounted(async () => {
  try {
    await auth.verifySession()
  } catch (error) {
    bootError.value = error instanceof Error ? error.message : 'Session verification failed.'
  } finally {
    ready.value = true
  }
})
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div>
        <strong>vue-apollo-client</strong>
        <span class="muted">small real example</span>
      </div>
      <span class="user-pill">{{ userName }}</span>
    </header>

    <main class="container">
      <section class="hero">
        <p class="eyebrow">QUERY · MUTATION · AUTH · CRUD</p>
        <h1>Learn the package from a real app.</h1>
        <p>
          Login, load tasks, create one, edit it, toggle it, delete it, and inspect
          the GraphQL files beside the components doing the work.
        </p>
      </section>

      <p v-if="bootError" class="notice error">{{ bootError }}</p>
      <div v-if="!ready" class="card">Checking saved session…</div>

      <template v-else-if="!auth.isAuthenticated.value">
        <LoginCard />
      </template>

      <template v-else>
        <div class="grid two-column">
          <SessionCard />
          <TaskCreateForm />
        </div>
        <TaskList />
      </template>
    </main>
  </div>
</template>
