import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Returns the public IP address that Vercel uses when making outbound
 * connections from this serverless function. Callers can display this to
 * users so they know which IP to allow-list on their Aviatrix Controller.
 *
 * We ask ipify (a stable, free, read-only IP-reflection service) for the
 * answer rather than hard-coding an IP that can change if Vercel rotates
 * egress nodes.
 */
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const r = await fetch('https://api.ipify.org?format=json', {
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error(`ipify HTTP ${r.status}`);
    const { ip } = await r.json() as { ip: string };
    return res.status(200).json({ ip });
  } catch (err) {
    console.error('[egress-ip] fetch failed', err);
    return res.status(502).json({ error: 'Could not determine egress IP.' });
  }
}
