import "./globals.css";
import AuthGate from "./AuthGate";
import PwaRegistration from "./PwaRegistration";

export const metadata = {
  title: "Creations on the Coast",
  description: "Business management system",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Coast POS",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport = {
  themeColor: "#12324a",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <PwaRegistration />
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
