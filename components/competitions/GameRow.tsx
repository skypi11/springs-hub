// Rangée de manche EXPLICITE — remplace toute chaîne « 3-1 · 1-2 · 4-0 »
// (retour Matt : « les résultats des manches ne sont vraiment pas
// explicites »). Numéro de manche, score tabulaire avec le chiffre du
// vainqueur en avant, et le NOM COMPLET du vainqueur de la manche.
// Partagée entre la page de match (registre du héros, récap de saisie) et la
// console admin (dépli-dossier).
export default function GameRow({ index, game, teamAName, teamBName, color, decisive = false }: {
  index: number;
  game: { a: number; b: number };
  teamAName: string;
  teamBName: string;
  color: string;
  decisive?: boolean;
}) {
  const winner = game.a > game.b ? 'a' : game.b > game.a ? 'b' : null;
  return (
    <div
      className="grid grid-cols-[76px_72px_1fr] items-center gap-3 min-h-[40px]"
      style={decisive ? { borderLeft: `2px solid ${color}`, paddingLeft: 10 } : undefined}
      aria-label={decisive ? 'manche décisive' : undefined}
    >
      <span className="t-label-soft">Manche {index + 1}</span>
      <span className="t-mono" style={{ fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>
        <span style={{ color: winner === 'a' ? 'var(--s-text)' : 'var(--s-text-dim)', fontWeight: winner === 'a' ? 600 : 400 }}>{game.a}</span>
        <span style={{ color: 'var(--s-text-muted)' }}> – </span>
        <span style={{ color: winner === 'b' ? 'var(--s-text)' : 'var(--s-text-dim)', fontWeight: winner === 'b' ? 600 : 400 }}>{game.b}</span>
      </span>
      <span className="text-sm truncate" style={{ color }}>
        {winner === 'a' ? teamAName : winner === 'b' ? teamBName : ''}
      </span>
    </div>
  );
}
