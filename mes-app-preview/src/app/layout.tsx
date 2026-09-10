import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import { TabsProvider } from "@/components/TabsProvider";
import TabBar from "@/components/TabBar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "메디오스 MES 프로토타입",
  description: "차세대 MES 1단계 프로토타입 (작업지시발행 · POP실적입력 · 실시간재고반영)",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex bg-background text-foreground">
        <TabsProvider>
          <Sidebar />
          <main className="flex-1 w-full min-w-0 flex flex-col min-h-screen">
            <TabBar />
            <div className="flex-1 min-w-0 min-h-0">{children}</div>
          </main>
        </TabsProvider>
      </body>
    </html>
  );
}
