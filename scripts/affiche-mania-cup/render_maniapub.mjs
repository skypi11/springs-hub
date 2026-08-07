// Capture les visuels ManiaPub aux dimensions EXACTES imposées par le jeu.
//
//   node scripts/affiche-mania-cup/render_maniapub.mjs           (français)
//   node scripts/affiche-mania-cup/render_maniapub.mjs en        (anglais)
//
// À lancer APRÈS `python build_maniapub.py [langue]`, qui produit les gabarits.
// Les PNG sortent dans tmp/maniapub/ — ce sont des fichiers à téléverser dans
// ManiaPub à la main, le site ne les sert pas.
//
// POURQUOI UNE CAPTURE À DEUX FOIS LA TAILLE, PUIS UNE RÉDUCTION :
// un panneau de 512 x 80 laisse à peine 15 px de hauteur au texte secondaire.
// Capturé directement à cette taille, chaque lettre tombe sur une grille d'un
// pixel et le rendu devient sale. On capture donc à 1024 x 160 puis on réduit
// par moyenne (Lanczos) : les diagonales et les accents restent nets. C'est le
// même principe que le suréchantillonnage.
//
// Playwright n'est pas une dépendance du dépôt : le script le prend là où
// l'outillage local l'a installé, et le dit clairement s'il ne le trouve pas.

import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(ICI, '..', '..');
// Hors de `public/` À DESSEIN : ces visuels se téléversent dans ManiaPub,
// aucune page du site ne les sert. Les mettre dans `public/` les rendrait
// accessibles sur aedral.com sans qu'aucun écran n'y mène — et tout visuel
// lu par des joueurs passe par une validation avant d'être en ligne.
const SORTIE = path.join(REPO, 'tmp', 'maniapub');

const LANGUE = process.argv[2] ?? 'fr';
const SUFFIXE = LANGUE === 'fr' ? '' : `-${LANGUE}`;

/** Les trois formats imposés par ManiaPub. */
const FORMATS = [
  { nom: 'bandeau', largeur: 512, hauteur: 80 },
  { nom: 'portrait', largeur: 512, hauteur: 768 },
  { nom: 'grand', largeur: 2048, hauteur: 1312 },
];

/** Facteur de suréchantillonnage. 2 suffit ; au-delà, le grand format
 *  demanderait 4096 x 2624 au navigateur pour un gain invisible. */
const SURECH = 2;

async function chargerPlaywright() {
  try {
    return await import('playwright');
  } catch {
    throw new Error(
      'Playwright est introuvable. Il n’est pas une dépendance du dépôt.\n' +
      'Installe-le le temps du rendu :  npm i -D playwright && npx playwright install chromium'
    );
  }
}

const { chromium } = await chargerPlaywright();

if (!existsSync(SORTIE)) mkdirSync(SORTIE, { recursive: true });

const navigateur = await chromium.launch();
try {
  for (const { nom, largeur, hauteur } of FORMATS) {
    const gabarit = path.join(ICI, `maniapub-${nom}${SUFFIXE}.html`);
    if (!existsSync(gabarit)) {
      throw new Error(`Gabarit manquant : ${gabarit}\nLance d’abord : python build_maniapub.py ${LANGUE}`);
    }

    const page = await navigateur.newPage({
      viewport: { width: largeur, height: hauteur },
      deviceScaleFactor: SURECH,
    });
    await page.goto('file:///' + gabarit.replace(/\\/g, '/'));
    // Laisser la police intégrée s'appliquer : capturer avant produit un rendu
    // dans la police de repli, sans qu'aucune erreur ne le signale.
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);

    // Contrôle de débordement AVANT la capture.
    //
    // Un texte trop long ne provoque aucune erreur : il sort de sa colonne et
    // se superpose à la voisine. C'est arrivé au premier jet du bandeau — la
    // date passait sous l'adresse du site. À l'œil, sur une image de 512 x 80,
    // on peut le rater. On mesure donc chaque élément rendu : sa largeur réelle
    // contre celle qu'on lui laisse.
    // On ne mesure QUE le contenu (`.inner`). Les halos et les damiers sont
    // posés en absolu avec des débordements voulus — un halo qui dépasse de
    // 320 px sous le cadre est un effet, pas un défaut. Les inclure faisait
    // crier au débordement sur un visuel parfaitement juste.
    const debordements = await page.evaluate(() => {
      const trouves = [];
      const contenu = document.querySelector('.inner');
      if (!contenu) return trouves;

      for (const el of contenu.querySelectorAll('*')) {
        if (getComputedStyle(el).position === 'absolute') continue;
        if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) {
          trouves.push({
            quoi: el.className || el.tagName,
            texte: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
            place: el.clientWidth,
            besoin: el.scrollWidth,
          });
        }
      }
      if (contenu.scrollHeight > contenu.clientHeight + 1) {
        trouves.push({
          quoi: 'hauteur du contenu', texte: '(il ne tient pas dans le visuel)',
          place: contenu.clientHeight, besoin: contenu.scrollHeight,
        });
      }
      return trouves;
    });

    const grand = await page.screenshot({ type: 'png' });
    await page.close();

    for (const d of debordements) {
      console.log(
        `      débordement · ${d.quoi} : « ${d.texte} » demande ${d.besoin} px, en a ${d.place}`
      );
      process.exitCode = 1;
    }

    const fichier = path.join(SORTIE, `maniapub-${nom}${SUFFIXE}.png`);
    await sharp(grand)
      .resize(largeur, hauteur, { kernel: 'lanczos3' })
      .png({ compressionLevel: 9 })
      .toFile(fichier);

    // Contrôler les dimensions du fichier ÉCRIT, pas celles qu'on a demandées :
    // ManiaPub refuse un format qui ne tombe pas juste, et un décalage d'un
    // pixel ne se voit pas à l'œil.
    const { width, height } = await sharp(fichier).metadata();
    const ok = width === largeur && height === hauteur;
    console.log(
      `${ok ? 'OK' : 'ÉCHEC'}  ${nom.padEnd(9)} ${width} x ${height}  ->  tmp/maniapub/${path.basename(fichier)}`
    );
    if (!ok) process.exitCode = 1;
  }
} finally {
  await navigateur.close();
}
