import { createLogger, since } from './log';

const log = createLogger('embeddings');

const OLLAMA_EMBED_URL = 'http://localhost:11434/v1/embeddings';
const EMBED_MODEL = 'nomic-embed-text';

export async function embed(text: string): Promise<number[]> {
  const started = Date.now();
  log.debug(`embedding ${text.length} chars with ${EMBED_MODEL}`);
  const res = await fetch(OLLAMA_EMBED_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    log.error(`Ollama returned ${res.status} ${res.statusText}: ${detail}`);
    throw new Error(`Embedding failed: ${res.statusText}`);
  }
  const json = await res.json();
  const vector = json.data[0].embedding as number[];
  log.debug(`embedded into ${vector.length} dimensions in ${since(started)}`);
  return vector;
}

export function toBlob(embedding: number[]): Buffer {
  return Buffer.from(new Float32Array(embedding).buffer);
}
