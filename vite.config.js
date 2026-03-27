import { defineConfig } from 'vite';
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

// Plugin that re-extracts data on every request to /data.json
function liveDataPlugin() {
  return {
    name: 'live-data',
    configureServer(server) {
      server.middlewares.use('/data.json', (req, res, next) => {
        try {
          // Re-run extraction
          execSync('node scripts/extract-data.js', {
            cwd: path.resolve('.'),
            timeout: 15000,
            stdio: 'pipe',
          });
          const dataPath = path.resolve('public/data.json');
          if (existsSync(dataPath)) {
            const data = readFileSync(dataPath, 'utf-8');
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-cache');
            res.end(data);
          } else {
            next();
          }
        } catch (e) {
          // Fall back to static file
          next();
        }
      });
    },
  };
}

export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [liveDataPlugin()],
  server: {
    port: 3000,
    open: true
  },
  build: {
    outDir: 'dist'
  }
});
