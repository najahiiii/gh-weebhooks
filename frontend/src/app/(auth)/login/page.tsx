import type { Metadata } from "next";
import LoginPage from "./login-client";
import { getCanonicalUrl } from "../../../lib/seo";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Secure Telegram-based login for the GitHub → Telegram control center.",
  robots: {
    index: false,
    follow: false
  },
  alternates: {
    canonical: getCanonicalUrl("/login")
  },
  openGraph: {
    title: "Sign in",
    description: "Authenticate with Telegram to access the GitHub → Telegram control center.",
    url: getCanonicalUrl("/login")
  },
  twitter: {
    title: "Sign in",
    description: "Authenticate with Telegram to access the GitHub → Telegram control center."
  }
};

export default function LoginRoute() {
  return <LoginPage />;
}
