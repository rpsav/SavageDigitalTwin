import { deleteMemory } from '@/lib/memory';

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  deleteMemory(id);
  return new Response(null, { status: 204 });
}
