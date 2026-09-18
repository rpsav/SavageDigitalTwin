import { listConversations, createConversation } from '@/lib/conversations';

export async function GET() {
  return Response.json(listConversations());
}

export async function POST(req: Request) {
  const { title } = await req.json().catch(() => ({ title: 'New chat' }));
  const id = createConversation(title ?? 'New chat');
  return Response.json({ id });
}
