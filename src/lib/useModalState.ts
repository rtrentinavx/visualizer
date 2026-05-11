import { useState, useCallback } from 'react';

export type ModalName =
  | 'terraformExport'
  | 'about'
  | 'bestPractices'
  | 'aiSettings'
  | 'aiChat'
  | 'autoDocs'
  | 'policyTemplates'
  | 'import'
  | 'achievements'
  | 'recommendations';

export interface UseModalState {
  active: ModalName | null;
  open: (name: ModalName) => void;
  close: () => void;
  isOpen: (name: ModalName) => boolean;
}

export function useModalState(): UseModalState {
  const [active, setActive] = useState<ModalName | null>(null);
  const open = useCallback((name: ModalName) => setActive(name), []);
  const close = useCallback(() => setActive(null), []);
  const isOpen = useCallback((name: ModalName) => active === name, [active]);
  return { active, open, close, isOpen };
}
