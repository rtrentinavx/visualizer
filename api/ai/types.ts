// Shared types for the AI proxy and its per-provider modules.
// Client-side AI types live in `src/lib/ai/types.ts`; do not confuse the two.

export type ChatMessage = { role: string; content: string };
