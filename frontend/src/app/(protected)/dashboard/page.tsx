import type { Metadata } from "next";
import DashboardPage from "./dashboard-client";
import { getCanonicalUrl } from "../../../lib/seo";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Control center to register Telegram bots, destinations, and GitHub webhook subscriptions.",
  robots: {
    index: false,
    follow: false
  },
  alternates: {
    canonical: getCanonicalUrl("/dashboard")
  },
  openGraph: {
    title: "Dashboard",
    description: "Administer Telegram bots, chat destinations, and GitHub webhook integrations.",
    url: getCanonicalUrl("/dashboard")
  },
  twitter: {
    title: "Dashboard",
    description: "Administer Telegram bots, chat destinations, and GitHub webhook integrations."
  }
};

export default function DashboardRoute() {
  return <DashboardPage />;
}

