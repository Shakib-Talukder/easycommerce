import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "EasyCommerce", template: "%s · EasyCommerce" },
  description: "Online stores for Bangladeshi merchants.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="bn">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
