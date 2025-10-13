import type { Metadata } from "next";
import StatsPage from "./stats-client";
import { getCanonicalUrl } from "../../../lib/seo";

export const metadata: Metadata = {
  title: "Stats",
  description: "Insights into users, destinations, subscriptions, and webhook delivery health.",
  robots: {
    index: false,
    follow: false
  },
  alternates: {
    canonical: getCanonicalUrl("/stats")
  },
  openGraph: {
    title: "Stats",
    description: "Track GitHub → Telegram delivery metrics and recent webhook events.",
    url: getCanonicalUrl("/stats")
  },
  twitter: {
    title: "Stats",
    description: "Track GitHub → Telegram delivery metrics and recent webhook events."
  }
};

export default function StatsRoute() {
  return <StatsPage />;
}

