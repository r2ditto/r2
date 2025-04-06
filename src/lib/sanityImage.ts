import imageUrlBuilder from "@sanity/image-url";
import type { SanityImageSource } from "@sanity/image-url/lib/types/types";
import { sanityClient } from "sanity:client";

// Initialize the image URL builder
const builder = imageUrlBuilder(sanityClient);

// Function to build image URLs
export function urlForImage(source: SanityImageSource) {
  return builder.image(source);
}
