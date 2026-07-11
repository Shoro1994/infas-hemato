export const metadata = {
  title: "INFAS · Hémato — Préparation aux examens",
  description: "Plateforme de préparation aux examens d'hématologie INFAS.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
