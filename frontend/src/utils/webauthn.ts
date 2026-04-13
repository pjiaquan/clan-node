type PublicKeyCredentialDescriptorJson = {
  id: string;
  type: 'public-key';
  transports?: AuthenticatorTransport[];
};

type PublicKeyCredentialCreationOptionsJson = {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: Array<{ alg: number; type: 'public-key' }>;
  timeout?: number;
  attestation?: AttestationConveyancePreference;
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  excludeCredentials?: PublicKeyCredentialDescriptorJson[];
};

type PublicKeyCredentialRequestOptionsJson = {
  challenge: string;
  rpId?: string;
  timeout?: number;
  userVerification?: UserVerificationRequirement;
  allowCredentials?: PublicKeyCredentialDescriptorJson[];
};

type BrowserPasskeyErrorCode =
  | 'unsupported'
  | 'cancelled'
  | 'timeout'
  | 'invalid_state'
  | 'network'
  | 'unknown';

export class PasskeyError extends Error {
  code: BrowserPasskeyErrorCode;

  constructor(code: BrowserPasskeyErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const toBase64Url = (value: ArrayBuffer | Uint8Array) => {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const fromBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const requirePasskeySupport = () => {
  if (
    typeof window === 'undefined'
    || !window.isSecureContext
    || typeof window.PublicKeyCredential === 'undefined'
    || typeof navigator === 'undefined'
    || !navigator.credentials
  ) {
    throw new PasskeyError('unsupported', 'Passkeys are not supported in this browser.');
  }
};

const mapCredentialError = (error: unknown): PasskeyError => {
  if (error instanceof PasskeyError) return error;
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'AbortError') {
      return new PasskeyError('cancelled', 'Passkey request was cancelled.');
    }
    if (error.name === 'TimeoutError') {
      return new PasskeyError('timeout', 'Passkey request timed out.');
    }
    if (error.name === 'InvalidStateError') {
      return new PasskeyError('invalid_state', 'This passkey is already registered on this device.');
    }
    return new PasskeyError('unknown', error.message || 'Passkey request failed.');
  }
  if (error instanceof Error) {
    return new PasskeyError('unknown', error.message);
  }
  return new PasskeyError('unknown', 'Passkey request failed.');
};

const toCreationOptions = (input: PublicKeyCredentialCreationOptionsJson): PublicKeyCredentialCreationOptions => ({
  challenge: fromBase64Url(input.challenge),
  rp: input.rp,
  user: {
    ...input.user,
    id: fromBase64Url(input.user.id),
  },
  pubKeyCredParams: input.pubKeyCredParams,
  timeout: input.timeout,
  attestation: input.attestation,
  authenticatorSelection: input.authenticatorSelection,
  excludeCredentials: input.excludeCredentials?.map((credential) => ({
    ...credential,
    id: fromBase64Url(credential.id),
  })),
});

const toRequestOptions = (input: PublicKeyCredentialRequestOptionsJson): PublicKeyCredentialRequestOptions => ({
  challenge: fromBase64Url(input.challenge),
  rpId: input.rpId,
  timeout: input.timeout,
  userVerification: input.userVerification,
  allowCredentials: input.allowCredentials?.map((credential) => ({
    ...credential,
    id: fromBase64Url(credential.id),
  })),
});

export const isPasskeySupported = () => (
  typeof window !== 'undefined'
  && window.isSecureContext
  && typeof window.PublicKeyCredential !== 'undefined'
  && typeof navigator !== 'undefined'
  && Boolean(navigator.credentials)
);

export const createPasskeyCredential = async (
  options: PublicKeyCredentialCreationOptionsJson,
  name?: string,
) => {
  requirePasskeySupport();
  try {
    const credential = await navigator.credentials.create({
      publicKey: toCreationOptions(options),
    });
    if (!(credential instanceof PublicKeyCredential)) {
      throw new PasskeyError('unknown', 'Browser did not return a passkey credential.');
    }
    const response = credential.response;
    if (!(response instanceof AuthenticatorAttestationResponse)) {
      throw new PasskeyError('unknown', 'Browser returned an invalid registration response.');
    }
    return {
      id: credential.id,
      rawId: toBase64Url(credential.rawId),
      name: name?.trim() || undefined,
      response: {
        clientDataJSON: toBase64Url(response.clientDataJSON),
        attestationObject: toBase64Url(response.attestationObject),
      },
    };
  } catch (error) {
    throw mapCredentialError(error);
  }
};

export const getPasskeyAssertion = async (
  options: PublicKeyCredentialRequestOptionsJson,
) => {
  requirePasskeySupport();
  try {
    const credential = await navigator.credentials.get({
      publicKey: toRequestOptions(options),
    });
    if (!(credential instanceof PublicKeyCredential)) {
      throw new PasskeyError('unknown', 'Browser did not return a passkey assertion.');
    }
    const response = credential.response;
    if (!(response instanceof AuthenticatorAssertionResponse)) {
      throw new PasskeyError('unknown', 'Browser returned an invalid passkey assertion.');
    }
    return {
      id: credential.id,
      rawId: toBase64Url(credential.rawId),
      userHandle: response.userHandle ? toBase64Url(response.userHandle) : undefined,
      response: {
        clientDataJSON: toBase64Url(response.clientDataJSON),
        authenticatorData: toBase64Url(response.authenticatorData),
        signature: toBase64Url(response.signature),
      },
    };
  } catch (error) {
    throw mapCredentialError(error);
  }
};

export const defaultPasskeyName = () => {
  if (typeof navigator === 'undefined') return 'This device';
  const agent = navigator.userAgent.toLowerCase();
  if (agent.includes('iphone')) return 'iPhone';
  if (agent.includes('ipad')) return 'iPad';
  if (agent.includes('mac')) return 'Mac';
  if (agent.includes('android')) return 'Android device';
  if (agent.includes('windows')) return 'Windows device';
  return 'This device';
};

export const passkeyErrorMessage = (error: unknown) => {
  const normalized = mapCredentialError(error);
  switch (normalized.code) {
    case 'unsupported':
      return 'Passkeys are not available in this browser.';
    case 'cancelled':
      return 'Passkey request was cancelled.';
    case 'timeout':
      return 'Passkey request timed out. Try again.';
    case 'invalid_state':
      return 'This passkey is already registered.';
    case 'network':
      return 'Passkey request failed because the network request did not complete.';
    default:
      return normalized.message || 'Passkey request failed.';
  }
};

export const encodePasskeyFriendlyName = (value: string) => (
  value.trim() || defaultPasskeyName()
);
