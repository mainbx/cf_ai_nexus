import { Env } from '../types';

const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';

export async function generateEmbedding(env: Env, text: string): Promise<number[]> {
  const result: any = await env.AI.run(EMBEDDING_MODEL, { text: [text] });
  return result.data[0];
}

export async function upsertVector(env: Env, id: string, text: string, metadata: Record<string, string>) {
  if (!env.VECTORIZE) return; // Vectorize not configured
  const embedding = await generateEmbedding(env, text);
  await env.VECTORIZE.upsert([{ id, values: embedding, metadata }]);
}

export async function searchVectors(env: Env, query: string, topK = 5, filter?: Record<string, string>) {
  if (!env.VECTORIZE) return []; // Vectorize not configured — fall back to empty results
  const embedding = await generateEmbedding(env, query);
  const results = await env.VECTORIZE.query(embedding, {
    topK,
    returnMetadata: 'all',
    ...(filter ? { filter } : {}),
  });
  return results.matches;
}

export async function deleteVector(env: Env, id: string) {
  if (!env.VECTORIZE) return;
  await env.VECTORIZE.deleteByIds([id]);
}
