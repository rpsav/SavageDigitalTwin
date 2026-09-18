const OLLAMA_EMBED_URL = 'http://localhost:11434/v1/embeddings';
const EMBED_MODEL = 'nomic-embed-text';

export async function embed(text: string): Promise<number[]> {
  const res = await fetch(OLLAMA_EMBED_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`Embedding failed: ${res.statusText}`);
  const json = await res.json();
  return json.data[0].embedding as number[];
}

export function toBlob(embedding: number[]): Buffer {
  return Buffer.from(new Float32Array(embedding).buffer);
}
