'use client';

import { Search, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import type { Suggestion } from '@lotok/shared';
import { api } from '@/lib/api';

/** Строка поиска с автодополнением (клавиатурная навигация, ARIA combobox). */
export function SearchBar({ autoFocus }: { autoFocus?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => setQ(params.get('q') ?? ''), [params]);

  useEffect(() => {
    clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setItems([]);
      return;
    }
    const ctrl = new AbortController();
    timer.current = setTimeout(() => {
      api
        .get<Suggestion[]>('/search/suggest', { q }, ctrl.signal)
        .then((r) => setItems(r))
        .catch(() => undefined);
    }, 180);
    return () => ctrl.abort();
  }, [q]);

  const go = (s?: Suggestion) => {
    setOpen(false);
    const sp = new URLSearchParams();
    if (s?.categoryId) sp.set('categoryId', String(s.categoryId));
    else if (s) sp.set('q', s.text);
    else if (q.trim()) sp.set('q', q.trim());
    const city = params.get('cityId');
    if (city) sp.set('cityId', city);
    router.push(`/search?${sp.toString()}`);
  };

  return (
    <form
      role="search"
      className="relative flex-1"
      onSubmit={(e) => {
        e.preventDefault();
        go(active >= 0 ? items[active] : undefined);
      }}
    >
      <div className="flex h-11 items-center rounded-xl border-2 border-brand-500 bg-white focus-within:ring-4 focus-within:ring-brand-100">
        <Search className="ml-3 size-5 shrink-0 text-ink-400" aria-hidden />
        <input
          name="q"
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, items.length - 1));
            if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, -1));
            if (e.key === 'Escape') setOpen(false);
          }}
          placeholder="Поиск по объявлениям"
          aria-label="Поиск по объявлениям"
          role="combobox"
          aria-expanded={open && items.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          className="h-full min-w-0 flex-1 bg-transparent px-2 text-[15px] outline-none"
        />
        {q && (
          <button type="button" onClick={() => setQ('')} className="p-2 text-ink-400 hover:text-ink-700" aria-label="Очистить">
            <X className="size-4" />
          </button>
        )}
        <button type="submit" className="mr-1 h-8 rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600">
          Найти
        </button>
      </div>
      {open && items.length > 0 && (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-12 z-40 overflow-hidden rounded-xl border border-ink-100 bg-white py-1 shadow-[var(--shadow-pop)]">
          {items.map((s, i) => (
            <li
              key={`${s.text}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                go(s);
              }}
              className={`flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-[15px] ${i === active ? 'bg-ink-50' : 'hover:bg-ink-50'}`}
            >
              <span className="truncate">{s.text}</span>
              {s.categoryName && <span className="shrink-0 text-xs font-semibold text-brand-600">категория</span>}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
