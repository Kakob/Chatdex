// Single registration point for the v1 detector suite. Both the worker and
// the main thread (for non-worker analysis paths) call this once at startup.

import { registerDetector } from './registry';
import { loopDetector } from './detectors/loop';
import { verificationAbsenceDetector } from './detectors/verificationAbsence';
import { reversionDetector } from './detectors/reversion';

let registered = false;

export function registerAllDetectors(): void {
  if (registered) return;
  registered = true;
  registerDetector(loopDetector);
  registerDetector(verificationAbsenceDetector);
  registerDetector(reversionDetector);
}
