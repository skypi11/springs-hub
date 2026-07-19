import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ModalBackdrop from './ModalBackdrop';

// Premier test de composant du repo — il PROUVE l'infra jsdom ET verrouille le
// fix §1.6 (chantier UX juillet 2026) : le backdrop ne doit fermer la modale que
// si le geste a COMMENCÉ sur lui. Presser dans le formulaire puis relâcher sur la
// zone sombre (glissement courant au doigt) fermait la modale et jetait la saisie,
// parce que le `click` est dispatché sur l'ancêtre commun — pas protégé par
// stopPropagation. C'est exactement ce que ce test empêche de recasser.

function setup() {
  const onClose = vi.fn();
  render(
    <ModalBackdrop onClose={onClose}>
      <div data-testid="content">contenu de la modale</div>
    </ModalBackdrop>,
  );
  // Le backdrop est l'élément racine qui contient le contenu.
  const backdrop = screen.getByTestId('content').parentElement as HTMLElement;
  const content = screen.getByTestId('content');
  return { onClose, backdrop, content };
}

describe('ModalBackdrop', () => {
  it('ferme quand le geste commence ET finit sur la zone sombre', () => {
    const { onClose, backdrop } = setup();
    fireEvent.pointerDown(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('NE ferme PAS quand le geste commence dans le contenu (le bug §1.6)', () => {
    const { onClose, backdrop, content } = setup();
    // Doigt pressé sur le formulaire, relâché sur la zone sombre.
    fireEvent.pointerDown(content);
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ne ferme pas sur un clic à l’intérieur du contenu', () => {
    const { onClose, content } = setup();
    fireEvent.pointerDown(content);
    fireEvent.click(content);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ferme sur Échap', () => {
    const { onClose } = setup();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('n’arme pas la fermeture deux fois de suite (le drapeau est remis à zéro)', () => {
    const { onClose, backdrop, content } = setup();
    // 1er geste légitime → ferme.
    fireEvent.pointerDown(backdrop);
    fireEvent.click(backdrop);
    // 2e geste qui commence dans le contenu → ne doit PAS profiter du 1er.
    fireEvent.pointerDown(content);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
