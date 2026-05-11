import type { DcfPolicyModel } from '../types/dcf';

const API_PATH = '/api/topology';

const REQUIRED_KEYS: Array<keyof DcfPolicyModel> = [
  'smartGroups',
  'webGroups',
  'threatGroups',
  'geoGroups',
  'policies',
  'flows',
];

function isValidTopology(value: unknown): value is DcfPolicyModel {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return REQUIRED_KEYS.every((key) => Array.isArray(record[key]));
}

export async function saveTopologyToCloud(topology: DcfPolicyModel, id: string = 'default'): Promise<void> {
  const response = await fetch(`${API_PATH}?id=${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topology }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to save topology');
  }
}

export async function loadTopologyFromCloud(id: string = 'default'): Promise<DcfPolicyModel | null> {
  const response = await fetch(`${API_PATH}?id=${encodeURIComponent(id)}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to load topology');
  }
  const data = await response.json();
  if (!data.topology) return null;
  const parsed = typeof data.topology === 'string' ? JSON.parse(data.topology) : data.topology;
  return isValidTopology(parsed) ? parsed : null;
}
