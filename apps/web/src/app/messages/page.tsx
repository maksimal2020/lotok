'use client';

import { ConversationList, NoChat } from '@/components/chat';
import { Spinner } from '@/components/ui';
import { useRequireAuth } from '@/lib/auth';

export default function MessagesPage() {
  const { user } = useRequireAuth();
  if (!user) return <div className="flex justify-center py-20"><Spinner /></div>;
  return (
    <div className="container-page py-4 md:py-6">
      <h1 className="mb-4 text-2xl font-extrabold">Сообщения</h1>
      <div className="grid h-[calc(100vh-14rem)] min-h-[480px] overflow-hidden rounded-2xl bg-white md:grid-cols-[340px_1fr]">
        <ConversationList />
        <div className="hidden items-center justify-center border-l border-ink-100 md:flex">
          <NoChat />
        </div>
      </div>
    </div>
  );
}
