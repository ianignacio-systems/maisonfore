import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The golfer app lives at /play on the same address as the partner portal (the Render test site).
export default defineConfig({ base: '/play/', plugins: [react()], server: { port: 5175 }, preview: { port: 5175 } });
