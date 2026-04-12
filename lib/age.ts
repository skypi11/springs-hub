// Calcule l'âge en années à partir d'une date de naissance ISO (YYYY-MM-DD).
// Renvoie null si l'entrée est invalide ou hors bornes (date future, > 150 ans).
// Le calcul compare année/mois/jour pour ne pas se tromper en début d'année.
export function computeAge(dateStr: unknown, now: Date = new Date()): number | null {
  if (typeof dateStr !== 'string' || !dateStr) return null;
  const birth = new Date(dateStr);
  if (isNaN(birth.getTime())) return null;
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age >= 0 && age < 150 ? age : null;
}
