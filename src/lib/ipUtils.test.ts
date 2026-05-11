import { describe, it, expect } from 'vitest';
import { ipInCidr, isValidIPv4 } from './ipUtils';

describe('ipInCidr', () => {
  it('matches an IP inside a /24 subnet', () => {
    expect(ipInCidr('10.0.0.5', '10.0.0.0/24')).toBe(true);
  });

  it('rejects an IP outside a /24 subnet', () => {
    expect(ipInCidr('10.0.1.5', '10.0.0.0/24')).toBe(false);
  });

  it('matches an IP at the subnet boundary (network address)', () => {
    expect(ipInCidr('10.0.0.0', '10.0.0.0/24')).toBe(true);
  });

  it('matches an IP at the broadcast address of the subnet', () => {
    expect(ipInCidr('10.0.0.255', '10.0.0.0/24')).toBe(true);
  });

  it('rejects the IP just past the broadcast', () => {
    expect(ipInCidr('10.0.1.0', '10.0.0.0/24')).toBe(false);
  });

  it('/32 matches only the exact single address', () => {
    expect(ipInCidr('192.168.1.1', '192.168.1.1/32')).toBe(true);
    expect(ipInCidr('192.168.1.2', '192.168.1.1/32')).toBe(false);
  });

  it('/0 matches every IPv4 address', () => {
    expect(ipInCidr('0.0.0.0', '0.0.0.0/0')).toBe(true);
    expect(ipInCidr('255.255.255.255', '0.0.0.0/0')).toBe(true);
    expect(ipInCidr('8.8.8.8', '0.0.0.0/0')).toBe(true);
  });

  it('supports dotted-decimal masks', () => {
    expect(ipInCidr('10.0.0.5', '10.0.0.0/255.255.255.0')).toBe(true);
    expect(ipInCidr('10.0.1.5', '10.0.0.0/255.255.255.0')).toBe(false);
  });

  it('returns false for a malformed CIDR (missing slash)', () => {
    expect(ipInCidr('10.0.0.5', '10.0.0.0')).toBe(false);
  });

  it('returns false when the base IP is malformed', () => {
    expect(ipInCidr('10.0.0.5', 'not-an-ip/24')).toBe(false);
  });
});

describe('isValidIPv4', () => {
  it('accepts a normal IPv4 address', () => {
    expect(isValidIPv4('192.168.1.1')).toBe(true);
  });

  it('accepts boundary addresses 0.0.0.0 and 255.255.255.255', () => {
    expect(isValidIPv4('0.0.0.0')).toBe(true);
    expect(isValidIPv4('255.255.255.255')).toBe(true);
  });

  it('rejects an octet greater than 255', () => {
    expect(isValidIPv4('10.0.0.256')).toBe(false);
    expect(isValidIPv4('300.0.0.1')).toBe(false);
  });

  it('rejects fewer than four segments', () => {
    expect(isValidIPv4('10.0.0')).toBe(false);
    expect(isValidIPv4('10.0')).toBe(false);
  });

  it('rejects more than four segments', () => {
    expect(isValidIPv4('10.0.0.0.1')).toBe(false);
  });

  it('rejects non-digit characters in an octet', () => {
    expect(isValidIPv4('10.0.0.abc')).toBe(false);
    expect(isValidIPv4('10.0.x.1')).toBe(false);
  });

  it('rejects leading zeros (since String(num) must equal the original)', () => {
    expect(isValidIPv4('010.0.0.1')).toBe(false);
  });

  it('rejects empty string and empty octets', () => {
    expect(isValidIPv4('')).toBe(false);
    expect(isValidIPv4('10..0.1')).toBe(false);
    expect(isValidIPv4('.10.0.0.1')).toBe(false);
  });
});
