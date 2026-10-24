import type { Metadata } from "next";
import "./globals.css";
import { ClinicProvider } from '@/components/clinic-context';

export const metadata: Metadata = { title: "DentaFlow", description: "Dental scheduling and patient follow-up management" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><ClinicProvider>{children}</ClinicProvider></body></html>;
}
