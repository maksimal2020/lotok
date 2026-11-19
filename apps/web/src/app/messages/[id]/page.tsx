'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { use } from 'react';
import { ChatWindow, ConversationList } from '@/components/chat';
import { Spinner } from '@/components/ui';
import { useRequireAuth } from '@/lib/auth';

export default function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useRequireAuth();
  if (!user) return <div className="flex justify-center py-20"><Spinner /></div>;
  return (
    <div className="container-page py-2 md:py-6">
      <Link href="/messages" className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 md:hidden">
        <ArrowLeft className="size-4" /> Все диалоги
      </Link>
      <div className="grid h-[calc(100vh-12rem)] min-h-[480px] overflow-hidden rounded-2xl bg-white md:grid-cols-[340px_1fr]">
        <div className="hidden border-r border-ink-100 md:block">
          <ConversationList activeId={id} />
        </div>
        <ChatWindow id={id} />
      </div>
    </div>
  );
}
