import type { MetadataRoute } from "next";
import { getCanonicalUrl } from "../lib/seo";

const ROUTES: Array<{ path: string; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"]; priority: number }> = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/login", changeFrequency: "monthly", priority: 0.1 }
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return ROUTES.map(({ path, changeFrequency, priority }) => ({
    url: getCanonicalUrl(path),
    lastModified,
    changeFrequency,
    priority
  }));
}

