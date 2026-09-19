import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: path.resolve('src/main/index.ts') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: path.resolve('src/preload/index.ts') } }
  },
  renderer: {
    root: path.resolve('src/renderer'),
    resolve: { alias: { '@renderer': path.resolve('src/renderer/src'), '@shared': path.resolve('src/shared') } },
    plugins: [react()]
  }
})
