import { useEffect, useState } from 'react';

const MOBILE_UA_RX =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i;

export function detectIsPc(): boolean {
  if (typeof window === 'undefined') return true;
  const fineHover =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const coarsePointer =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;
  const isMobileUa =
    typeof navigator !== 'undefined' && MOBILE_UA_RX.test(navigator.userAgent);

  if (fineHover && !isMobileUa) return true;
  if (coarsePointer || isMobileUa) return false;

  const hasTouch =
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
    'ontouchstart' in window;
  return !hasTouch || window.innerWidth >= 1024;
}

export function useIsPc(): boolean {
  const [isPc, setIsPc] = useState<boolean>(() => detectIsPc());

  useEffect(() => {
    const update = () => setIsPc(detectIsPc());
    update();

    const mqFine =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(hover: hover) and (pointer: fine)')
        : null;
    const mqCoarse =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(pointer: coarse)')
        : null;

    mqFine?.addEventListener?.('change', update);
    mqCoarse?.addEventListener?.('change', update);
    window.addEventListener('resize', update);

    return () => {
      mqFine?.removeEventListener?.('change', update);
      mqCoarse?.removeEventListener?.('change', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  return isPc;
}
