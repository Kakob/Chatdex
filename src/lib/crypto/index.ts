// Public surface for the client-side crypto layer.
// Application code should depend only on these names.

export type { Sealed } from './primitives';
export {
  encryptBytes,
  decryptBytes,
  encryptString,
  decryptString,
  encryptJSON,
  decryptJSON,
  randomBytes,
  randomIv,
} from './primitives';

export type { KdfParams } from './kdf';
export { DEFAULT_KDF_PARAMS } from './kdf';

export type { AccountKeyMaterial, SignupBundle } from './keyManager';
export {
  isUnlocked,
  getMasterKey,
  getCurrentUserId,
  lock,
  provisionAccount,
  unlockWithPassphrase,
  unlockWithRecoveryCode,
  rewrapWithPassphrase,
  regenerateRecoveryCode,
} from './keyManager';

export {
  generateRecoveryCode,
  formatRecoveryCode,
  parseRecoveryCode,
} from './recovery';
