import type { GalleryItem } from "@lib/timeline-gallery";
import type { CollectionEntry } from "astro:content";

// Each post can supply several images. Each image receives one cube tile.
export function galleryFromPosts(posts: CollectionEntry<"notes">[]): GalleryItem[] {
  return posts.flatMap((post) =>
    post.data.images.map((src) => ({
      src,
      kind: "image" as const,
      caption: post.data.category,
      title: post.data.title,
      text: post.data.description,
      postSlug: post.slug,
      imageAlt: post.data.imageAlt,
    })),
  );
}
