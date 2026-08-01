// FAQ de la Springs Mania Cup — structurée en paires question/réponse.
//
// Pourquoi pas le système de règlements markdown : une FAQ n'est pas un texte
// suivi. Elle se lit en repliant tout sauf ce qu'on cherche, et s'édite question
// par question. Un bloc markdown obligerait l'organisateur à respecter une
// convention de titres pour que l'accordéon fonctionne — une contrainte
// invisible qui casse au premier oubli.

export const MANIA_CUP_FAQ_COLLECTION = 'mania_cup_content';
export const MANIA_CUP_FAQ_DOC = 'faq';

export interface FaqItem {
  q: string;
  a: string;
}

export const FAQ_LIMITS = {
  question: 200,
  answer: 2000,
  items: 60,
} as const;

/**
 * Questions de départ, proposées en un clic dans la console.
 *
 * Ce n'est PAS le contenu servi : la FAQ publique vient toujours de la base.
 * Ces suggestions évitent seulement à l'organisateur de tout retaper la
 * première fois — il les charge, corrige ce qu'il veut, enregistre. Ce qui est
 * enregistré devient la source, et ces valeurs n'ont plus aucun effet.
 */
export const FAQ_SUGGESTIONS: FaqItem[] = [
  {
    q: 'Faut-il posséder Trackmania pour participer ?',
    a: 'Oui, et il faut la version **Club**. La version gratuite ne permet pas de jouer les épreuves de la compétition.',
  },
  {
    q: 'Quel niveau faut-il avoir ?',
    a: 'Aucun niveau minimum. Toutes les maps sont inédites et découvertes sur place : personne n’arrive avec de l’entraînement sur les parcours, c’est tout le principe de la LAN.',
  },
  {
    q: 'Manette, volant ou clavier : que puis-je utiliser ?',
    a: 'Les trois sont autorisés. Joue avec ce dont tu as l’habitude.',
  },
  {
    q: 'Que dois-je apporter en plus de mon ordinateur ?',
    a: 'Une **multiprise** et un **câble ethernet de 10 mètres**. Sans eux, tu ne pourras ni te brancher ni te connecter au réseau.',
  },
  {
    q: 'La connexion se fait-elle en wifi ?',
    a: 'Non, en **ethernet**, sur un réseau local. D’où le câble de 10 mètres à prévoir.',
  },
  {
    q: 'Puis-je venir avec une tour et un grand écran ?',
    a: 'Oui, la LAN est prévue pour. Tu n’es pas obligé de jouer sur un portable.',
  },
  {
    q: 'Puis-je laisser mon matériel sur place la nuit du samedi au dimanche ?',
    a: 'Oui. La salle est fermée pour la nuit, sous surveillance, et une partie du staff y dort. Tu n’as pas à tout démonter le samedi soir.',
  },
  {
    q: 'Y a-t-il un parking ?',
    a: 'Oui, un parking est disponible sur place.',
  },
  {
    q: 'Que se passe-t-il le samedi soir après la compétition ?',
    a: 'La soirée est libre. Des jeux sont organisés pour ceux qui souhaitent rester sur place plus tard.',
  },
  {
    q: 'Puis-je choisir ma place, ou m’installer à côté de mes amis ?',
    a: 'Oui. Un plan de salle sera communiqué avant l’événement et tu pourras y réserver ta place.',
  },
  {
    q: 'Que se passe-t-il si j’arrive en retard ?',
    a: 'Les horaires sont fermes et un joueur absent au lancement d’une épreuve ne peut pas y prendre part. Le détail figure dans le règlement.',
  },
  {
    q: 'Comment le cashprize est-il versé ?',
    a: 'Par virement bancaire, après l’événement.',
  },
  {
    q: 'La compétition sera-t-elle rediffusée ?',
    a: 'Oui, le stream sera disponible en VOD sur YouTube.',
  },
];
