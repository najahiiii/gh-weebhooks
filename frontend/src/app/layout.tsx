import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { cn } from "../lib/utils";
import { Toaster } from "../components/ui/sonner";
import "./globals.css";
import { getMetadataBase, siteConfig } from "../lib/seo";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: getMetadataBase(),
  title: {
    default: siteConfig.name,
    template: `%s | ${siteConfig.name}`
  },
  description: siteConfig.description,
  keywords: siteConfig.keywords,
  applicationName: siteConfig.name,
  authors: siteConfig.authors,
  creator: siteConfig.creator,
  publisher: siteConfig.publisher,
  alternates: {
    canonical: siteConfig.siteUrl
  },
  openGraph: {
    type: "website",
    locale: siteConfig.locale,
    url: siteConfig.siteUrl,
    siteName: siteConfig.name,
    title: siteConfig.tagline,
    description: siteConfig.description,
    images: [
      {
        url: siteConfig.openGraphImage,
        width: 1200,
        height: 630,
        alt: siteConfig.tagline
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: siteConfig.tagline,
    description: siteConfig.description,
    images: [siteConfig.openGraphImage]
  },
  category: "Developer Tools",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true
    }
  }
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={cn("min-h-screen bg-background text-foreground font-sans", inter.className)}>
        <div className="relative min-h-screen overflow-hidden">
          <div className="relative z-10 min-h-screen">{children}</div>
        </div>
        <Toaster />
      </body>
    </html>
  );
}
