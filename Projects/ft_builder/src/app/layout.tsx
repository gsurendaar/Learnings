import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "antd/dist/reset.css";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { InitializationProvider } from "@/components/InitializationContext";
import { UserProvider } from "@/components/UserContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GitLogs - Professional Git Analytics",
  description: "Professional git repository analytics and insights",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <UserProvider>
          <InitializationProvider>
            <ThemeProvider>
              {children}
            </ThemeProvider>
          </InitializationProvider>
        </UserProvider>
      </body>
    </html>
  );
}
