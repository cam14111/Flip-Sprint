/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

// Relative base so the built site works under ANY sub-path (any GitHub Pages
// project URL, whatever the repo is named) with no code change. Renaming the
// repository therefore never breaks the deployment. Dev server stays at root.
export default defineConfig(({ mode }) => ({
  base: mode === "production" ? "./" : "/",
  server: {
    host: "::",
    port: 8080,
  },
  optimizeDeps: {
    // The Firebase SDK is only reached through a dynamic import (online mode).
    // Pre-bundle it so the dev server doesn't discover it mid-session and force
    // a full page reload — which would tear down a live race.
    include: ["firebase/app", "firebase/auth", "firebase/database"],
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "apple-touch-icon.png", "favicon-32x32.png"],
      manifest: {
        name: "Flip Sprint",
        short_name: "Flip Sprint",
        description:
          "Jeu de cartes : pousse ta chance jusqu'à la ligne d'arrivée. Solo, local ou en ligne — fonctionne hors-ligne.",
        lang: "fr",
        // Same colour as html's background and the theme-color meta tag: the
        // top of the track gradient, so nothing the OS paints around the app
        // reads as a black band. See the comment in src/index.css.
        theme_color: "#251056",
        background_color: "#251056",
        // Fullscreen hides the system status/navigation bars on an installed
        // PWA (Android) to maximise the play surface; standalone is the
        // graceful fallback where fullscreen isn't honoured.
        display: "fullscreen",
        display_override: ["fullscreen", "standalone"],
        orientation: "portrait",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
}));
