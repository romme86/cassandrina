import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cassandrina — Bitcoin Trading Bot",
  description: "Gamified Bitcoin trading bot dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-gray-100 min-h-screen">
        <nav className="border-b border-gray-800 px-6 py-4 flex gap-6 items-center">
          <span className="font-bold text-orange-400 text-lg">⚡ Cassandrina</span>
          <a href="/" className="text-sm text-gray-300 hover:text-white">Dashboard</a>
          <a href="/users" className="text-sm text-gray-300 hover:text-white">Users</a>
          <a href="/predictions" className="text-sm text-gray-300 hover:text-white">Predictions</a>
          <a href="/config" className="text-sm text-gray-300 hover:text-white">Config</a>
        </nav>
        <main className="p-6">{children}</main>
      </body>
    </html>
  );
}
