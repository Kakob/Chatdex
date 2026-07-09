// Single registration point for the v1 detector suite. Both the worker and
// the main thread (for non-worker analysis paths) call this once at startup.
// Phases 4-5 add the verification-absence and reversion detectors here.

import { registerDetector } from './registry';
import { loopDetector } from './detectors/loop';

let registered = false;

export function registerAllDetectors(): void {
  if (registered) return;
  registered = true;
  registerDetector(loopDetector);
  // registerDetector(verificationAbsenceDetector); // Phase 4
  // registerDetector(reversionDetector);         // Phase 5
}
