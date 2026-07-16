// Le bundle brackets-viewer est un IIFE webpack sans exports : il pose
// window.bracketsViewer au chargement (le typage de la globale vient de
// brackets-viewer/dist/types.d.ts, tiré par les imports de type du wrapper).
// Cette déclaration rend l'import side-effect typable.
declare module 'brackets-viewer/dist/brackets-viewer.min.js';
