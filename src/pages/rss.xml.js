import rss from "@astrojs/rss";
import { SITE } from "@consts";
import { getCollection } from "astro:content";

export async function GET(context) {
  const posts = (await getCollection("notes", ({ data }) => !data.draft)).sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf(),
  );

  return rss({
    title: SITE.TITLE,
    description: SITE.DESCRIPTION,
    site: context.site,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.date,
      link: `/notes/${post.slug}/`,
    })),
  });
}
