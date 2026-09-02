<script setup lang="ts">
import { ref } from 'vue'
import { useAuth } from 'vue-apollo-client'

const auth = useAuth()
const message = ref('')

const verify = async () => {
  message.value = 'Verifying…'
  try {
    message.value = (await auth.verifySession()) ? 'Session is valid.' : 'Session is not valid.'
  } catch (error) {
    message.value = error instanceof Error ? error.message : 'Verification failed.'
  }
}

const logout = async () => {
  await auth.logout()
}
</script>

<template>
  <section class="card">
    <p class="eyebrow">SHARED AUTH STATE</p>
    <h2>Session</h2>

    <dl class="data-list">
      <div><dt>User</dt><dd>{{ auth.user.value?.name }}</dd></div>
      <div><dt>Email</dt><dd>{{ auth.user.value?.email }}</dd></div>
      <div><dt>Authenticated</dt><dd>{{ auth.isAuthenticated.value }}</dd></div>
      <div><dt>Can write</dt><dd>{{ auth.can('tasks:write') }}</dd></div>
      <div><dt>Can delete</dt><dd>{{ auth.can('tasks:delete') }}</dd></div>
    </dl>

    <div class="button-row">
      <button class="secondary" type="button" @click="verify">Verify session</button>
      <button class="danger-outline" type="button" @click="logout">Logout</button>
    </div>
    <p v-if="message" class="hint">{{ message }}</p>
  </section>
</template>
