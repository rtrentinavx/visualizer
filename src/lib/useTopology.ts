import { useReducer, useEffect, useRef, useState } from 'react';
import type { DcfPolicyModel } from '../types/dcf';
import { decryptTopology, saveTopologyStorage } from './cryptoStorage';
import { demoTopology } from '../data/demoTopology';
import { topologyReducer, type TopologyAction } from './topologyReducer';
import { appendSnapshot } from './historyStorage';

export interface UseTopologyResult {
  topology: DcfPolicyModel;
  dispatch: React.Dispatch<TopologyAction>;
  isReady: boolean;
  isFreshLoad: boolean;
}

export function useTopology(): UseTopologyResult {
  const [topology, dispatch] = useReducer(topologyReducer, demoTopology, (init) => structuredClone(init));
  const [isReady, setIsReady] = useState(false);
  const [isFreshLoad, setIsFreshLoad] = useState(false);
  const initialLoadDone = useRef(false);

  // Load encrypted topology on mount; fall back to legacy plain-JSON; otherwise mark fresh.
  useEffect(() => {
    let cancelled = false;
    decryptTopology<DcfPolicyModel>().then((saved) => {
      if (cancelled) return;
      if (saved) {
        dispatch({ type: 'replace', topology: saved });
      } else {
        try {
          const plain = localStorage.getItem('dcf-topology-v1');
          if (plain) {
            const parsed = JSON.parse(plain);
            dispatch({ type: 'replace', topology: parsed });
            saveTopologyStorage(parsed).catch(() => {});
          } else {
            setIsFreshLoad(true);
          }
        } catch { /* ignore */ }
      }
      initialLoadDone.current = true;
      setIsReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  // Debounced autosave + snapshot append. Same 500ms debounce; both run on
  // every settled topology change. appendSnapshot is internally dedup'd against
  // the most-recent auto snapshot, so a non-functional save doesn't bloat the
  // history ring.
  useEffect(() => {
    if (!isReady) return;
    const timer = setTimeout(() => {
      saveTopologyStorage(topology).catch(() => {});
      appendSnapshot(topology, 'auto').catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [topology, isReady]);

  return { topology, dispatch, isReady, isFreshLoad };
}
