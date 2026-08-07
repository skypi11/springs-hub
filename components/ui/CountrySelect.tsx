'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { countries } from '@/lib/countries';
import CountryFlag from './CountryFlag';

// Sélecteur de pays affichant de VRAIS drapeaux.
//
// Pourquoi pas un <select> natif : un <option> ne peut pas contenir d'image, et
// les emojis drapeaux ne sont pas rendus par Segoe UI Emoji sous Windows — ils
// dégradent en deux lettres ("FR" au lieu de 🇫🇷). C'est précisément la raison
// d'être de CountryFlag, qui sert des PNG via flagcdn. D'où ce composant :
// partout où l'on choisit un pays, on doit voir le drapeau.

export default function CountrySelect({
  value,
  onChange,
  id,
  disabled,
}: {
  value: string;
  onChange: (code: string) => void;
  id?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // Volontairement null quand rien n'est choisi, au lieu de retomber sur le
  // premier pays de la liste. Ce repli affichait « France » à quelqu'un qui
  // n'avait rien sélectionné — il croyait son pays renseigné, et validait.
  const selected = countries.find((c) => c.code === value) ?? null;

  // Fermeture au clic extérieur et à Échap
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 border border-white/15 bg-black/40 px-4 py-3 text-left text-white outline-none focus:border-[#00D936] disabled:opacity-50"
      >
        <span className="flex items-center gap-3">
          {selected ? (
            <>
              <CountryFlag code={selected.code} size={24} />
              {selected.name}
            </>
          ) : (
            <span className="text-[#8d89a8]">Choisis ton pays</span>
          )}
        </span>
        <ChevronDown
          size={18}
          className={`shrink-0 text-[#8d89a8] transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto border border-white/15 bg-[#111015] shadow-2xl"
        >
          {countries.map((c) => {
            const isSelected = c.code === value;
            return (
              <li key={c.code}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(c.code);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/10 ${
                    isSelected ? 'bg-[#00D936]/10 text-white' : 'text-[#c9c5d8]'
                  }`}
                >
                  <CountryFlag code={c.code} size={24} />
                  <span className="flex-1">{c.name}</span>
                  {isSelected && <Check size={16} className="text-[#00D936]" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
