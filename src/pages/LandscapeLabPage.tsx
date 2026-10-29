// Dev-only synthetic scale lab for the Understanding Landscape
// (ACCEPTANCE.md scale fixtures). Renders in-memory fixtures at 25 / 100 /
// 300 records through the real landscape page, read-only. Never writes to
// the database; the route is registered only in development builds.

import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LandscapePage } from './LandscapePage';
import { SYNTHETIC_SIZES, syntheticLoaded } from '../lib/landscape/synthetic';

export function LandscapeLabPage() {
  const [searchParams] = useSearchParams();
  const requested = Number(searchParams.get('size'));
  const size = SYNTHETIC_SIZES.find((s) => s === requested) ?? 100;
  const source = useMemo(() => () => Promise.resolve(syntheticLoaded(size)), [size]);
  return <LandscapePage source={source} readOnly label={`Synthetic lab · ${size} records · not your data`} />;
}
