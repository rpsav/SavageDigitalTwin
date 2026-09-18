import {
  getMessages,
  renameConversation,
  deleteConversation,
  conversationExists,
} from '@/lib/conversations';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  if (!conversationExists(id)) return new Response('Not found', { status: 404 });
  return Response.json(getMessages(id));
}

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const { title } = await req.json();
  if (!title || typeof title !== 'string') {
    return new Response('title required', { status: 400 });
  }
  renameConversation(id, title);
  return new Response(null, { status: 204 });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  deleteConversation(id);
  return new Response(null, { status: 204 });
}
