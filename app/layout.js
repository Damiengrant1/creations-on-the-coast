import AuthGate from "./AuthGate";

export const metadata = {
  title: "Creations on the Coast",
  description: "Business management system",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
