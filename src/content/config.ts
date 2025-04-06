import { z } from "astro:content";

export const sanitySchema = z.object({
  title: z.string(),
  slug: z.string(),
  date: z.date(),
  image: z
    .object({
      asset: z.object({
        _ref: z.string(),
      }),
    })
    .optional(),
  body: z.array(z.any()).optional(),
});

export type SanityPost = z.infer<typeof sanitySchema>;
