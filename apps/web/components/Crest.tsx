'use client';
import { useEffect, useState } from 'react';
import { blobUrl } from '@/lib/api';

/** Two letters for a school's crest: "Nile Valley Language School" → "NV". */
export function crestLetters(name: string): string {
  const skip = /^(of|the|and|school|language|languages|مدرسة|مدارس|للغات)$/i;
  const letters = name.split(/\s+/).filter((w) => /^[A-Za-z؀-ۿ]/.test(w) && !skip.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return letters || name.slice(0, 1);
}

/**
 * The school's crest: a burgundy shield with a gold edge and the school's
 * initials, or the crest image the school uploaded.
 */
export function Crest({ name, hasLogo, version = 0, size }: { name: string; hasLogo?: boolean; version?: number; size?: 'sm' | 'lg' | 'xl' }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let url: string | undefined;
    if (hasLogo) blobUrl('/school/logo').then((u) => setSrc((url = u))).catch(() => setSrc(undefined));
    else setSrc(undefined);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [hasLogo, version]);
  const cls = ['crest', size, src && 'image'].filter(Boolean).join(' ');
  if (src) return <span className={cls}><img src={src} alt="" /></span>;
  return <span className={cls} aria-hidden="true">{crestLetters(name)}</span>;
}
