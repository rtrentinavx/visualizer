import type { DcfTopology } from '../types/dcf';

const API_PATH = '/api/topology';

export async function saveTopologyToCloud(topology: DcfTopology, id: string = 'default'): Promise<void> {
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

export async function loadTopologyFromCloud(id: string = 'default'): Promise<DcfTopology | null> {
  const response = await fetch(`${API_PATH}?id=${encodeURIComponent(id)}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to load topology');
  }
  const data = await response.json();
  return data.topology ? JSON.parse(data.topology) : null;
}
