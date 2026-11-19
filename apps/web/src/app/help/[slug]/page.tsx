import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HELP } from '@/lib/help-content';

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return HELP.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const a = HELP.find((x) => x.slug === slug);
  return { title: a?.title ?? 'Справка' };
}

export default async function HelpArticlePage({ params }: Props) {
  const { slug } = await params;
  const a = HELP.find((x) => x.slug === slug);
  if (!a) notFound();
  return (
    <div className="container-page max-w-3xl py-8">
      <Link href="/help" className="text-sm font-semibold text-brand-600 hover:underline">
        ← Справочный центр
      </Link>
      <article className="mt-3 rounded-2xl bg-white p-6 md:p-8">
        <h1 className="mb-4 text-2xl font-extrabold md:text-3xl">{a.title}</h1>
        <div className="space-y-3 leading-relaxed text-ink-700">
          {a.body.map((p, i) => (
            <p key={i} className={p.startsWith('ЧЕРНОВИК') ? 'rounded-lg bg-accent-50 px-3 py-2 text-sm font-semibold text-accent-700' : ''}>
              {p}
            </p>
          ))}
        </div>
      </article>
    </div>
  );
}
