# Checklist des permissions par rôle — Springs Hub / Aedral

> État au 2026-05-25 après refactor `lib/structure-permissions.ts` et validation modèle A.
> Pour affiner : indique en commentaire à droite ce que tu veux ajouter/retirer pour chaque rôle.

## Vue d'ensemble — 7 rôles distincts

| Niveau | Rôle | Champ Firestore | Combien max |
|---|---|---|---|
| **STRUCTURE** | Fondateur | `structures.founderId` | 1 (unique) |
| STRUCTURE | Co-fondateur | `structures.coFounderIds[]` | 2 max (cap métier) |
| STRUCTURE | Responsable | `structures.managerIds[]` | 100 max (cap sécurité) |
| STRUCTURE | Coach | `structures.coachIds[]` | 100 max (cap sécurité) |
| **ÉQUIPE** | Manager d'équipe | `sub_teams.staffRoles[uid]='manager'` | 20 staff max / équipe |
| ÉQUIPE | Coach d'équipe | `sub_teams.staffRoles[uid]='coach'` | 20 staff max / équipe |
| ÉQUIPE | Capitaine | `sub_teams.captainId` | 1 / équipe |

Un user peut cumuler plusieurs rôles (ex: Co-fondateur de A + Responsable de B + Capitaine d'équipe X dans A).

---

## ⚙️ GESTION STRUCTURE

| Action | Fondateur | Co-fonda | Responsable | Coach | Mgr équipe | Coach équipe | Capitaine |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Modifier nom / tag / logo / description / bannière | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Config Discord (channel, etc.) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Activer/désactiver mode recrutement | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Message public de recrutement | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Supprimer la structure | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Transférer la propriété | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

## 🛡️ PROMOTIONS / STAFF

| Action | Fondateur | Co-fonda | Responsable | Coach | Mgr équipe | Coach équipe | Capitaine |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Promouvoir / rétrograder Responsable | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Promouvoir / rétrograder Coach (structure) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Promouvoir Co-fondateur | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Rétrograder Co-fondateur (préavis 7j) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Retirer un membre de la structure | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

## 👥 MEMBRES / INVITATIONS

| Action | Fondateur | Co-fonda | Responsable | Coach | Mgr équipe | Coach équipe | Capitaine |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Voir la liste des membres | ✅ | ✅ | ✅ | ✅ (read) | ✅ | ✅ | ✅ |
| Créer un lien d'invitation | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Envoyer invitation directe à un joueur | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Accepter / refuser une candidature | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Voir invitations en attente | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

## 🎯 RECRUTEMENT

| Action | Fondateur | Co-fonda | Responsable | Coach | Mgr équipe | Coach équipe | Capitaine |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Accéder à la shortlist (favoris joueurs) | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Ajouter / retirer un joueur shortlistée | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Voir suggestions de recrutement | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

## 🏆 ÉQUIPES (sub_teams)

| Action | Fondateur | Co-fonda | Responsable | Coach | Mgr équipe | Coach équipe | Capitaine |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Voir toutes les équipes | ✅ | ✅ | ✅ | ✅ (sa) | ✅ (sa) | ✅ (sa) | ✅ (sa) |
| Créer une nouvelle équipe | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Modifier nom / logo / capitaine | ✅ | ✅ | ✅ | ❌ | ✅ (sa) | ❌ | ❌ |
| Ajouter / retirer joueurs (titulaires + remplaçants) | ✅ | ✅ | ✅ | ❌ | ✅ (sa) | ❌ | ❌ |
| Ajouter / retirer staff de l'équipe | ✅ | ✅ | ✅ | ❌ | ✅ (sa) | ❌ | ❌ |
| Lier un salon Discord à l'équipe | ✅ | ✅ | ✅ | ❌ | ✅ (sa) | ❌ | ❌ |
| Archiver / désarchiver une équipe | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Modifier le label (groupe) d'une équipe | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Réorganiser l'ordre des équipes | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Supprimer une équipe (destructif) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

`(sa)` = uniquement sur son équipe / les équipes où il est staff

## 📅 CALENDRIER / ÉVÉNEMENTS

| Action | Fondateur | Co-fonda | Responsable | Coach | Mgr équipe | Coach équipe | Capitaine |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Voir le calendrier de la structure | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Créer event `scope=structure` (tous membres) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Créer event `scope=game` (par jeu) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Créer event `scope=staff` (réunion staff) | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Créer training/scrim sur une équipe | ✅ | ✅ | ✅ | ✅ (toutes) | ✅ (sa) | ✅ (sa) | ✅ (sa) |
| Créer match/tournoi sur une équipe | ✅ | ✅ | ✅ | ❌ | ✅ (sa) | ❌ | ✅ (sa) |
| Modifier événement | ✅ | ✅ | ✅ | ⚠️ ses events | ✅ (sa) | ✅ (sa) | ✅ (sa) |
| Marquer terminé / annulé | ✅ | ✅ | ✅ | ⚠️ ses events | ✅ (sa) | ✅ (sa) | ✅ (sa) |
| Supprimer un événement (destructif) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Modifier présence d'un autre joueur | ✅ | ✅ | ✅ | ⚠️ ses events | ✅ (sa) | ✅ (sa) | ✅ (sa) |
| Répondre à sa propre présence | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## 📝 TODOS / EXERCICES

| Action | Fondateur | Co-fonda | Responsable | Coach | Mgr équipe | Coach équipe | Capitaine |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Créer un todo / exercice ciblant un joueur | ✅ | ✅ | ✅ | ✅ (toutes) | ✅ (sa) | ✅ (sa) | ❌ |
| Créer un template d'exercice personnel | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Créer un template d'exercice partagé structure | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Marquer un todo comme fait | ✅ (le sien) | ✅ (le sien) | ✅ (le sien) | ✅ (le sien) | ✅ (le sien) | ✅ (le sien) | ✅ (le sien) |

## 📹 REPLAYS

| Action | Fondateur | Co-fonda | Responsable | Coach | Mgr équipe | Coach équipe | Capitaine |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Uploader un replay | ✅ | ✅ | ✅ | ✅ (toutes) | ✅ (sa) | ✅ (sa) | ✅ (sa) |
| Télécharger un replay | ✅ | ✅ | ✅ | ✅ | ✅ (sa) | ✅ (sa) | ✅ (sa) |
| Lancer parsing ballchasing | ✅ | ✅ | ✅ | ✅ | ✅ (sa) | ✅ (sa) | ✅ (sa) |
| Supprimer un replay | ✅ | ✅ | ✅ (son upload) | ✅ (son upload) | ✅ (son upload) | ✅ (son upload) | ✅ (son upload) |

Seul dirigeant peut supprimer un replay uploadé par quelqu'un d'autre.

## 📂 DOCUMENTS STAFF (contrats, sensibles)

| Action | Fondateur | Co-fonda | Responsable | Coach | Mgr équipe | Coach équipe | Capitaine |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Voir les documents staff | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Uploader un document | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Télécharger un document | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Créer un dossier | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## ⚠️ Zones grises identifiées

1. **Manager d'équipe peut modifier `staffRoles` de son équipe** (escalade silencieuse possible — il peut transformer un coach équipe en manager équipe au sein de son équipe). À trancher : intentionnel ou bug ?

2. **Coach structure peut modifier présences sur ses propres events** mais pas sur ceux d'autres. Cohérent ?

3. **Modèle calendrier scope=staff** : invité = `userIds` sélectionnés parmi audience staff (dirigeants + managers + coachs structure + manager/coach équipe). Faut-il pouvoir cibler aussi les capitaines ?

---

## 🧠 Notes pour affiner

Quand tu affines ces droits, note bien :
- Le **rôle** concerné
- L'**action** précise
- Le **scope** souhaité (toute structure, sa propre équipe seulement, etc.)
- Le **pourquoi** (cas d'usage réel)

Ex : "Coach structure devrait pouvoir voir la shortlist car il aide au recrutement → ajouter ✅ pour Coach sur Recrutement"
