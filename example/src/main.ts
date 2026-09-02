import { createApp } from 'vue'
import App from './App.vue'
import apollo from './config/apollo'
import './style.css'

const app = createApp(App)
app.use(apollo)
app.mount('#app')
