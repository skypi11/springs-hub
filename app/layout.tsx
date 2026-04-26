import type { Metadata } from 'next';
import { Outfit, Bebas_Neue } from 'next/font/google';
import './globals.css';
import LayoutShell from '@/components/layout/LayoutShell';
import { AuthProvider } from '@/context/AuthContext';
import { ToastProvider } from '@/components/ui/Toast';
import { ConfirmProvider } from '@/components/ui/ConfirmModal';
import QueryProvider from '@/components/providers/QueryProvider';
import CommandPalette from '@/components/ui/CommandPalette';
import ProfileCompletionGate from '@/components/auth/ProfileCompletionGate';

const outfit = Outfit({
  variable: '--font-outfit',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800', '900'],
});

const bebasNeue = Bebas_Neue({
  variable: '--font-bebas',
  subsets: ['latin'],
  weight: '400',
});

export const metadata: Metadata = {
  title: 'Aedral — Plateforme Communautaire Esport',
  description: 'La plateforme communautaire esport pour structures et joueurs. Gère ta structure, suis les compétitions, rejoins la communauté. Springs E-Sport est partenaire privilégié.',
  // Le favicon est auto-géré par Next.js via app/icon.svg
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${outfit.variable} ${bebasNeue.variable} h-full`}>
      <body className="h-full flex" style={{ background: '#080808', color: '#f0f0f8' }}>
        <QueryProvider>
          <AuthProvider>
            <ToastProvider>
              <ConfirmProvider>
                <ProfileCompletionGate />
                <LayoutShell>{children}</LayoutShell>
                <CommandPalette />
              </ConfirmProvider>
            </ToastProvider>
          </AuthProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
