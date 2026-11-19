'use client';

import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Archive, ArchiveRestore, Ban, Check, CheckCheck, Clock, FileText, Paperclip, Send, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ConversationDto, CursorPage, MediaItem, MessageDto } from '@lotok/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { lastSeen, priceLabel, relativeDate, time } from '@/lib/format';
import { getSocket } from '@/lib/socket';
import { Alert, Avatar, Button, EmptyState, ErrorState, Input, Skeleton, Tabs, useConfirm, useToast } from './ui';

type Pending = MessageDto & { pending?: boolean; failed?: boolean };

export function ConversationList({ activeId }: { activeId?: string }) {
  const [archived, setArchived] = useState(false);
  const [q, setQ] = useState('');
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['conversations', archived, q],
    queryFn: () => api.get<CursorPage<ConversationDto>>('/conversations', { archived, q: q || undefined }),
  });
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const refresh = () => void qc.invalidateQueries({ queryKey: ['conversations'] });
    s.on('message:new', refresh);
    s.on('conversation:read', refresh);
    return () => {
      s.off('message:new', refresh);
      s.off('conversation:read', refresh);
    };
  }, [qc]);
  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-ink-100 p-3">
        <Tabs value={archived ? 'a' : 'm'} onChange={(v) => setArchived(v === 'a')} items={[{ value: 'm', label: 'Все' }, { value: 'a', label: 'Архив' }]} />
        <Input placeholder="Поиск по сообщениям" aria-label="Поиск по сообщениям" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="flex-1 overflow-y-auto">
        {list.isLoading &&
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-3 p-3">
              <Skeleton className="size-12 shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            </div>
          ))}
        {list.isError && <div className="p-3"><ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} /></div>}
        {list.data && !list.data.items.length && <p className="p-6 text-center text-ink-500">{q ? 'Ничего не найдено' : archived ? 'Архив пуст' : 'Здесь появятся ваши диалоги с продавцами и покупателями'}</p>}
        {list.data?.items.map((c) => (
          <Link key={c.id} href={`/messages/${c.id}`} className={clsx('flex gap-3 border-b border-ink-50 p-3 hover:bg-ink-50', c.id === activeId && 'bg-brand-50')}>
            <div className="relative size-12 shrink-0 overflow-hidden rounded-xl bg-ink-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {c.listing.photo?.thumb && <img src={c.listing.photo.thumb} alt="" className="size-full object-cover" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-bold">{c.counterpart.displayName}</span>
                <span className="shrink-0 text-xs text-ink-400">{relativeDate(c.updatedAt)}</span>
              </div>
              <div className="truncate text-sm text-ink-500">{c.listing.title}</div>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm text-ink-700">{c.lastMessage ? (c.lastMessage.type === 'image' ? '📷 Фото' : c.lastMessage.type === 'document' ? '📎 Документ' : c.lastMessage.body) : ''}</span>
                {c.unreadCount > 0 && <span className="shrink-0 rounded-full bg-brand-500 px-1.5 text-xs font-bold text-white">{c.unreadCount}</span>}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Status({ m }: { m: Pending }) {
  if (m.failed) return <span className="text-danger">не отправлено</span>;
  if (m.pending) return <Clock className="size-3.5" aria-label="Отправляется" />;
  if (m.readAt) return <CheckCheck className="size-3.5 text-brand-300" aria-label="Прочитано" />;
  if (m.deliveredAt) return <CheckCheck className="size-3.5" aria-label="Доставлено" />;
  return <Check className="size-3.5" aria-label="Отправлено" />;
}

function Bubble({ m, mine }: { m: Pending; mine: boolean }) {
  return (
    <div className={clsx('flex', mine ? 'justify-end' : 'justify-start')}>
      <div className={clsx('max-w-[80%] rounded-2xl px-3.5 py-2 shadow-sm', mine ? 'rounded-br-md bg-brand-500 text-white' : 'rounded-bl-md bg-white')}>
        {m.attachment?.kind === 'image' && m.attachment.urls.medium && (
          <a href={m.attachment.url ?? m.attachment.urls.large ?? '#'} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={m.attachment.urls.medium} alt="Изображение" className="mb-1 max-h-72 rounded-xl" />
          </a>
        )}
        {m.attachment?.kind === 'document' && (
          <a href={m.attachment.url ?? '#'} className="mb-1 flex items-center gap-2 underline" rel="noreferrer">
            <FileText className="size-4" /> {m.attachment.fileName}
          </a>
        )}
        {m.body && <p className="whitespace-pre-wrap break-anywhere text-[15px]">{m.body}</p>}
        <div className={clsx('mt-0.5 flex items-center justify-end gap-1 text-[11px]', mine ? 'text-white/75' : 'text-ink-400')}>
          {time(m.createdAt)} {mine && <Status m={m} />}
        </div>
      </div>
    </div>
  );
}

export function ChatWindow({ id }: { id: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [text, setText] = useState('');
  const [pending, setPending] = useState<Pending[]>([]);
  const [online, setOnline] = useState(true);
  const [typing, setTyping] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const conv = useQuery({ queryKey: ['conversation', id], queryFn: () => api.get<ConversationDto>(`/conversations/${id}`) });
  const msgs = useInfiniteQuery({
    queryKey: ['messages', id],
    queryFn: ({ pageParam }) => api.get<CursorPage<MessageDto>>(`/conversations/${id}/messages`, { before: pageParam as string | undefined, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const all: Pending[] = [...(msgs.data?.pages.slice().reverse().flatMap((p) => p.items) ?? [])];
  const known = new Set(all.map((m) => m.clientMessageId).filter(Boolean));
  const merged = [...all, ...pending.filter((p) => !known.has(p.clientMessageId))];

  const markRead = () => void api.post(`/conversations/${id}/read`).catch(() => undefined);

  useEffect(() => {
    markRead();
    const s = getSocket();
    if (!s) return;
    const onNew = (m: MessageDto) => {
      if (m.conversationId !== id) return;
      qc.setQueryData(['messages', id], (old: typeof msgs.data) => {
        if (!old) return old;
        if (old.pages.some((p) => p.items.some((x) => x.id === m.id))) return old;
        const [first, ...rest] = old.pages;
        return { ...old, pages: [{ ...first, items: [...first.items, m] }, ...rest] };
      });
      if (m.senderId !== user?.id) markRead();
    };
    const onReceipt = (e: { conversationId: string; messageIds: string[]; at: string }, field: 'readAt' | 'deliveredAt') => {
      if (e.conversationId !== id) return;
      qc.setQueryData(['messages', id], (old: typeof msgs.data) =>
        old && { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.map((x) => (e.messageIds.includes(x.id) ? { ...x, [field]: x[field] ?? e.at, ...(field === 'readAt' ? { deliveredAt: x.deliveredAt ?? e.at } : {}) } : x)) })) },
      );
    };
    const onRead = (e: { conversationId: string; messageIds: string[]; at: string }) => onReceipt(e, 'readAt');
    const onDelivered = (e: { conversationId: string; messageIds: string[]; at: string }) => onReceipt(e, 'deliveredAt');
    let typingTimer: ReturnType<typeof setTimeout>;
    const onTyping = (e: { conversationId: string }) => {
      if (e.conversationId !== id) return;
      setTyping(true);
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => setTyping(false), 3000);
    };
    // После переподключения досинхронизируем историю, пропущенную во время обрыва.
    const onConnect = () => {
      setOnline(true);
      void msgs.refetch();
    };
    const onDisconnect = () => setOnline(false);
    s.on('message:new', onNew);
    s.on('message:read', onRead);
    s.on('message:delivered', onDelivered);
    s.on('typing', onTyping);
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    setOnline(s.connected);
    return () => {
      s.off('message:new', onNew);
      s.off('message:read', onRead);
      s.off('message:delivered', onDelivered);
      s.off('typing', onTyping);
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user?.id]);

  useLayoutEffect(() => bottom.current?.scrollIntoView({ block: 'end' }), [merged.length]);

  const send = async (body: string, attachmentMediaId?: string) => {
    const clientMessageId = `c${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
    const temp: Pending = { id: clientMessageId, conversationId: id, senderId: user!.id, type: attachmentMediaId ? 'image' : 'text', body, attachment: null, clientMessageId, createdAt: new Date().toISOString(), deliveredAt: null, readAt: null, pending: true };
    setPending((p) => [...p, temp]);
    const s = getSocket();
    try {
      let msg: MessageDto;
      if (s?.connected) {
        const ack = (await s.timeout(10_000).emitWithAck('message:send', { conversationId: id, body, attachmentMediaId, clientMessageId })) as { ok: boolean; data?: MessageDto; message?: string };
        if (!ack.ok) throw new Error(ack.message);
        msg = ack.data!;
      } else {
        // Без WebSocket — отправка через REST (тот же clientMessageId защищает от дублей).
        msg = await api.post<MessageDto>(`/conversations/${id}/messages`, { body, attachmentMediaId, clientMessageId });
      }
      qc.setQueryData(['messages', id], (old: typeof msgs.data) => {
        if (!old || old.pages.some((p) => p.items.some((x) => x.id === msg.id))) return old;
        const [first, ...rest] = old.pages;
        return { ...old, pages: [{ ...first, items: [...first.items, msg] }, ...rest] };
      });
      setPending((p) => p.filter((x) => x.clientMessageId !== clientMessageId));
    } catch (e) {
      setPending((p) => p.map((x) => (x.clientMessageId === clientMessageId ? { ...x, pending: false, failed: true } : x)));
      toast(errorMessage(e), 'error');
    }
  };

  const c = conv.data;
  if (conv.isError) return <ErrorState message={errorMessage(conv.error)} />;
  const blocked = c?.blockedByMe || c?.blockedMe;
  return (
    <div className="flex h-full flex-col">
      {c ? (
        <div className="flex items-center gap-3 border-b border-ink-100 bg-white p-3">
          <Avatar name={c.counterpart.displayName} url={c.counterpart.avatarUrl} />
          <div className="min-w-0 flex-1">
            <Link href={`/u/${c.counterpart.id}`} className="block truncate font-bold hover:text-brand-600">
              {c.counterpart.displayName}
            </Link>
            <div className="truncate text-xs text-ink-500">{typing ? 'печатает…' : lastSeen(c.counterpart.lastSeenAt)}</div>
          </div>
          <Link href={`/listing/${c.listing.id}`} className="hidden max-w-[220px] items-center gap-2 rounded-xl bg-ink-50 p-1.5 pr-3 sm:flex">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {c.listing.photo?.thumb && <img src={c.listing.photo.thumb} alt="" className="size-9 rounded-lg object-cover" />}
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{c.listing.title}</span>
              <span className="block text-xs text-ink-500">{priceLabel({ price: c.listing.price, priceType: 'fixed' })}</span>
            </span>
          </Link>
          <button
            title={c.archived ? 'Вернуть из архива' : 'В архив'}
            aria-label={c.archived ? 'Вернуть из архива' : 'В архив'}
            className="rounded-lg p-2 text-ink-500 hover:bg-ink-100"
            onClick={async () => {
              await api.post(`/conversations/${id}/${c.archived ? 'unarchive' : 'archive'}`);
              void conv.refetch();
              void qc.invalidateQueries({ queryKey: ['conversations'] });
            }}
          >
            {c.archived ? <ArchiveRestore className="size-5" /> : <Archive className="size-5" />}
          </button>
          <button
            title={c.blockedByMe ? 'Разблокировать' : 'Заблокировать'}
            aria-label={c.blockedByMe ? 'Разблокировать собеседника' : 'Заблокировать собеседника'}
            className="rounded-lg p-2 text-ink-500 hover:bg-ink-100"
            onClick={async () => {
              if (!c.blockedByMe && !(await confirm({ title: 'Заблокировать пользователя?', text: 'Он не сможет писать вам и оформлять заказы по вашим объявлениям.', danger: true, confirmText: 'Заблокировать' }))) return;
              if (c.blockedByMe) await api.delete(`/users/${c.counterpart.id}/block`);
              else await api.post(`/users/${c.counterpart.id}/block`);
              void conv.refetch();
            }}
          >
            <Ban className="size-5" />
          </button>
        </div>
      ) : (
        <div className="p-3"><Skeleton className="h-12" /></div>
      )}
      {!online && (
        <div className="flex items-center gap-2 bg-accent-50 px-4 py-2 text-sm text-accent-700">
          <WifiOff className="size-4" /> Нет соединения. Переподключаемся… Сообщения будут отправлены через сервер.
        </div>
      )}
      <div className="flex-1 space-y-2 overflow-y-auto bg-ink-50 p-4">
        {msgs.hasNextPage && (
          <div className="text-center">
            <Button size="sm" variant="ghost" loading={msgs.isFetchingNextPage} onClick={() => msgs.fetchNextPage()}>
              Показать ранние сообщения
            </Button>
          </div>
        )}
        {msgs.isLoading && <Skeleton className="h-24" />}
        {merged.map((m) => (
          <Bubble key={m.id} m={m} mine={m.senderId === user?.id} />
        ))}
        <div ref={bottom} />
      </div>
      {blocked ? (
        <div className="p-4">
          <Alert tone="warning">{c?.blockedByMe ? 'Вы заблокировали собеседника.' : 'Собеседник ограничил переписку.'}</Alert>
        </div>
      ) : (
        <form
          className="flex items-end gap-2 border-t border-ink-100 bg-white p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const body = text.trim();
            if (!body) return;
            setText('');
            void send(body);
          }}
        >
          <button type="button" aria-label="Прикрепить изображение или документ" className="rounded-lg p-2.5 text-ink-500 hover:bg-ink-100" onClick={() => fileRef.current?.click()}>
            <Paperclip className="size-5" />
          </button>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept="image/jpeg,image/png,image/webp,application/pdf,.docx,.xlsx,.txt"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                const form = new FormData();
                form.append('file', f);
                let m = await api.upload<MediaItem>('/media?purpose=chat', form);
                for (let i = 0; i < 30 && m.status !== 'ready' && m.status !== 'failed'; i++) {
                  await new Promise((r) => setTimeout(r, 700));
                  m = await api.get<MediaItem>(`/media/${m.id}`);
                }
                if (m.status !== 'ready') throw new Error('Файл не удалось обработать');
                await send('', m.id);
              } catch (err) {
                toast(errorMessage(err), 'error');
              }
            }}
          />
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              getSocket()?.emit('typing', { conversationId: id });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                (e.currentTarget.form as HTMLFormElement).requestSubmit();
              }
            }}
            rows={1}
            maxLength={4000}
            placeholder="Сообщение"
            aria-label="Сообщение"
            className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-ink-200 px-3.5 py-2.5 text-[15px] focus:border-brand-400 focus:outline-none"
          />
          <Button type="submit" aria-label="Отправить" disabled={!text.trim()}>
            <Send className="size-4.5" />
          </Button>
        </form>
      )}
    </div>
  );
}

export function NoChat() {
  return <EmptyState title="Выберите диалог" text="Здесь будет переписка с продавцом или покупателем." />;
}
