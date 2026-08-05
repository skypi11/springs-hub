import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WithdrawButton from './WithdrawButton';

// Le bug que ces tests verrouillent : un retrait qui RÉUSSIT laissait le bouton
// « Confirmer » désactivé et sa roue tourner sans fin, parce que l'état occupé
// n'était remis à zéro que dans la branche d'erreur. Vu de l'utilisateur, le
// site paraissait planté alors que sa place était déjà libérée.

const { apiMock, ApiErrorClass } = vi.hoisted(() => {
  class FakeApiError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ApiError';
    }
  }
  return { apiMock: vi.fn(), ApiErrorClass: FakeApiError };
});

vi.mock('@/lib/api-client', () => ({
  api: apiMock,
  ApiError: ApiErrorClass,
}));

function confirmButton() {
  return screen.getByRole('button', { name: /confirmer/i });
}

describe('WithdrawButton', () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  it('demande confirmation avant de retirer quoi que ce soit', () => {
    render(<WithdrawButton onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /retirer mon inscription/i }));
    expect(screen.getByText(/libérer ta place/i)).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('rend la main une fois le retrait accepté', async () => {
    apiMock.mockResolvedValue({ ok: true });
    const onDone = vi.fn();

    render(<WithdrawButton onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: /retirer mon inscription/i }));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    // Le cœur du bug : sans remise à zéro, ce bouton restait désactivé pour
    // toujours et le joueur voyait une roue tourner indéfiniment.
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
  });

  it('appelle la bonne route en suppression', async () => {
    apiMock.mockResolvedValue({ ok: true });
    render(<WithdrawButton onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /retirer mon inscription/i }));
    fireEvent.click(confirmButton());

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/api/mania-cup/register', { method: 'DELETE' })
    );
  });

  it('affiche le motif renvoyé par le serveur', async () => {
    // Cas réel : une inscription déjà réglée ne se retire pas toute seule, il y
    // a un remboursement à traiter.
    apiMock.mockRejectedValue(new ApiErrorClass('Ton inscription est déjà réglée.'));
    render(<WithdrawButton onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /retirer mon inscription/i }));
    fireEvent.click(confirmButton());

    expect(await screen.findByText(/déjà réglée/i)).toBeInTheDocument();
  });

  it('reste compréhensible quand la panne n’a pas de message', async () => {
    apiMock.mockRejectedValue(new Error('socket hang up'));
    render(<WithdrawButton onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /retirer mon inscription/i }));
    fireEvent.click(confirmButton());

    expect(await screen.findByText(/le retrait a échoué/i)).toBeInTheDocument();
  });

  it('laisse revenir en arrière sans rien retirer', () => {
    render(<WithdrawButton onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /retirer mon inscription/i }));
    fireEvent.click(screen.getByRole('button', { name: /annuler/i }));

    expect(screen.getByRole('button', { name: /retirer mon inscription/i })).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();
  });
});
