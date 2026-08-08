import ManiaCupNav from '@/components/mania-cup/ManiaCupNav';

// Toutes les pages de la Springs Mania Cup partagent la même navigation
// d'événement. Elle donne à l'ensemble une identité propre — l'organisateur est
// Springs E-Sport, Aedral n'est que l'hébergeur — et surtout elle rend visible
// l'espace du joueur inscrit, qui n'avait aucune porte d'entrée.
export default function ManiaCupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#07050b]">
      <ManiaCupNav />
      {/* La barre étant fixe sur mobile, le contenu doit démarrer sous elle.
          Sur grand écran elle est collante et occupe sa place toute seule. */}
      <div className="pt-[52px] lg:pt-0">{children}</div>
    </div>
  );
}
