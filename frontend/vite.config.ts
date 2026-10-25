import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const target = loadEnv(mode, '.', 'NESTWISE_').NESTWISE_API_PROXY_TARGET || 'http://127.0.0.1:8001'
  const address = new URL(target)
  if (address.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(address.hostname) || !address.port || address.pathname !== '/' || address.search || address.hash) {
    throw new Error('NESTWISE_API_PROXY_TARGET must be a local http://127.0.0.1:<port> or http://localhost:<port> origin')
  }
  return {
    plugins: [react()],
    server: { proxy: { '/api': target } },
  }
})
