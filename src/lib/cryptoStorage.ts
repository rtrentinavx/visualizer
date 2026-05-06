// Client-side encryption for localStorage topology data.
// Note: The encryption key is derived from a fixed passphrase. This provides
// defense-in-depth against casual localStorage inspection, not targeted attacks.
// For production secrets, use a user-derived key or server-side storage.

const STORAGE_KEY = 'dcf-topology-v1';
const SALT = new Uint8Array([0x9a, 0xf2, 0x1c, 0x8e, 0x3b, 0x55, 0x77, 0x11, 0x42, 0x66, 0x99, 0x33, 0x77, 0xaa, 0xbb, 0xcc]);

async function deriveKey(): Promise<CryptoKey> {
  const passphrase = 'dcf-visualizer-storage-key-v1';
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(passphrase), { name: 'PBKDF2' }, false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: SALT, iterations: 100000, hash: 'SHA-256' },
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
    binary += String.fromCharCode(bytes[i]);
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
  const key = await deriveKey();
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
    const key = await deriveKey();
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    const decoder = new TextDecoder();
    return JSON.parse(decoder.decode(decrypted)) as T;
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
