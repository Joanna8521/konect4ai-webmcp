import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Konect4AI x WebMCP",
  description: "Turn web data into agent-native tools.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
