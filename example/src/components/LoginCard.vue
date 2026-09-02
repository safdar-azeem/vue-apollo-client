<script setup lang="ts">
import { ref } from 'vue'
import { useAuth } from 'vue-apollo-client'
import { useLoginMutation } from '../graphql/generated'

const auth = useAuth()
const { mutate: loginMutation } = useLoginMutation()

const email = ref('demo@example.com')
const password = ref('password123')
const submitting = ref(false)
const errorMessage = ref('')

const login = async () => {
  errorMessage.value = ''
  submitting.value = true

  try {
    const result = await loginMutation({
      email: email.value,
      password: password.value,
    })

    const session = result?.data?.login
    if (!session?.token) throw new Error('Login did not return a session.')

    await auth.setSession({
      token: session.token,
      refreshToken: session.refreshToken,
      user: session.user,
    })

    const authenticated = await auth.verifySession()
    if (!authenticated) throw new Error('The new session could not be verified.')
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Login failed.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <section class="card narrow-card">
    <p class="eyebrow">AUTHENTICATION</p>
    <h2>Login</h2>
    <p class="muted">The form uses a generated mutation, then hands the returned session to <code>useAuth()</code>.</p>

    <form class="form-stack" @submit.prevent="login">
      <label>
        Email
        <input v-model="email" type="email" autocomplete="username" />
      </label>
      <label>
        Password
        <input v-model="password" type="password" autocomplete="current-password" />
      </label>
      <button :disabled="submitting" type="submit">
        {{ submitting ? 'Signing in…' : 'Login' }}
      </button>
    </form>

    <p v-if="errorMessage" class="notice error">{{ errorMessage }}</p>
    <p class="hint">Demo: <strong>demo@example.com</strong> / <strong>password123</strong></p>
  </section>
</template>
