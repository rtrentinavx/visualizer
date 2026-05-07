import type { DcfPolicyModel } from '../types/dcf';

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  unlockedAt?: string;
}

const STORAGE_KEY = 'dcf-achievements-v1';

export const ACHIEVEMENT_DEFS: Achievement[] = [
  { id: 'first-policy', name: 'Policy Creator', description: 'Create your first DCF policy.', icon: '📝' },
  { id: 'first-group', name: 'Group Maker', description: 'Create your first SmartGroup.', icon: '📦' },
  { id: 'deny-master', name: 'Deny Master', description: 'Create a deny policy with logging enabled.', icon: '🛡️' },
  { id: 'specificity-king', name: 'Specificity King', description: 'Create a policy with a score of 90 or higher.', icon: '👑' },
  { id: 'full-coverage', name: 'Full Coverage', description: 'Have at least 5 policies covering different group pairs.', icon: '🕸️' },
  { id: 'deny-all', name: 'Safety Net', description: 'Have a deny-all (any-to-any) policy.', icon: '🚨' },
  { id: 'zero-shadow', name: 'Zero Shadow', description: 'Have a topology with no shadowed policies.', icon: '☀️' },
  { id: 'high-performer', name: 'High Performer', description: 'Achieve an average topology score of 80+.', icon: '🏆' },
  { id: 'ten-policies', name: 'Policy Pro', description: 'Create 10 or more policies.', icon: '💼' },
  { id: 'simulator-pro', name: 'Simulator Pro', description: 'Run 5 traffic simulations.', icon: '🔬' },
];

export function loadAchievements(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveAchievements(unlocked: Record<string, string>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(unlocked));
}

export function checkAchievements(
  topology: DcfPolicyModel,
  simCount: number,
  scores: Map<string, number>
): Achievement[] {
  const unlocked = loadAchievements();
  const newlyUnlocked: Achievement[] = [];

  function unlock(id: string) {
    if (!unlocked[id]) {
      unlocked[id] = new Date().toISOString();
      const def = ACHIEVEMENT_DEFS.find((a) => a.id === id);
      if (def) {
        newlyUnlocked.push({ ...def, unlockedAt: unlocked[id] });
      }
    }
  }

  // first-policy
  if (topology.policies.length > 0) unlock('first-policy');

  // first-group
  if (topology.smartGroups.length > 1) unlock('first-group'); // >1 because sg-internet is default

  // deny-master
  if (topology.policies.some((p) => p.action === 'deny' && p.logging)) unlock('deny-master');

  // specificity-king
  for (const [, score] of scores) {
    if (score >= 90) {
      unlock('specificity-king');
      break;
    }
  }

  // full-coverage
  const uniquePairs = new Set(topology.policies.map((p) => `${p.srcGroupId}|${p.dstGroupId}`));
  if (uniquePairs.size >= 5) unlock('full-coverage');

  // deny-all
  if (topology.policies.some((p) => p.action === 'deny' && p.srcGroupId === 'sg-any' && p.dstGroupId === 'sg-any')) {
    unlock('deny-all');
  }

  // zero-shadow
  const hasShadow = topology.policies.some((p) => {
    return topology.policies.some((other) => {
      if (other.id === p.id) return false;
      if (other.priority >= p.priority) return false;
      const sameSrc = other.srcGroupId === p.srcGroupId || other.srcGroupId === 'sg-any' || p.srcGroupId === 'sg-any';
      const sameDst = other.dstGroupId === p.dstGroupId || other.dstGroupId === 'sg-any' || p.dstGroupId === 'sg-any';
      const sameProto = other.protocol === p.protocol || other.protocol === 'any' || p.protocol === 'any';
      return sameSrc && sameDst && sameProto;
    });
  });
  if (!hasShadow && topology.policies.length > 0) unlock('zero-shadow');

  // high-performer
  if (scores.size > 0) {
    const avg = Math.round([...scores.values()].reduce((a, b) => a + b, 0) / scores.size);
    if (avg >= 80) unlock('high-performer');
  }

  // ten-policies
  if (topology.policies.length >= 10) unlock('ten-policies');

  // simulator-pro
  if (simCount >= 5) unlock('simulator-pro');

  if (newlyUnlocked.length > 0) {
    saveAchievements(unlocked);
  }

  return newlyUnlocked;
}

export function getAllAchievements(): Achievement[] {
  const unlocked = loadAchievements();
  return ACHIEVEMENT_DEFS.map((def) => ({
    ...def,
    unlockedAt: unlocked[def.id],
  }));
}
