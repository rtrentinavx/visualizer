import { describe, it, expect } from 'vitest';
import {
  parsePortString,
  decryptToEnum,
  actionToProviderString,
  protocolToProviderString,
  sanitizeMapKey,
} from './moduleHelpers';

describe('parsePortString', () => {
  it('returns [] for undefined / empty / "any"', () => {
    expect(parsePortString(undefined)).toEqual([]);
    expect(parsePortString('')).toEqual([]);
    expect(parsePortString('  ')).toEqual([]);
    expect(parsePortString('any')).toEqual([]);
  });

  it('parses a single port', () => {
    expect(parsePortString('443')).toEqual([{ lo: 443 }]);
  });

  it('parses a comma-separated list', () => {
    expect(parsePortString('443,8080,9000')).toEqual([{ lo: 443 }, { lo: 8080 }, { lo: 9000 }]);
  });

  it('parses ranges via the hyphen syntax', () => {
    expect(parsePortString('9000-9100')).toEqual([{ lo: 9000, hi: 9100 }]);
  });

  it('handles a mix of single ports and ranges with whitespace', () => {
    expect(parsePortString(' 443, 8080 , 9000-9100 ,8443 ')).toEqual([
      { lo: 443 },
      { lo: 8080 },
      { lo: 9000, hi: 9100 },
      { lo: 8443 },
    ]);
  });

  it('drops invalid tokens silently (NaN, negative, lo > hi)', () => {
    expect(parsePortString('443,foo,-1,9100-9000,8080')).toEqual([{ lo: 443 }, { lo: 8080 }]);
  });
});

describe('decryptToEnum', () => {
  it('maps true to DECRYPT_REQUIRED', () => {
    expect(decryptToEnum(true)).toBe('DECRYPT_REQUIRED');
  });
  it('maps false to DECRYPT_ALLOWED', () => {
    expect(decryptToEnum(false)).toBe('DECRYPT_ALLOWED');
  });
  it('maps undefined to DECRYPT_UNSPECIFIED (use controller default)', () => {
    expect(decryptToEnum(undefined)).toBe('DECRYPT_UNSPECIFIED');
  });
});

describe('actionToProviderString', () => {
  it('maps the three internal actions to provider strings', () => {
    expect(actionToProviderString('allow')).toBe('PERMIT');
    expect(actionToProviderString('deny')).toBe('DENY');
    expect(actionToProviderString('learned')).toBe('LEARNED');
  });
});

describe('protocolToProviderString', () => {
  it('uppercases the protocol', () => {
    expect(protocolToProviderString('tcp')).toBe('TCP');
    expect(protocolToProviderString('udp')).toBe('UDP');
    expect(protocolToProviderString('icmp')).toBe('ICMP');
    expect(protocolToProviderString('any')).toBe('ANY');
  });
});

describe('sanitizeMapKey', () => {
  it('lowercases and replaces punctuation/whitespace with dashes', () => {
    expect(sanitizeMapKey('Web Tier (prod)', new Set())).toBe('web-tier-prod');
  });

  it('falls back to "unnamed" when the input collapses to empty', () => {
    expect(sanitizeMapKey('!!!', new Set())).toBe('unnamed');
    expect(sanitizeMapKey('', new Set())).toBe('unnamed');
  });

  it('prefixes a digit-leading name with underscore', () => {
    expect(sanitizeMapKey('365-tenant', new Set())).toBe('_365-tenant');
  });

  it('appends a numeric suffix on collision', () => {
    const taken = new Set(['web-tier']);
    const k = sanitizeMapKey('web tier', taken);
    expect(k).toBe('web-tier-2');
  });

  it('keeps suffix-incrementing across multiple collisions', () => {
    const taken = new Set(['web-tier', 'web-tier-2', 'web-tier-3']);
    expect(sanitizeMapKey('web tier', taken)).toBe('web-tier-4');
  });

  it('preserves underscores', () => {
    expect(sanitizeMapKey('on_prem', new Set())).toBe('on_prem');
  });
});
