# Introducing [Astro Micro 🔬](https://astro-micro.vercel.app/)

Astro Micro is an accessible theme for Astro. It's a fork of [Mark Horn's](https://github.com/markhorn-dev) popular theme [Astro Nano](https://astro-nano-demo.vercel.app/). Like Nano, Micro comes with zero frameworks installed.

Micro adds features like [Pagefind](https://pagefind.app) for search, [Giscus](https://giscus.app) for comments, and more. For a full list of changes, see this [blog post](https://astro-micro.vercel.app/blog/00-micro-changelog).

Micro still comes with everything great about Nano — full type safety, a sitemap, an RSS feed, and Markdown + MDX support. Styled with TailwindCSS and preconfigured with system, light, and dark themes.

## Local notes

Add posts as `.mdx` files in `src/content/notes/`. Each post needs `title`, `description`, `date`, and an `images` list; `category` and `draft` are optional. Put images in `public/gallery/` and reference them as `/gallery/filename.jpg`.

The homepage cube has 54 tiles. Each image from a published note appears once; the remaining tiles use muted colors. Clicking a photo tile opens its MDX post, which also has a page at `/notes/<filename>/`.

---

![astro-micro-image](https://github.com/trevortylerlee/astro-micro/assets/49603972/ec5bc96a-3e96-4af1-a182-7711b54c5ef6)
