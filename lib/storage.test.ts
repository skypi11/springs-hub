import { describe, it, expect } from 'vitest';
import {
  StorageKeys,
  UploadLimits,
  AllowedMimeTypes,
  isAllowedMime,
  sanitizeFilename,
} from './storage';

describe('StorageKeys', () => {
  it('construit la clé logo structure', () => {
    expect(StorageKeys.structureLogo('abc123')).toBe('structures/abc123/logo.webp');
  });
  it('construit la clé bannière structure', () => {
    expect(StorageKeys.structureBanner('abc123')).toBe('structures/abc123/banner.webp');
  });
  it('construit la clé avatar user', () => {
    expect(StorageKeys.userAvatar('discord_42')).toBe('users/discord_42/avatar.webp');
  });
  it('construit la clé replay (imbriqué par event)', () => {
    expect(
      StorageKeys.eventReplay('s1', 'ev2', 'replay-abc')
    ).toBe('structures/s1/replays/ev2/replay-abc.replay');
  });
  it('construit la clé document en assainissant le filename', () => {
    expect(
      StorageKeys.structureDocument('s1', 'doc1', 'Contrat Joueur & Springs.pdf')
    ).toBe('structures/s1/documents/doc1/Contrat_Joueur_Springs.pdf');
  });
  it('construit les préfixes pour quotas', () => {
    expect(StorageKeys.structurePrefix('s1')).toBe('structures/s1/');
    expect(StorageKeys.structureDocumentsPrefix('s1')).toBe('structures/s1/documents/');
  });
});

describe('sanitizeFilename', () => {
  it('enlève les accents', () => {
    expect(sanitizeFilename('Contrât.pdf')).toBe('Contrat.pdf');
  });
  it('remplace les caractères spéciaux par _', () => {
    expect(sanitizeFilename('file name@#$.txt')).toBe('file_name_.txt');
  });
  it('collapse les underscores consécutifs', () => {
    expect(sanitizeFilename('a   b')).toBe('a_b');
  });
  it('tronque à 100 caractères', () => {
    const name = 'a'.repeat(150) + '.pdf';
    expect(sanitizeFilename(name).length).toBeLessThanOrEqual(100);
  });
  it('préserve les extensions courantes', () => {
    expect(sanitizeFilename('document.pdf')).toBe('document.pdf');
    expect(sanitizeFilename('image.jpeg')).toBe('image.jpeg');
  });
});

describe('UploadLimits', () => {
  it('logo structure = 2 MB', () => {
    expect(UploadLimits.STRUCTURE_LOGO_BYTES).toBe(2 * 1024 * 1024);
  });
  it('bannière structure = 5 MB', () => {
    expect(UploadLimits.STRUCTURE_BANNER_BYTES).toBe(5 * 1024 * 1024);
  });
  it('avatar user = 2 MB', () => {
    expect(UploadLimits.USER_AVATAR_BYTES).toBe(2 * 1024 * 1024);
  });
  it('replay = 10 MB', () => {
    expect(UploadLimits.REPLAY_BYTES).toBe(10 * 1024 * 1024);
  });
  it('document staff = 20 MB', () => {
    expect(UploadLimits.STAFF_DOCUMENT_BYTES).toBe(20 * 1024 * 1024);
  });
  it('quota docs par structure = 500 MB', () => {
    expect(UploadLimits.STRUCTURE_DOCS_QUOTA_BYTES).toBe(500 * 1024 * 1024);
  });
});

describe('isAllowedMime', () => {
  it('accepte image/jpeg pour IMAGES', () => {
    expect(isAllowedMime('image/jpeg', 'IMAGES')).toBe(true);
  });
  it('accepte image/webp pour IMAGES', () => {
    expect(isAllowedMime('image/webp', 'IMAGES')).toBe(true);
  });
  it('refuse application/pdf pour IMAGES', () => {
    expect(isAllowedMime('application/pdf', 'IMAGES')).toBe(false);
  });
  it('accepte application/pdf pour DOCUMENTS', () => {
    expect(isAllowedMime('application/pdf', 'DOCUMENTS')).toBe(true);
  });
  it('accepte docx pour DOCUMENTS', () => {
    expect(
      isAllowedMime(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'DOCUMENTS'
      )
    ).toBe(true);
  });
  it('refuse image/gif pour DOCUMENTS', () => {
    expect(isAllowedMime('image/gif', 'DOCUMENTS')).toBe(false);
  });
  it('accepte application/octet-stream pour REPLAYS', () => {
    expect(isAllowedMime('application/octet-stream', 'REPLAYS')).toBe(true);
  });
  it('accepte MIME vide pour REPLAYS (.replay n\'a pas de MIME standard)', () => {
    expect(isAllowedMime('', 'REPLAYS')).toBe(true);
  });
  it('refuse text/html partout', () => {
    expect(isAllowedMime('text/html', 'IMAGES')).toBe(false);
    expect(isAllowedMime('text/html', 'DOCUMENTS')).toBe(false);
    expect(isAllowedMime('text/html', 'REPLAYS')).toBe(false);
  });
});

describe('AllowedMimeTypes completeness', () => {
  it('IMAGES couvre les formats web standards', () => {
    expect(AllowedMimeTypes.IMAGES).toContain('image/jpeg');
    expect(AllowedMimeTypes.IMAGES).toContain('image/png');
    expect(AllowedMimeTypes.IMAGES).toContain('image/webp');
  });
  it('DOCUMENTS inclut PDF et DOCX', () => {
    expect(AllowedMimeTypes.DOCUMENTS).toContain('application/pdf');
    expect(AllowedMimeTypes.DOCUMENTS).toContain(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
  });
});
