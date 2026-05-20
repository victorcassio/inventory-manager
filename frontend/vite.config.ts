import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor':    ['react', 'react-dom', 'react-router-dom'],
          'query-vendor':    ['@tanstack/react-query'],
          'form-vendor':     ['react-hook-form', 'zod', '@hookform/resolvers'],
          'charts-vendor':   ['recharts'],
          'calendar-vendor': ['@fullcalendar/react', '@fullcalendar/daygrid', '@fullcalendar/list', '@fullcalendar/core'],
          'date-vendor':     ['date-fns'],
        },
      },
    },
  },
})
