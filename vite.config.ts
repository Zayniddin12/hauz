import { defineConfig, loadEnv } from 'vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // Make .env (APPWRITE_* incl. the API key) visible to server code via process.env.
  // Nothing here is VITE_-prefixed or `define`d, so none of it reaches the client bundle.
  const env = loadEnv(mode, process.cwd(), '')
  for (const [key, value] of Object.entries(env)) {
    process.env[key] ??= value
  }

  return {
    resolve: { tsconfigPaths: true },
    plugins: [tanstackStart(), viteReact()],
  }
})
