const FALLBACK_SITE_URL = "http://localhost:3000";

const sanitizedEnvUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

const siteUrl = sanitizedEnvUrl && /^https?:\/\//i.test(sanitizedEnvUrl) ? sanitizedEnvUrl : FALLBACK_SITE_URL;

export const siteConfig = {
  name: "GitHub → Telegram",
  shortName: "GH → TG",
  tagline: "GitHub → Telegram bridge",
  description: "Self-hosted control center that forwards GitHub repository activity into Telegram chats with secure tooling.",
  keywords: [
    "GitHub",
    "Telegram",
    "webhooks",
    "bridge",
    "notifications",
    "DevOps",
    "automation",
    "self-hosted",
    "dashboard"
  ],
  authors: [{ name: "Najahi" }],
  creator: "Najahi",
  publisher: "GitHub → Telegram",
  openGraphImage: "/og-image.png",
  locale: "en_US",
  siteUrl
};

export function getMetadataBase(): URL {
  return new URL(siteUrl);
}

export function getCanonicalUrl(pathname: string): string {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return new URL(normalizedPath, siteUrl).toString();
}

