import { describe, it, expect } from 'vitest';
import {
  generateRegistrationCode,
  normalizeRegistrationCode,
  suggestRegistrationCodes,
  isIdentityRefComplete,
  isGuardianRecordComplete,
  ageAtEvent,
  needsGuardianConsent,
  discordIdFromUid,
  isRentalPaid,
  texteMaterielLoue,
  shortenCivilName,
  companionBadgeName,
  MANIA_CUP,
  type GuardianDoc,
  type GuardianDocKind,
} from './mania-cup';

// Le code d'inscription est le seul lien entre un règlement encaissé sur
// HelloAsso et un dossier sur Aedral. Tout ce qui le concerne — sa forme, sa
// lecture, sa remise en forme après une recopie humaine — se teste ici, parce
// qu'une erreur y créditerait un joueur du paiement d'un autre.

describe('isRentalPaid', () => {
  // Cette garde vient d'un incident : un clic destiné à consulter le matériel
  // loué a écrasé une location réglée 90 € par une location manuelle à 0 €.
  // Le lien avec la ligne HelloAsso fait foi — c'est lui qui représente
  // l'argent encaissé.
  it('reconnaît une location réglée à la billetterie', () => {
    expect(isRentalPaid({ itemId: 198968963, amountCents: 9000, label: 'LOCATION PC FIXE' })).toBe(true);
  });

  it('laisse retirer une location notée par l’organisation', () => {
    expect(isRentalPaid({ amountCents: 0, source: 'manual', label: 'PC fixe' })).toBe(false);
  });

  it('ne se fie pas à `source` seul', () => {
    // Les locations écrites avant que ce champ existe n'en portent aucun : les
    // juger sur lui les aurait rendues effaçables d'un clic.
    expect(isRentalPaid({ itemId: 42, amountCents: 9000 })).toBe(true);
    expect(isRentalPaid(null)).toBe(false);
    expect(isRentalPaid(undefined)).toBe(false);
  });
});

describe('shortenCivilName', () => {
  // Un badge se porte toute la journée et passe sur les photos : le nom d'état
  // civil complet y est une donnée personnelle exposée sans nécessité.
  it('réduit le nom de famille à son initiale', () => {
    expect(shortenCivilName('Jean-Baptiste Delacroix-Fontaine')).toBe('Jean-Baptiste D.');
    expect(shortenCivilName('Charly Leprince')).toBe('Charly L.');
  });

  it('laisse un prénom seul intact', () => {
    expect(shortenCivilName('Martine')).toBe('Martine');
  });

  it('garde tous les prénoms composés', () => {
    expect(shortenCivilName('Marie Anne Dupont')).toBe('Marie Anne D.');
  });

  it('survit aux espaces en trop et à une chaîne vide', () => {
    expect(shortenCivilName('  Paul   Durand  ')).toBe('Paul D.');
    expect(shortenCivilName('')).toBe('');
  });
});

describe('companionBadgeName', () => {
  const base = { name: 'Jean-Baptiste Delacroix-Fontaine', role: 'Père' };

  it('imprime le pseudo quand le joueur en a choisi un', () => {
    expect(companionBadgeName({ ...base, displayName: 'Jibé' })).toBe('Jibé');
  });

  it('retombe sur prénom + initiale, jamais sur le nom entier', () => {
    expect(companionBadgeName(base)).toBe('Jean-Baptiste D.');
    expect(companionBadgeName({ ...base, displayName: '   ' })).toBe('Jean-Baptiste D.');
  });

  it('n’imprime JAMAIS le nom du billet tel quel', () => {
    // `name` est la donnée de contrôle, elle reste sur l'émargement.
    expect(companionBadgeName(base)).not.toBe(base.name);
  });
});

describe('texteMaterielLoue', () => {
  // Ce qui compte dans l'annonce, c'est l'ARTICLE : c'est lui qui dit quelle
  // machine sortir du carton le 3 octobre.
  it('nomme l’article loué', () => {
    expect(texteMaterielLoue({ qui: 'Rag_TM', article: 'LOCATION PC FIXE (2 jours)', montantCents: 9000 }))
      .toBe('🖥️ **Rag_TM** a loué du matériel : LOCATION PC FIXE (2 jours) · 90,00 €');
  });

  it('n’affiche pas de montant pour une location convenue de vive voix', () => {
    // 0 € n'est pas un prix, c'est l'absence d'encaissement : l'écrire ferait
    // croire à une location gratuite.
    expect(texteMaterielLoue({ qui: 'Nova', article: 'écran seul', montantCents: 0 }))
      .toBe('🖥️ **Nova** a loué du matériel : écran seul');
  });

  it('le dit quand l’article est inconnu, au lieu d’un blanc', () => {
    expect(texteMaterielLoue({ qui: 'Nova', article: '   ' })).toContain('matériel non précisé');
    expect(texteMaterielLoue({ qui: 'Nova' })).toContain('matériel non précisé');
  });
});

describe('generateRegistrationCode', () => {
  it('produit la forme LAN-XXXX', () => {
    expect(generateRegistrationCode(() => 0)).toBe('LAN-AAAA');
    expect(generateRegistrationCode()).toMatch(/^LAN-[A-Z2-9]{4}$/);
  });

  it("n'emploie jamais les caractères qui se confondent à la lecture", () => {
    // I/1 et O/0 sont indiscernables sur un billet imprimé ou dicté au
    // téléphone : les exclure est ce qui rend la recopie fiable.
    const codes = Array.from({ length: 400 }, () => generateRegistrationCode());
    for (const code of codes) {
      expect(code.slice(4)).not.toMatch(/[IO01]/);
    }
  });

  it('reste lisible par normalizeRegistrationCode', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRegistrationCode();
      expect(normalizeRegistrationCode(code)).toBe(code);
    }
  });
});

describe('normalizeRegistrationCode', () => {
  it('accepte la forme canonique', () => {
    expect(normalizeRegistrationCode('LAN-4B2C')).toBe('LAN-4B2C');
  });

  it('rattrape ce que les gens tapent réellement', () => {
    // Chaque cas vient d'une façon plausible de recopier un code : en
    // minuscules, sans le tiret, avec des espaces, sans le préfixe.
    expect(normalizeRegistrationCode('lan-4b2c')).toBe('LAN-4B2C');
    expect(normalizeRegistrationCode('LAN4B2C')).toBe('LAN-4B2C');
    expect(normalizeRegistrationCode('  lan 4b2c  ')).toBe('LAN-4B2C');
    expect(normalizeRegistrationCode('4B2C')).toBe('LAN-4B2C');
    expect(normalizeRegistrationCode('4b2c')).toBe('LAN-4B2C');
    expect(normalizeRegistrationCode('LAN_4B2C')).toBe('LAN-4B2C');
    expect(normalizeRegistrationCode('LAN–4B2C')).toBe('LAN-4B2C'); // tiret long
  });

  it('accepte le préfixe doublé', () => {
    // Arrive quand le champ est pré-rempli avec « LAN- » et que le joueur
    // recopie son code entier par-dessus.
    expect(normalizeRegistrationCode('LANLAN-4B2C')).toBe('LAN-4B2C');
  });

  it('refuse ce qui ne peut pas être un code', () => {
    expect(normalizeRegistrationCode('')).toBeNull();
    expect(normalizeRegistrationCode(null)).toBeNull();
    expect(normalizeRegistrationCode(undefined)).toBeNull();
    expect(normalizeRegistrationCode('LAN-4B2')).toBeNull(); // trop court
    expect(normalizeRegistrationCode('LAN-4B2CD')).toBeNull(); // trop long
    expect(normalizeRegistrationCode('mon fils paul')).toBeNull();
    expect(normalizeRegistrationCode('30 euros')).toBeNull();
  });

  it('refuse les caractères que le générateur n’emploie pas', () => {
    // On ne devine pas : rien ne dit si un « 0 » saisi visait un D, un Q ou
    // rien du tout. Le paiement part en rattachement manuel, avec suggestions.
    expect(normalizeRegistrationCode('LAN-4B2O')).toBeNull();
    expect(normalizeRegistrationCode('LAN-4B20')).toBeNull();
    expect(normalizeRegistrationCode('LAN-4B2I')).toBeNull();
    expect(normalizeRegistrationCode('LAN-4B21')).toBeNull();
  });

  it('ne confond pas un préfixe avec un corps de code', () => {
    // « LANE » est un code valide en soi : le dépouiller de son « LAN »
    // laisserait un corps d'un caractère et perdrait le dossier.
    expect(normalizeRegistrationCode('LANE')).toBe('LAN-LANE');
    expect(normalizeRegistrationCode('LAN-LANE')).toBe('LAN-LANE');
  });
});

describe('suggestRegistrationCodes', () => {
  const known = ['LAN-4B2C', 'LAN-7XQZ', 'LAN-4B2D'];

  it('propose les codes à une lettre près', () => {
    // Le joueur a tapé un O là où il y avait un Q.
    expect(suggestRegistrationCodes('7XOZ', known)).toEqual(['LAN-7XQZ']);
  });

  it('propose les deux quand deux dossiers sont voisins', () => {
    // Cas exact où confirmer d'autorité serait une faute : la décision
    // remonte à un humain.
    expect(suggestRegistrationCodes('4B2E', known)).toEqual(['LAN-4B2C', 'LAN-4B2D']);
  });

  it('tolère un caractère en trop ou en moins', () => {
    expect(suggestRegistrationCodes('4B2', known)).toContain('LAN-4B2C');
    expect(suggestRegistrationCodes('4B2CX', known)).toContain('LAN-4B2C');
  });

  it('ne propose rien quand la saisie n’a aucun rapport', () => {
    expect(suggestRegistrationCodes('WXYZ', known)).toEqual([]);
    expect(suggestRegistrationCodes('', known)).toEqual([]);
  });

  it('accepte une saisie préfixée comme une saisie nue', () => {
    expect(suggestRegistrationCodes('LAN-7XOZ', known)).toEqual(['LAN-7XQZ']);
  });
});

describe('âge et consentement parental', () => {
  it("apprécie l'âge au premier jour de la LAN, pas à l'inscription", () => {
    // Un joueur né le 2 octobre 2010 a 15 ans en août 2026 mais 16 ans la
    // veille de l'événement : il a le droit de venir.
    expect(ageAtEvent('2010-10-02')).toBe(16);
    // Né le 4 octobre, il les a un jour trop tard.
    expect(ageAtEvent('2010-10-04')).toBe(15);
  });

  it('exige une autorisation en dessous de 18 ans', () => {
    expect(needsGuardianConsent(17)).toBe(true);
    expect(needsGuardianConsent(18)).toBe(false);
    expect(needsGuardianConsent(MANIA_CUP.minAge)).toBe(true);
  });

  it('refuse une date illisible', () => {
    expect(ageAtEvent('pas une date')).toBeNull();
  });
});

describe('dossier mineur', () => {
  const doc: GuardianDoc = { key: 'k', name: 'n', mime: 'application/pdf' };
  const docs: Partial<Record<GuardianDocKind, GuardianDoc>> = {
    consent: doc,
    guardian_id: doc,
  };
  const identity = {
    representativeName: 'Martine Dupont',
    representative: { kind: 'cni' as const, number: 'X4B29', authority: 'Préfecture de la Nièvre' },
    minor: { kind: 'passport' as const, number: '19HK4402', authority: 'Mairie de Nevers' },
  };

  it('valide des références complètes', () => {
    expect(isIdentityRefComplete(identity.representative)).toBe(true);
  });

  it('refuse une référence amputée', () => {
    expect(isIdentityRefComplete({ kind: 'cni', number: 'X4B29', authority: '   ' })).toBe(false);
    expect(isIdentityRefComplete({ kind: 'cni', authority: 'Préfecture' })).toBe(false);
    expect(isIdentityRefComplete(null)).toBe(false);
    // Nature de titre inventée : refusée.
    expect(
      isIdentityRefComplete({ kind: 'permis' as never, number: '1', authority: 'a' })
    ).toBe(false);
  });

  it('exige les pièces ET les références', () => {
    expect(isGuardianRecordComplete(docs, identity)).toBe(true);
    // Les scans sans les références : incomplet.
    expect(isGuardianRecordComplete(docs, null)).toBe(false);
    // Les références sans l'autorisation signée : incomplet aussi.
    expect(isGuardianRecordComplete({ consent: doc }, identity)).toBe(false);
    expect(isGuardianRecordComplete({}, identity)).toBe(false);
  });

  it('refuse un signataire anonyme', () => {
    expect(isGuardianRecordComplete(docs, { ...identity, representativeName: '  ' })).toBe(false);
  });
});

describe('discordIdFromUid', () => {
  it('extrait le snowflake', () => {
    expect(discordIdFromUid('discord_123456789')).toBe('123456789');
  });

  it('refuse tout autre format', () => {
    expect(discordIdFromUid('google_123')).toBeNull();
    expect(discordIdFromUid('discord_abc')).toBeNull();
    expect(discordIdFromUid('')).toBeNull();
  });
});
