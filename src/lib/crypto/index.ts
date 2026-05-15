// Public surface for the client-side crypto layer.

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
  generateMasterKey,
  importRawKey,
  exportRawKey,
} from './primitives';

export {
  isUnlocked,
  getMasterKey,
  getCurrentUserId,
  setUnlocked,
  lock,
} from './keyManager';

export {
  generateRecoveryCode,
  formatRecoveryCode,
  parseRecoveryCode,
  recoveryCodeToKey,
  wrapMasterKey,
  unwrapMasterKey,
} from './recovery';
