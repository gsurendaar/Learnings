"use client";

export default function FeaturesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Credential gate is now at root level (CredentialGate in ThemeProvider)
  // This layout just passes children through
  return <>{children}</>;
}
