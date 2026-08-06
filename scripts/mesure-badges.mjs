// Banc de mesure des badges Mania Cup.
//
// La page des badges est reservee aux administrateurs : on ne peut pas la
// charger telle quelle dans un navigateur de controle. Ce script en extrait le
// CSS reel et reconstruit un badge a l'identique dans une page autonome, pour
// MESURER ce que le navigateur en fait.
//
// Pourquoi mesurer plutot que regarder : la premiere version de ces badges
// calait chaque bloc au millimetre. Elle tombait juste sur une machine et
// debordait sur une autre des que la police tardait a charger — le defaut est
// passe en production et l'organisateur l'a vu avant moi.
//
//   node scripts/mesure-badges.mjs public/mesure-badges.html
//   puis http://localhost:3000/mesure-badges.html  ->  window.mesurer()
//
// ATTENTION : ecrire le banc dans public/ le rend PUBLIC au deploiement.
// Le supprimer aussitot la verification faite.

import { readFileSync, writeFileSync } from 'node:fs';

const SOURCE = 'app/admin/mania-cup/badges/page.tsx';
const src = readFileSync(SOURCE, 'utf8');

const debut = src.indexOf('<style jsx global>{`');
const fin = src.indexOf('`}</style>', debut);
if (debut < 0 || fin < 0) {
  console.error('bloc de style introuvable dans', SOURCE);
  process.exit(1);
}
const css = src.slice(debut + '<style jsx global>{`'.length, fin);

// Trois noms : court, moyen, et un mot long insecable — c'est ce dernier qui
// faisait deborder l'ancienne version, parce que la taille se calculait sur la
// longueur totale au lieu du MOT LE PLUS LONG.
const CAS = [
  { cat: 'JOUEUR', couleur: '#00D936', nom: 'G0LI0', detail: 'Trackmania', code: 'LAN-7Y6B' },
  { cat: 'ACCOMPAGNANT', couleur: '#FFB800', nom: 'Jean-Baptiste Delacroix-Fontaine', detail: 'Accompagnant de G0LI0', code: '' },
  { cat: 'SPECTATEUR', couleur: '#c6c6d2', nom: 'Bartholomeworthington', detail: '', code: '' },
  { cat: 'STAFF', couleur: '#A66BE8', nom: 'Matt Molines', detail: 'Direction', code: '' },
];

const badge = (c) => `
  <div class="mc-badge mc-${c.cat.toLowerCase()}">
    <div class="mc-spine" style="background:${c.couleur}"><span>${c.cat}</span></div>
    <div class="mc-main">
      <div class="mc-checker"></div>
      <div class="mc-head">
        <img class="mc-logo" src="/springs-esport.png" alt="">
        <div class="mc-lan"><b>LAN</b><span>TRACKMANIA</span></div>
        <div class="mc-springs">SPRINGS</div>
        <div class="mc-event">MANIA CUP</div>
        <div class="mc-when">3–4 octobre 2026 · Marzy</div>
      </div>
      <div class="mc-point"></div>
      <div class="mc-who">
        <div class="mc-name" data-nom="${c.nom}">${c.nom}</div>
        ${c.detail ? `<div class="mc-detail">${c.detail}</div>` : ''}
      </div>
      <div class="mc-meta">
        <span>aedral.com/mania-cup</span>
        <span class="right">${c.code ? `<span class="mc-code">${c.code}</span>` : ''}</span>
      </div>
      <div class="mc-checker"></div>
    </div>
  </div>`;

const page = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Mesure des badges</title>
<style>
  @font-face { font-family:'BebasLocale'; src:url('/fonts/Rajdhani-Bold.ttf') format('truetype'); }
  :root { --font-display:'BebasLocale', Impact, sans-serif; }
  body { margin:0; background:#fff; font-family:system-ui,sans-serif; }
  .badge-sheet { display:grid; grid-template-columns:repeat(2, 100mm); gap:4mm; padding:4mm; }
  ${css}
</style></head><body>
<div class="badge-sheet">${CAS.map(badge).join('')}</div>
<script>
  // La taille du nom depend du MOT le plus long, pas de la longueur totale.
  function tailleNom(t) {
    const plusLong = t.split(/\\s+/).reduce((m, w) => Math.max(m, w.length), 0);
    if (t.length <= 8 && plusLong <= 8) return '19.5mm';
    if (plusLong <= 10) return '15.5mm';
    if (plusLong <= 13) return '12mm';
    return '9.8mm';
  }
  for (const el of document.querySelectorAll('.mc-name')) {
    el.style.fontSize = tailleNom(el.dataset.nom);
  }

  window.mesurer = async () => {
    await document.fonts.ready;
    const mm = 96 / 25.4;
    const out = [];
    for (const b of document.querySelectorAll('.mc-badge')) {
      const r = b.getBoundingClientRect();
      const corps = b.querySelector('.mc-main');
      const spine = b.querySelector('.mc-spine');
      const nom = b.querySelector('.mc-name');
      const sr = spine.getBoundingClientRect();
      const nr = nom.getBoundingClientRect();
      out.push({
        categorie: spine.textContent.trim(),
        largeur_mm: +(r.width / mm).toFixed(1),
        hauteur_mm: +(r.height / mm).toFixed(1),
        bande_visible_mm: +(sr.height / mm).toFixed(1),
        // Le contenu deborde-t-il de la boite ? C'est LE defaut a traquer.
        deborde: corps.scrollHeight > corps.clientHeight + 1,
        depassement_px: Math.max(0, corps.scrollHeight - corps.clientHeight),
        nom_deborde: nr.width > corps.clientWidth,
      });
    }
    return out;
  };
</script>
</body></html>`;

const SORTIE = process.argv[2] || 'mesure-badges.html';
writeFileSync(SORTIE, page);
console.log('banc ecrit :', SORTIE);
console.log('CSS extrait :', css.length, 'caracteres');
