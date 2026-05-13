/**
 * Pure helpers used by the DCF Framework module exporter
 * (src/lib/terraformExport.ts → generateTerraformModule). Kept separate so they
 * can be unit-tested in isolation without dragging the whole HCL emission path
 * into a test.
 *
 * Reference for the module's input schema:
 *   https://github.com/terraform-aviatrix-modules/terraform-aviatrix-dcf-framework/blob/main/variables.tf
 */

import type { DcfPolicy } from '../../types/dcf';

export interface PortRange {
  lo: number;
  hi?: number;
}

/**
 * Parse a port-string of the shape we store internally
 * (`"443,8080,9000-9100"`) into the module's `port_ranges` list shape
 * (`[{ lo: 443 }, { lo: 8080 }, { lo: 9000, hi: 9100 }]`).
 *
 * - Whitespace around commas and dashes is tolerated.
 * - An empty / undefined input returns an empty array (the module treats an
 *   empty `port_ranges` the same as omitting the field — all ports match).
 * - Invalid tokens (NaN, lo > hi, negative) are dropped silently rather than
 *   throwing. Caller can compare input vs output length if it wants to flag
 *   data loss in the UI.
 */
export function parsePortString(input: string | undefined): PortRange[] {
  if (!input) return [];
  const out: PortRange[] = [];
  for (const tokenRaw of input.split(',')) {
    const token = tokenRaw.trim();
    if (token === '' || token === 'any') continue;
    if (token.includes('-')) {
      const [loRaw, hiRaw] = token.split('-').map((s) => s.trim());
      // Reject empty halves explicitly — `Number('')` is `0`, not NaN, so the
      // numeric check below alone wouldn't catch `-1` (which splits to `['','1']`).
      if (!loRaw || !hiRaw) continue;
      const lo = Number(loRaw);
      const hi = Number(hiRaw);
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < 0 || hi < lo) continue;
      out.push({ lo, hi });
    } else {
      const lo = Number(token);
      if (!Number.isFinite(lo) || lo < 0) continue;
      out.push({ lo });
    }
  }
  return out;
}

/**
 * Map our policy model's boolean `decrypt` flag to the module's enum string.
 * The module passes this through to the underlying provider's
 * `decrypt_policy` attribute.
 *
 * - `true`  → `"DECRYPT_REQUIRED"` (TLS is decrypted and inspected)
 * - `false` → `"DECRYPT_ALLOWED"` (plaintext L7 only; no decryption attempted)
 * - undefined → `"DECRYPT_UNSPECIFIED"` (use the controller-wide default)
 */
export function decryptToEnum(decrypt: boolean | undefined): 'DECRYPT_REQUIRED' | 'DECRYPT_ALLOWED' | 'DECRYPT_UNSPECIFIED' {
  if (decrypt === true) return 'DECRYPT_REQUIRED';
  if (decrypt === false) return 'DECRYPT_ALLOWED';
  return 'DECRYPT_UNSPECIFIED';
}

/**
 * Map our policy model's action enum to the module's `action` string. The
 * module passes this verbatim to the provider; valid values are PERMIT,
 * DENY, and (historically) LEARNED for routes learned from peer gateways.
 */
export function actionToProviderString(action: DcfPolicy['action']): 'PERMIT' | 'DENY' | 'LEARNED' {
  if (action === 'allow') return 'PERMIT';
  if (action === 'learned') return 'LEARNED';
  return 'DENY';
}

/**
 * Map our protocol enum to the uppercase string the provider expects.
 */
export function protocolToProviderString(protocol: DcfPolicy['protocol']): string {
  return (protocol ?? 'any').toUpperCase();
}

/**
 * Convert an arbitrary display name into a valid Terraform identifier that's
 * safe to use as a `map(object)` key in the module's smart_groups / web_groups
 * inputs. Constraints (Terraform-level + our own):
 *
 *   - Must match /^[A-Za-z_][A-Za-z0-9_-]*$/ (Terraform identifiers allow
 *     letters, digits, underscores; the module also accepts dashes since the
 *     map key is a string literal, not an identifier — we still strip other
 *     punctuation for cleanliness).
 *   - Must be unique within the caller's `takenKeys` set; collisions get a
 *     numeric suffix (`-2`, `-3`, ...).
 *   - Empty / fully-stripped names fall back to `unnamed`.
 *
 * Caller is responsible for adding the returned key to its `takenKeys` set
 * before sanitizing the next name.
 */
export function sanitizeMapKey(name: string, takenKeys: Set<string>): string {
  let base = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-') // anything else becomes a dash
    .replace(/-+/g, '-')           // collapse runs of dashes
    .replace(/^[-_]+|[-_]+$/g, ''); // trim leading/trailing dashes & underscores
  if (base === '') base = 'unnamed';
  // Terraform identifiers can't start with a digit, but map KEYS (string
  // literals) can. We still prefix with an underscore for hygiene since the
  // key sometimes flows into references like aviatrix_smart_group.<key>.
  if (/^[0-9]/.test(base)) base = `_${base}`;

  if (!takenKeys.has(base)) return base;
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${base}-${i}`;
    if (!takenKeys.has(candidate)) return candidate;
  }
  // Astronomically unlikely; safety valve.
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}
