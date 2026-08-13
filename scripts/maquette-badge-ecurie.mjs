// Maquette : l'écurie sur le badge — forme de la pastille, logos difficiles.
//
// Rejoue le VRAI CSS des badges (extrait de la page d'administration).
//
//   node scripts/maquette-badge-ecurie.mjs public/maquette-badge.html
//   puis http://localhost:3000/maquette-badge.html
//
// ATTENTION : écrire dans public/ le rend PUBLIC au déploiement. Le fichier est
// dans .gitignore ; le supprimer dès la décision prise.

import { readFileSync, writeFileSync } from 'node:fs';

const SOURCE = 'app/admin/mania-cup/badges/page.tsx';
const src = readFileSync(SOURCE, 'utf8');
const debut = src.indexOf('<style jsx global>{`');
const fin = src.indexOf('`}</style>', debut);
const css = src.slice(debut + '<style jsx global>{`'.length, fin);

// Quatre logos qui couvrent les cas réels d'une billetterie ouverte à tous.
const R2 = 'https://pub-058913be9f9f4fa2ac6f4f12bdfaf38a.r2.dev/structures';
const LOGOS = [
  { nom: 'Nyxar Esport', src: `${R2}/UXk9VyUBGS9r8wlUMXAV/logo-1786637744760.webp`, cas: 'rond et SOMBRE (le vrai logo de Nyxar)' },
  { nom: 'Aedral', src: `${R2}/mrgDBI9HDKfxugKtZ8fx/logo-1777234247886.webp`, cas: 'clair sur fond transparent' },
  { nom: 'Team Carré', src: '/games/valorant.png', cas: 'CARRÉ et plein, bords à bords' },
  {
    nom: 'Club Blanc',
    // Logo entièrement blanc : le pire cas sur une pastille blanche.
    src: 'data:image/svg+xml;utf8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#fff"/><path d="M20 44 L32 18 L44 44 Z" fill="#f2f2f2"/></svg>`
    ),
    cas: 'entièrement BLANC',
  },
];

const badge = (o) => `
  <figure class="cas">
    <div class="mc-badge">
      <div class="mc-spine" style="background:${o.couleurCat ?? '#00D936'}"><span>${o.cat ?? 'JOUEUR'}</span></div>
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
        <div class="mc-who ${o.classeWho ?? ''}">
          <div class="mc-name" style="font-size:${o.taille ?? '19.5mm'}">${o.nom}</div>
          ${o.detail ? `<div class="mc-detail">${o.detail}</div>` : ''}
          ${o.logo ? `<div class="mc-club ${o.classeClub ?? ''}"><img src="${o.logo.src}" alt=""><span>${o.logo.nom}</span></div>` : ''}
        </div>
        <div class="mc-meta">
          <span>aedral.com/mania-cup</span>
          <span class="right"><span class="mc-code">LAN-7Y6B</span></span>
        </div>
        <div class="mc-checker"></div>
      </div>
    </div>
    <figcaption><b>${o.titre}</b><span>${o.sous}</span></figcaption>
  </figure>`;

const section = (titre, note, cas) => `
  <h2>${titre}</h2>
  <p class="note">${note}</p>
  <div class="grille">${cas.map(badge).join('')}</div>`;

// 1 — la mise en page validée : pseudo centré, écurie posée en bas.
const MISE_EN_PAGE = [
  { titre: 'ce qui est validé', sous: 'pseudo au milieu, écurie en bas, logo 10,5 mm', nom: 'G0LI0', logo: LOGOS[0] },
  { titre: 'nom très long', sous: 'le pseudo ne descend jamais sur l’écurie', nom: 'Bartholomeworthington', taille: '9.8mm', logo: LOGOS[0] },
  { titre: 'sans écurie', sous: 'la majorité des inscrits — le badge reste équilibré', nom: 'YannexTM' },
  { titre: 'accompagnant', sous: 'pseudo modifiable + écurie du joueur', cat: 'ACCOMPAGNANT', couleurCat: '#FFB800', nom: 'Jibé', detail: 'Accompagne G0LI0', taille: '15.5mm', logo: LOGOS[0] },
];

// 2 et 3 — les logos difficiles, dans les deux formes de pastille.
const ronde = LOGOS.map((l) => ({ titre: l.nom, sous: l.cas, nom: 'G0LI0', logo: l }));
const carree = LOGOS.map((l) => ({ titre: l.nom, sous: l.cas, nom: 'G0LI0', logo: l, classeClub: 'club-carre' }));

// 4 — la couleur du FOND de pastille, en gros plan sur la zone du club.
const FONDS = [
  { cle: 'f-blanc', nom: 'blanc', note: 'les logos clairs disparaissent' },
  { cle: 'f-gris', nom: 'gris clair', note: 'compromis' },
  { cle: 'f-moyen', nom: 'gris moyen', note: 'clair ET sombre ressortent' },
];
const gros = `
  <div class="labo">
    ${FONDS.map((f) => `
      <div class="colonne">
        <div class="chapeau"><b>${f.nom}</b><span>${f.note}</span></div>
        ${LOGOS.map((l) => `
          <div class="vignette">
            <div class="mc-club club-carre ${f.cle}">
              <img src="${l.src}" alt=""><span>${l.nom}</span>
            </div>
          </div>`).join('')}
      </div>`).join('')}
  </div>`;

const page = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Badge — pastille et logos</title>
<style>
  @font-face { font-family:'BebasLocale'; src:url('/fonts/Rajdhani-Bold.ttf') format('truetype'); }
  :root { --font-display:'BebasLocale', Impact, sans-serif; }
  body { margin:0; padding:8mm; background:#0a0a0a; color:#eaeaf0; font-family:system-ui,sans-serif; }
  h1 { font-size:19px; margin:0 0 6mm; }
  h2 { font-size:15px; margin:9mm 0 1mm; color:#FFB800; }
  .note { margin:0 0 4mm; font-size:12.5px; color:#7a7a95; max-width:230mm; }
  .grille { display:flex; flex-wrap:wrap; gap:7mm; align-items:flex-start; }
  .cas { margin:0; }
  figcaption { margin-top:2.5mm; width:100mm; display:flex; flex-direction:column; gap:0.8mm; }
  figcaption b { font-size:12.5px; }
  figcaption span { font-size:11.5px; color:#7a7a95; }
  ${css}

  /* L'écurie descend au pied de la zone, le pseudo reste centré au-dessus.
     La réserve en bas garantit qu'un nom sur trois lignes ne vient jamais
     mordre dessus. */
  .mc-who { position:relative; padding-bottom:14mm; }
  .mc-club {
    position:absolute; left:4mm; right:4mm; bottom:3.4mm;
    display:flex; align-items:center; justify-content:center; gap:2.4mm;
  }
  .mc-club img {
    width:10.5mm; height:10.5mm; object-fit:contain; flex:0 0 auto;
    background:#fff; border-radius:50%; padding:0.35mm;
    /* Un logo blanc sur une pastille blanche disparaît. Ce liseré sombre le
       détache sans rien changer aux logos foncés. */
    box-shadow:0 0 0 0.25mm rgba(0,0,0,0.35);
  }
  .mc-club span {
    font-size:4.4mm; font-weight:700; letter-spacing:0.03em; color:#fff;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  }
  /* Variante carrée : aucun coin de logo n'est rogné. */
  .club-carre img { border-radius:1.4mm; padding:0.5mm; }

  /* Laboratoire : la zone du club en gros plan, sur le fond réel du badge. */
  .labo { display:flex; gap:8mm; flex-wrap:wrap; }
  .colonne { background:#191330; padding:4mm; border:1px solid rgba(255,255,255,.08); }
  .chapeau { display:flex; flex-direction:column; margin-bottom:3mm; }
  .chapeau b { font-size:13px; }
  .chapeau span { font-size:11.5px; color:#7a7a95; }
  .vignette { padding:2.5mm 0; }
  .vignette .mc-club { position:static; left:auto; right:auto; bottom:auto;
                       justify-content:flex-start; transform:scale(1.6);
                       transform-origin:left center; margin:2mm 0 2mm 6mm; }
  .f-blanc img { background:#fff; }
  .f-gris img { background:#d5d5de; }
  .f-moyen img { background:#9a9aa8; }
</style></head><body>
<h1>Badge de la LAN — pastille fine, écurie en bas</h1>
${section('1 — La mise en page que tu as validée', 'Pseudo centré, plus gros (19,5 mm) puisqu’il est seul ; écurie posée en bas ; logo à 10,5 mm.', MISE_EN_PAGE)}
${section('2 — Pastille RONDE, quatre logos difficiles', 'Le logo carré est rogné à ses quatre coins : un cercle ne peut pas contenir un carré plein sans le manger. Le logo blanc ne tient que grâce au liseré sombre.', ronde)}
${section('3 — Pastille CARRÉE à coins arrondis', 'Aucun logo n’est amputé, quelle que soit sa forme. Le rond reste rond, le carré reste carré.', carree)}
<h2>4 — La couleur du fond, en gros plan</h2>
<p class="note">Sur fond blanc, un logo blanc ou très clair s’efface — c’est le cas d’Aedral, et de beaucoup de logos esport, blancs sur fond transparent. Un gris moyen fait ressortir les deux extrêmes.</p>
${gros}
</body></html>`;

const SORTIE = process.argv[2] || 'maquette-badge.html';
writeFileSync(SORTIE, page);
console.log('maquette écrite :', SORTIE);
