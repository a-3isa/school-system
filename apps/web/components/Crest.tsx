'use client';
import { useEffect, useState } from 'react';
import { blobUrl } from '@/lib/api';

/** The school's crest, or its monogram in a brass ring when it hasn't uploaded one. */
export function Crest({ name, hasLogo, version = 0 }: { name: string; hasLogo?: boolean; version?: number }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let url: string | undefined;
    if (hasLogo) blobUrl('/school/logo').then((u) => setSrc((url = u))).catch(() => setSrc(undefined));
    else setSrc(undefined);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [hasLogo, version]);
  if (src) return <span className="crest"><img src={src} alt="" /></span>;
  const letters = name.split(/\s+/).filter((w) => /^[A-Za-z\u0600-\u06FF]/.test(w) && !/^(of|the|and|school|مدرسة|مدارس)$/i.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return <span className="crest monogram" aria-hidden="true">{letters || name[0]}</span>;
}
