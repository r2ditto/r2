import sanity from "@sanity/astro";

import react from "@astrojs/react";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import pagefind from "astro-pagefind";
import tailwind from "@astrojs/tailwind";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  site: "https://astro-micro.vercel.app",
  integrations: [
    tailwind(),
    sitemap(),
    mdx(),
    pagefind(),
    sanity({
      projectId: "dlra7hh7",
      dataset: "production",
      useCdn: false,
    }),
    react(),
  ],
  markdown: {
    shikiConfig: {
      theme: "css-variables",
    },
  },
});
