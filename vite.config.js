import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Dev-only proxy so the browser can read YouTube search results
      // (bypasses CORS). We parse the first videoId out of the HTML and then
      // embed by ID — the old `listType=search` embed was deprecated by YouTube
      // and now shows "This video is unavailable".
      '/yt-search': {
        target: 'https://www.youtube.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/yt-search/, '/results'),
        headers: { 'Accept-Language': 'en-US,en;q=0.9' },
      },
    },
  },
})
