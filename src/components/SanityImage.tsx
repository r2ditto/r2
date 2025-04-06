import { urlForImage } from "@lib/sanityImage";
import type { SanityImageSource } from "@sanity/image-url/lib/types/types";

export default function SanityImage({ value }: { value: any }) {
  const { asset, alt, caption } = value;

  if (!asset) {
    return null;
  }

  return (
    <figure>
      <img
        src={urlForImage(asset).url()}
        alt={alt || "Blog post image"}
        loading="lazy"
        className="rounded-lg"
      />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}
