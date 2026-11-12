import "./globals.css";

export const metadata = {
  title: "Voltage Labs",
  description: "AI-powered social media strategy",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
