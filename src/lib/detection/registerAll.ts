// Single registration point for the v1 detector suite. Both the worker and
// the main thread (for non-worker analysis paths) call this once at startup.
// Phases 3-5 add the loop, verification-absence, and reversion detectors here.

let registered = false;

export function registerAllDetectors(): void {
  if (registered) return;
  registered = true;
  // registerDetector(loopDetector);              // Phase 3
  // registerDetector(verificationAbsenceDetector); // Phase 4
  // registerDetector(reversionDetector);         // Phase 5
}
