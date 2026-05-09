import { defineConfig } from 'vite';

export default defineConfig({
  // Use relative paths for built asset URLs so the bundle works regardless
  // of which subpath the static files are served from. GitHub Pages serves
  // this project at https://alex-enliven.github.io/lionn-night-prowler/,
  // a Python http.server serves it at http://localhost:5180/, and `file://`
  // serves it from disk — `base: './'` works for all three. The default
  // `/` produces absolute URLs like `/assets/index-XXX.js` which 404 on
  // any host that isn't at the root path.
  base: './',
  server: {
    port: 5180,
    host: true,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
