import "./globals.css";

export const metadata = {
  title: "High Voltage",
  description: "AI-powered social media strategy",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
