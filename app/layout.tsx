import type { Metadata } from 'next';
import { Outfit, Bebas_Neue } from 'next/font/google';
import './globals.css';
import Sidebar from '@/components/layout/Sidebar';
import { AuthProvider } from '@/context/AuthContext';

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
  title: 'Springs E-Sport — Hub Communautaire',
  description: 'La plateforme officielle de Springs E-Sport. Gère ta structure, suis les compétitions, rejoins la communauté.',
  icons: { icon: '/springs-logo.png' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${outfit.variable} ${bebasNeue.variable} h-full`}>
      <body className="h-full flex" style={{ background: '#07070f', color: '#f0f0f8' }}>
        <AuthProvider>
          <Sidebar />
          <div className="flex-1 ml-[260px] min-h-screen overflow-x-hidden">
            {children}
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
