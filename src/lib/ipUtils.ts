/**
 * Convert an IPv4 string to a 32-bit integer.
 */
function ipToInt(ip: string): number {
  const parts = ip.split('.');
  if (parts.length !== 4) return -1;
  const [a, b, c, d] = parts;
  if (a === undefined || b === undefined || c === undefined || d === undefined) return -1;
  return (
    (parseInt(a, 10) << 24) |
    (parseInt(b, 10) << 16) |
    (parseInt(c, 10) << 8) |
    parseInt(d, 10)
  ) >>> 0;
}

/**
 * Check if an IPv4 address falls within a CIDR block.
 * Supports formats like "10.0.0.0/24" or "10.0.0.0/255.255.255.0".
 */
export function ipInCidr(ip: string, cidr: string): boolean {
  const [baseIp, maskStr] = cidr.split('/');
  if (!baseIp || !maskStr) return false;

  const ipInt = ipToInt(ip);
  const baseInt = ipToInt(baseIp);
  if (ipInt === -1 || baseInt === -1) return false;

  let maskBits: number;
  if (maskStr.includes('.')) {
    // Dotted decimal mask
    maskBits = ipToInt(maskStr);
    if (maskBits === -1) return false;
  } else {
    const prefix = parseInt(maskStr, 10);
    if (Number.isNaN(prefix) || prefix < 0 || prefix > 32) return false;
    // /0 must yield mask 0; `~0 << 32` in JS shifts by 32 mod 32 = 0, which is wrong.
    maskBits = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  }

  return (ipInt & maskBits) === (baseInt & maskBits);
}

/**
 * Validate that a string is a valid IPv4 address.
 */
export function isValidIPv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    const num = parseInt(part, 10);
    return !isNaN(num) && num >= 0 && num <= 255 && String(num) === part;
  });
}
