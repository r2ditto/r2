import { defineCollection, z } from "astro:content";

const notes = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    category: z.string().default("Field notes"),
    imageAlt: z.string().optional(),
    images: z.array(z.string()).min(1),
    draft: z.boolean().default(false),
  }),
});

export const collections = { notes };
