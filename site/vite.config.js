import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { head, nav, foot, video } from './src/partials.js'

const pages = { home: '/', how: '/how/', proof: '/proof/', install: '/install/' }

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 600, // three.js is one lazy chunk, loaded only on Home
    rollupOptions: { input: Object.fromEntries(Object.entries(pages).map(([k, p]) => [k, resolve(import.meta.dirname, `.${p}index.html`)])) },
  },
  plugins: [{
    // Shared nav, footer and the optional video go into the HTML itself, so crawlers and no-JS readers get them.
    name: 'partials',
    transformIndexHtml(html, ctx) {
      const route = ctx.path.replace(/index\.html$/, '')
      return html.replace('<!--head-->', head(route)).replace('<!--nav-->', nav(route)).replace('<!--foot-->', foot()).replace('<!--video-->', video())
    },
  }],
})
