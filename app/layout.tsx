import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "K7A2",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
