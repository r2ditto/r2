import type { Metadata, Site, Socials } from "@types";

export const SITE: Site = {
  TITLE: "R2",
  DESCRIPTION: "Notes on frontend development",
  EMAIL: "ryan.ebro@yahoo.com",
  NUM_POSTS_ON_HOMEPAGE: 5,
  NUM_PROJECTS_ON_HOMEPAGE: 3,
};

export const HOME: Metadata = {
  TITLE: "Home",
  DESCRIPTION: "Astro Micro is an accessible theme for Astro.",
};

export const BLOG: Metadata = {
  TITLE: "Blog",
  DESCRIPTION: "A collection of articles on topics I am passionate about.",
};

export const PROJECTS: Metadata = {
  TITLE: "Projects",
  DESCRIPTION:
    "A collection of my projects with links to repositories and live demos.",
};

export const SOCIALS: Socials = [
  {
    NAME: "Bluesky",
    HREF: "https://bsky.app/profile/r-2.io",
  },
  {
    NAME: "GitHub",
    HREF: "https://github.com/r2ditto",
  },
  {
    NAME: "LinkedIn",
    HREF: "https://www.linkedin.com/in/ryanebro",
  },
  {
    NAME: "Instagram",
    HREF: "https://www.instagram.com/ryvnrey",
  },
];
