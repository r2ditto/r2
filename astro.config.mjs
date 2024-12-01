import tailwind from "@astrojs/tailwind";
import storyblok from "@storyblok/astro";
import { defineConfig } from "astro/config";
import { loadEnv } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
const env = loadEnv("", process.cwd(), "STORYBLOK");
import react from "@astrojs/react";

import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import pagefind from "astro-pagefind";

import react from "@astrojs/react";

// https://astro.build/config
export default defineConfig({
  site: "https://astro-micro.vercel.app",
  integrations: [
    tailwind(),
    sitemap(),
    mdx(),
    // storyblok({ accessToken: env.STORYBLOK_TOKEN }),
    pagefind(),
    react(),
  ],
  markdown: {
    shikiConfig: {
      theme: "css-variables",
    },
  },
  vite: {
    // plugins: [basicSsl()],
    // server: {
    //   https: true,
    // },
  },
});
