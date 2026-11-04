import { PORTS, slotPorts } from '@mwc/shared/ports';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Dev server on 9951 and preview on 9955 (docs/ports.md), both proxying the API paths to the server.
 * With MWC_PORT_SLOT=k the dev server and the API target are the slot's ports (9961+3k, 9960+3k).
 * MWC_API_URL overrides the API target (e.g. an API started elsewhere, or on another port).
 */
const slot = process.env.MWC_PORT_SLOT ? slotPorts(Number(process.env.MWC_PORT_SLOT)) : undefined;
const apiTarget = process.env.MWC_API_URL || `http://127.0.0.1:${slot?.api ?? PORTS.api}`;
const proxy = Object.fromEntries(
  ['/api', '/healthz', '/readyz'].map((path) => [path, { target: apiTarget }]),
);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: '127.0.0.1', port: slot?.web ?? PORTS.web, strictPort: true, proxy },
  preview: { host: '127.0.0.1', port: PORTS.webPreview, strictPort: true, proxy },
  build: { outDir: 'dist', emptyOutDir: true },
});
