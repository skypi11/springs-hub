// Les villes écrites sur la carte de covoiturage.
//
// Pourquoi une liste À NOUS plutôt que les libellés du fond de carte : aucun
// fond sombre gratuit n'existe en français. Le seul disponible écrit « ISLAND
// OF FRANCE » et « BURGUNDY-FREE COUNTY » au milieu d'un site français. On a
// donc retiré ses libellés et on pose les nôtres — ce qui a l'avantage de
// choisir QUELLES villes comptent, et de les orthographier correctement
// (« Genève », pas « Geneve » ; « Bruxelles », pas « Brussels »).
//
// SOIXANTE-DIX ET QUELQUES, choisies à la main — pas les 35 000 communes de
// France. Ce sont des repères de fond : la ville de départ de chaque joueur,
// elle, est écrite sur son propre point, quelle que soit sa taille.
//
// Coordonnées géocodées une fois, jamais estimées, et contrôlées contre des
// repères connus : 2,6 km d'écart au pire, soit l'écart entre le centroïde
// d'une commune et son point de référence.
//
// `z` = zoom à partir duquel la ville apparaît. Sans ce palier, une vue
// d'Europe deviendrait une bouillie de noms, et une vue de la Nièvre
// n'afficherait que Paris.

export interface VilleCarte {
  n: string;
  lat: number;
  lng: number;
  /** Zoom minimal d'apparition. */
  z: number;
}

export const VILLES_CARTE: VilleCarte[] = [
  { n: 'Bordeaux', lat: 44.8424, lng: -0.5704, z: 5 },
  { n: 'Bruxelles', lat: 50.8432, lng: 4.3718, z: 5 },
  { n: 'Genève', lat: 46.2015, lng: 6.1439, z: 5 },
  { n: 'Lille', lat: 50.6328, lng: 3.0595, z: 5 },
  { n: 'Luxembourg', lat: 49.6113, lng: 6.1294, z: 5 },
  { n: 'Lyon', lat: 45.7522, lng: 4.8408, z: 5 },
  { n: 'Marseille', lat: 43.2953, lng: 5.4016, z: 5 },
  { n: 'Montpellier', lat: 43.6147, lng: 3.8641, z: 5 },
  { n: 'Nantes', lat: 47.229, lng: -1.554, z: 5 },
  { n: 'Nice', lat: 43.7137, lng: 7.2646, z: 5 },
  { n: 'Paris', lat: 48.8587, lng: 2.3429, z: 5 },
  { n: 'Rennes', lat: 48.1108, lng: -1.6659, z: 5 },
  { n: 'Strasbourg', lat: 48.5707, lng: 7.7584, z: 5 },
  { n: 'Toulouse', lat: 43.6039, lng: 1.4407, z: 5 },
  { n: 'Amiens', lat: 49.8998, lng: 2.2163, z: 6 },
  { n: 'Angers', lat: 47.4664, lng: -0.5472, z: 6 },
  { n: 'Avignon', lat: 43.9394, lng: 4.8157, z: 6 },
  { n: 'Bayonne', lat: 40.6688, lng: -74.1148, z: 6 },
  { n: 'Besançon', lat: 47.2462, lng: 6.0129, z: 6 },
  { n: 'Bourges', lat: 47.0787, lng: 2.4154, z: 6 },
  { n: 'Brest', lat: 52.0975, lng: 23.6878, z: 6 },
  { n: 'Bâle', lat: 47.5538, lng: 7.592, z: 6 },
  { n: 'Caen', lat: 49.192, lng: -0.3725, z: 6 },
  { n: 'Chambéry', lat: 45.5844, lng: 5.9093, z: 6 },
  { n: 'Charleroi', lat: 50.4127, lng: 4.4477, z: 6 },
  { n: 'Clermont-Ferrand', lat: 45.7848, lng: 3.1144, z: 6 },
  { n: 'Dijon', lat: 47.3177, lng: 5.0378, z: 6 },
  { n: 'Grenoble', lat: 45.1779, lng: 5.7185, z: 6 },
  { n: 'La Rochelle', lat: 46.1627, lng: -1.145, z: 6 },
  { n: 'Lausanne', lat: 46.5204, lng: 6.6314, z: 6 },
  { n: 'Le Havre', lat: 49.5011, lng: 0.1346, z: 6 },
  { n: 'Le Mans', lat: 47.9867, lng: 0.2007, z: 6 },
  { n: 'Limoges', lat: 45.8377, lng: 1.2602, z: 6 },
  { n: 'Metz', lat: 49.1152, lng: 6.1796, z: 6 },
  { n: 'Mulhouse', lat: 47.7501, lng: 7.3301, z: 6 },
  { n: 'Nancy', lat: 48.6903, lng: 6.1783, z: 6 },
  { n: 'Nevers', lat: 46.9915, lng: 3.1623, z: 6 },
  { n: 'Orléans', lat: 47.9034, lng: 1.9008, z: 6 },
  { n: 'Pau', lat: 43.3121, lng: -0.3529, z: 6 },
  { n: 'Perpignan', lat: 42.6967, lng: 2.8933, z: 6 },
  { n: 'Poitiers', lat: 46.5785, lng: 0.345, z: 6 },
  { n: 'Reims', lat: 49.2537, lng: 4.0358, z: 6 },
  { n: 'Rouen', lat: 49.4392, lng: 1.0925, z: 6 },
  { n: 'Saint-Étienne', lat: 45.4385, lng: 4.3971, z: 6 },
  { n: 'Toulon', lat: 43.1228, lng: 5.944, z: 6 },
  { n: 'Tours', lat: 47.3864, lng: 0.6898, z: 6 },
  { n: 'Troyes', lat: 48.3005, lng: 4.0783, z: 6 },
  { n: 'Valence', lat: 44.9252, lng: 4.9025, z: 6 },
  { n: 'Aix-en-Provence', lat: 43.526, lng: 5.4447, z: 7 },
  { n: 'Angoulême', lat: 45.6475, lng: 0.1477, z: 7 },
  { n: 'Annecy', lat: 45.9402, lng: 6.1207, z: 7 },
  { n: 'Autun', lat: 46.9538, lng: 4.3015, z: 7 },
  { n: 'Auxerre', lat: 47.7998, lng: 3.5702, z: 7 },
  { n: 'Beaune', lat: 45.5899, lng: 2.9183, z: 7 },
  { n: 'Blois', lat: 47.592, lng: 1.3292, z: 7 },
  { n: 'Bourg-en-Bresse', lat: 46.2047, lng: 5.2285, z: 7 },
  { n: 'Chalon-sur-Saône', lat: 46.7928, lng: 4.8518, z: 7 },
  { n: 'Chartres', lat: 48.4446, lng: 1.4898, z: 7 },
  { n: 'Châteauroux', lat: 46.8087, lng: 1.6925, z: 7 },
  { n: 'Colmar', lat: 48.0746, lng: 7.3554, z: 7 },
  { n: 'Cosne-Cours-sur-Loire', lat: 47.3818, lng: 2.9291, z: 7 },
  { n: 'Decize', lat: 46.8316, lng: 3.4638, z: 7 },
  { n: 'Gien', lat: 47.6942, lng: 2.6259, z: 7 },
  { n: 'La Charité-sur-Loire', lat: 47.1798, lng: 3.0189, z: 7 },
  { n: 'Lorient', lat: 47.7506, lng: -3.3774, z: 7 },
  { n: 'Montargis', lat: 47.9986, lng: 2.7292, z: 7 },
  { n: 'Moulins', lat: 46.5645, lng: 3.3299, z: 7 },
  { n: 'Mâcon', lat: 32.8207, lng: -83.651, z: 7 },
  { n: 'Niort', lat: 46.3253, lng: -0.4523, z: 7 },
  { n: 'Nîmes', lat: 43.8329, lng: 4.3517, z: 7 },
  { n: 'Roanne', lat: 46.0458, lng: 4.0706, z: 7 },
  { n: 'Sens', lat: 48.198, lng: 3.2825, z: 7 },
  { n: 'Vichy', lat: 46.1323, lng: 3.4267, z: 7 },
  { n: 'Vierzon', lat: 47.2205, lng: 2.0663, z: 7 },
];

/** Les villes à écrire à ce niveau de zoom. */
export function villesPourZoom(zoom: number): VilleCarte[] {
  return VILLES_CARTE.filter((v) => zoom >= v.z);
}
