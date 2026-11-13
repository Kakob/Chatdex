import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const cert = command === 'serve' ? env.DEV_HTTPS_CERT : undefined
  const key = command === 'serve' ? env.DEV_HTTPS_KEY : undefined
  if (Boolean(cert) !== Boolean(key)) {
    throw new Error('Set both DEV_HTTPS_CERT and DEV_HTTPS_KEY to enable trusted HTTPS.')
  }
  const apiUrl = env.VITE_API_URL?.trim()
  const backend = env.DEV_API_TARGET ||
    (apiUrl && /^https?:\/\//.test(apiUrl) ? apiUrl.replace(/\/+$/, '').replace(/\/api$/, '') : 'http://localhost:3003')

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: env.DEV_HOSTNAME ? '0.0.0.0' : undefined,
      port: 4000,
      // WebAuthn verifies the exact origin, including the port.
      strictPort: true,
      allowedHosts: env.DEV_HOSTNAME ? [env.DEV_HOSTNAME] : undefined,
      https: cert && key ? { cert: readFileSync(cert), key: readFileSync(key) } : undefined,
      proxy: {
        '/api': { target: backend, changeOrigin: true },
      },
    },
  }
})
