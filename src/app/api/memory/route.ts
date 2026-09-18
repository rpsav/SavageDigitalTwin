import { listMemories, clearMemories } from '@/lib/memory';

export async function GET() {
  return Response.json(listMemories());
}

export async function DELETE() {
  clearMemories();
  return new Response(null, { status: 204 });
}
