import "./globals.css";
import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { EntityProvider } from "@/lib/entity-context";

export const metadata: Metadata = {
  title: "Ledger — Finance Manager",
  description: "Income, expenses, deductions, invoicing & tax set-aside",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <EntityProvider>
          <div className="flex min-h-screen">
            <Nav />
            <main className="flex-1 p-8 max-w-[1400px]">{children}</main>
          </div>
        </EntityProvider>
      </body>
    </html>
  );
}
