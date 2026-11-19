import type { Metadata } from 'next';
import Link from 'next/link';
import { HELP } from '@/lib/help-content';

export const metadata: Metadata = { title: 'Справочный центр' };

export default function HelpPage() {
  const sections = [...new Set(HELP.map((a) => a.section))];
  return (
    <div className="container-page max-w-4xl py-8">
      <h1 className="mb-2 text-3xl font-extrabold">Справочный центр</h1>
      <p className="mb-6 text-ink-500">Ответы на частые вопросы о покупке, продаже и безопасности.</p>
      <div className="grid gap-5 md:grid-cols-2">
        {sections.map((s) => (
          <section key={s} className="rounded-2xl bg-white p-5">
            <h2 className="mb-3 text-lg font-bold">{s}</h2>
            <ul className="space-y-2">
              {HELP.filter((a) => a.section === s).map((a) => (
                <li key={a.slug}>
                  <Link href={`/help/${a.slug}`} className="text-brand-600 hover:underline">
                    {a.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
