import { getCanonicalUrl, siteConfig } from "@/lib/seo";
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const sitemapUrl = getCanonicalUrl("/sitemap.xml");
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/"],
        disallow: ["/dashboard", "/stats"]
      }
    ],
    sitemap: sitemapUrl,
    host: siteConfig.siteUrl
  };
}

