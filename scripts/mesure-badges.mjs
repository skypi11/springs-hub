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
const LOGO = 'https://pub-058913be9f9f4fa2ac6f4f12bdfaf38a.r2.dev/structures/UXk9VyUBGS9r8wlUMXAV/logo-1786637744760.webp';

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
  // « YannexTM » est LE cas qui a fait scandale : huit signes comme « G0LI0 »,
  // mais un T et un M, les deux lettres les plus larges — le M partait seul à la
  // ligne suivante. La taille se MESURE désormais, elle ne s'estime plus.
  { cat: 'JOUEUR', couleur: '#00D936', nom: 'YannexTM', equipe: 'Nyxar Esport', code: 'LAN-K8W2' },
  { cat: 'JOUEUR', couleur: '#00D936', nom: 'G0LI0', equipe: 'Nyxar Esport', code: 'LAN-7Y6B' },
  { cat: 'ACCOMPAGNANT', couleur: '#FFB800', nom: 'Jean-Baptiste D.', detail: 'Accompagne G0LI0', equipe: 'Nyxar Esport', code: 'LAN-7Y6B' },
  { cat: 'SPECTATEUR', couleur: '#c6c6d2', nom: 'Bartholomeworthington', detail: '', code: '' },
  // Le pire cas d'écurie : un nom de club à rallonge. Il doit se couper
  // proprement, pas pousser le pied du badge hors du cadre.
  { cat: 'JOUEUR', couleur: '#00D936', nom: 'Fan2SkandeaR', equipe: 'Association Sportive de Trackmania du Val de Loire', code: 'LAN-RJDC' },
  { cat: 'JOUEUR', couleur: '#00D936', nom: 'WWWMMMWWWMMM', equipe: 'Nyxar Esport', code: 'LAN-ZZZZ' },
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
        ${c.equipe ? `<div class="mc-club"><img src="${LOGO}" alt=""><span>${c.equipe}</span></div>` : ''}
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
  // MEME algorithme que le composant NomAjuste : on ne devine pas la taille au
  // nombre de caracteres — un M est bien plus large qu'un I —, on la MESURE par
  // dichotomie jusqu'a ce que le nom tienne sur une seule ligne.
  const NOM_MAX = 19.5, NOM_MIN = 6.5;
  async function ajusterTous() {
    await document.fonts.ready;
    for (const el of document.querySelectorAll('.mc-name')) {
      // La boite DU NOM, pas celle du parent : le parent compte son padding.
      let bas = NOM_MIN, haut = NOM_MAX, retenu = NOM_MIN;
      for (let i = 0; i < 12; i++) {
        const essai = (bas + haut) / 2;
        el.style.fontSize = essai + 'mm';
        if (el.scrollWidth <= el.clientWidth) { retenu = essai; bas = essai; } else { haut = essai; }
      }
      el.style.fontSize = retenu + 'mm';
    }
  }
  const pret = ajusterTous();

  window.mesurer = async () => {
    await document.fonts.ready;
    await pret;
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
        // LE controle qui compte, et il porte sur le TEXTE, pas sur sa boite :
        // avec overflow hidden, un nom rogne a exactement la largeur de son
        // cadre — mesurer la boite donnait donc toujours « ca rentre », alors
        // que « YannexTM » sortait visiblement du badge.
        nom_rogne: nom.scrollWidth > nom.clientWidth + 1,
        nom_sur_une_ligne:
          Math.round(nr.height / parseFloat(getComputedStyle(nom).lineHeight || '1')) <= 1,
        nom_taille_mm: +(parseFloat(nom.style.fontSize) || 0).toFixed(1),
        // L'écurie doit tenir sur UNE ligne et rester dans le cadre : c'est
        // elle qui pousserait le pied dehors si elle se mettait à en prendre deux.
        ecurie: (() => {
          const t = b.querySelector('.mc-team');
          if (!t) return null;
          const tr = t.getBoundingClientRect();
          const lignes = Math.round(tr.height / parseFloat(getComputedStyle(t).lineHeight || '0'));
          return {
            largeur_mm: +(tr.width / mm).toFixed(1),
            deborde_en_largeur: t.scrollWidth > t.clientWidth + 1,
            coupee_proprement: t.scrollWidth > t.clientWidth + 1,
            lignes,
          };
        })(),
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
