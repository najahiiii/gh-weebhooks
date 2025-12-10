import { getCanonicalUrl, siteConfig } from "@/lib/seo";
import type { Metadata } from "next";
import LandingPage from "./_components/landing-page-client";

export const metadata: Metadata = {
  title: siteConfig.tagline,
  description: siteConfig.description,
  alternates: {
    canonical: getCanonicalUrl("/"),
  },
  openGraph: {
    title: siteConfig.tagline,
    description: siteConfig.description,
  },
  twitter: {
    title: siteConfig.tagline,
    description: siteConfig.description,
  },
};

export default function HomePage() {
  return <LandingPage />;
}
