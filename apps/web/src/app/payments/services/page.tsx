'use client';

import { ServicesGrid } from '@/components/services';
import { PageTitle } from '@/components/ui';

export default function ServicesPage() {
  return (
    <div className="container-page max-w-5xl space-y-8 py-6">
      <PageTitle>Платные услуги и тарифы</PageTitle>
      <section>
        <h2 className="mb-3 text-xl font-bold">Для профессиональных продавцов и компаний</h2>
        <ServicesGrid types={['pro_subscription', 'analytics']} />
      </section>
      <section>
        <h2 className="mb-3 text-xl font-bold">Публикации сверх бесплатного лимита</h2>
        <ServicesGrid types={['listing_slot', 'listing_package']} />
      </section>
      <p className="text-sm text-ink-500">Продвижение конкретного объявления (поднятие, выделение, премиум) подключается со страницы объявления — кнопка «Продвинуть».</p>
    </div>
  );
}
