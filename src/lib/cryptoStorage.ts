// Obfuscates `localStorage` topology against casual inspection (open devtools, look at storage).
// The key derives from a constant passphrase + salt embedded in this file, so anyone who reads
// the source can decrypt the data. Provides no protection against local malware, a co-located
// attacker with shell access, or anyone with the source. If real confidentiality is needed,
// switch to a user-derived key (e.g. WebAuthn-derived).

const STORAGE_KEY = 'dcf-topology-v1';
const SALT = new Uint8Array([0x9a, 0xf2, 0x1c, 0x8e, 0x3b, 0x55, 0x77, 0x11, 0x42, 0x66, 0x99, 0x33, 0x77, 0xaa, 0xbb, 0xcc]);
const PBKDF2_ITERATIONS = 600000;
const LEGACY_PBKDF2_ITERATIONS = 100000;

async function deriveKey(iterations: number): Promise<CryptoKey> {
  const passphrase = 'dcf-visualizer-storage-key-v1';
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(passphrase), { name: 'PBKDF2' }, false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: SALT, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function encryptTopology<T>(data: T): Promise<string> {
  const key = await deriveKey(PBKDF2_ITERATIONS);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv } as AlgorithmIdentifier, key, encoder.encode(JSON.stringify(data)));
  const payload = { iv: arrayBufferToBase64(iv.buffer), data: arrayBufferToBase64(ciphertext) };
  return btoa(JSON.stringify(payload));
}

export async function decryptTopology<T>(): Promise<T | null> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const payload = JSON.parse(atob(stored));
    const iv = base64ToArrayBuffer(payload.iv);
    const ciphertext = base64ToArrayBuffer(payload.data);
    // Try current iteration count first; fall back to the legacy count for payloads written
    // before the PBKDF2 bump, then re-encrypt at the new count so subsequent loads are fast.
    // The legacy fallback can be removed once telemetry shows no users still hit it.
    let plaintext: ArrayBuffer;
    try {
      const key = await deriveKey(PBKDF2_ITERATIONS);
      plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    } catch {
      const legacyKey = await deriveKey(LEGACY_PBKDF2_ITERATIONS);
      plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, legacyKey, ciphertext);
      const migrated = JSON.parse(new TextDecoder().decode(plaintext)) as T;
      await saveTopologyStorage(migrated);
      return migrated;
    }
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  } catch {
    // If decryption fails (e.g., corrupted data), return null
    return null;
  }
}

export function clearTopologyStorage(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export async function saveTopologyStorage<T>(data: T): Promise<void> {
  const encrypted = await encryptTopology(data);
  localStorage.setItem(STORAGE_KEY, encrypted);
}
