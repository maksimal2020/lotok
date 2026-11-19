'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { canAssignRole, LABELS, ROLES, type Paginated, type Role } from '@lotok/shared';
import { DataTable } from '@/components/shell';
import { Badge, Button, Checkbox, ErrorState, Field, Input, Modal, PageTitle, Pagination, Select, Spinner, useConfirm, useToast } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAdmin } from '@/lib/auth';
import { dt, rub } from '@/lib/fmt';

interface UserRow {
  id: string;
  email: string | null;
  phone: string | null;
  displayName: string;
  status: string;
  blockedReason: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  roles: Role[];
}
interface UserDetail extends UserRow {
  listings: Record<string, number>;
  orders: number;
  activeSessions: number;
  complaintsAgainst: number;
  securityEvents: { id: number; type: string; ip: string | null; createdAt: string }[];
}

function UserModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { user: me, can } = useAdmin();
  const toast = useToast();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['admin-user', id], queryFn: () => api.get<UserDetail>(`/admin/users/${id}`), enabled: !!id });
  const [reason, setReason] = useState('');
  const [days, setDays] = useState('');
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [bonus, setBonus] = useState('');
  const u = q.data;
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
      void q.refetch();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const curRoles = roles ?? u?.roles ?? [];
  return (
    <Modal open={!!id} onClose={() => { setRoles(null); onClose(); }} title="Пользователь" size="lg">
      {!u ? <Spinner /> : (
        <div className="space-y-5 text-sm">
          <div>
            <div className="text-lg font-bold">{u.displayName}</div>
            <div className="text-ink-500">{u.email ?? '—'} {u.emailVerified && '✓'} · {u.phone ?? '—'} {u.phoneVerified && '✓'}</div>
            <div className="text-ink-500">Регистрация {dt(u.createdAt)} · заходил {dt(u.lastSeenAt)} · сеансов {u.activeSessions}</div>
            <div className="mt-1 flex flex-wrap gap-1">
              <Badge tone={u.status === 'active' ? 'success' : 'danger'}>{u.status}</Badge>
              {Object.entries(u.listings).map(([s, n]) => <Badge key={s}>{LABELS.listingStatus[s as keyof typeof LABELS.listingStatus]}: {n}</Badge>)}
              <Badge>заказов: {u.orders}</Badge>
              <Badge tone={u.complaintsAgainst ? 'warning' : 'neutral'}>жалоб: {u.complaintsAgainst}</Badge>
            </div>
            {u.blockedReason && <p className="mt-1 text-danger">Причина блокировки: {u.blockedReason}</p>}
          </div>
          {can('users.block') && u.id !== me?.id && (
            <div className="space-y-2 rounded-xl border border-ink-100 p-3">
              <div className="font-semibold">Блокировка</div>
              {u.status === 'blocked' ? (
                <Button variant="outline" onClick={() => run(() => api.post(`/admin/users/${u.id}/unblock`), 'Разблокирован')}>Разблокировать</Button>
              ) : (
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Причина" htmlFor="br"><Input id="br" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
                  <Field label="Срок, дней (пусто — бессрочно)" htmlFor="bd"><Input id="bd" type="number" min={1} className="w-32" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
                  <Button variant="danger" onClick={async () => {
                    if (!(await confirm({ title: 'Заблокировать пользователя?', text: 'Все сеансы будут завершены, объявления сняты.', danger: true, confirmText: 'Заблокировать' }))) return;
                    await run(() => api.post(`/admin/users/${u.id}/block`, { reason, until: days ? new Date(Date.now() + Number(days) * 86400000).toISOString() : undefined }), 'Заблокирован');
                  }}>Заблокировать</Button>
                </div>
              )}
            </div>
          )}
          {can('roles.manage') && (
            <div className="space-y-2 rounded-xl border border-ink-100 p-3">
              <div className="font-semibold">Роли</div>
              <div className="flex flex-wrap gap-x-4">
                {ROLES.map((r) => (
                  <Checkbox key={r} label={LABELS.role[r]} checked={curRoles.includes(r)} onChange={(v) => {
                    if (!canAssignRole(me!.roles, r)) return toast('Недостаточно прав для этой роли', 'error');
                    setRoles(v ? [...curRoles, r] : curRoles.filter((x) => x !== r));
                  }} />
                ))}
              </div>
              {roles && <Button size="sm" onClick={() => run(() => api.put(`/admin/users/${u.id}/roles`, { roles }), 'Роли обновлены').then(() => setRoles(null))}>Сохранить роли</Button>}
            </div>
          )}
          {can('payments.refund') && (
            <div className="flex flex-wrap items-end gap-2 rounded-xl border border-ink-100 p-3">
              <Field label="Начислить бонусы, ₽ (не деньги)" htmlFor="bn"><Input id="bn" type="number" min={1} className="w-40" value={bonus} onChange={(e) => setBonus(e.target.value)} /></Field>
              <Button variant="outline" disabled={!bonus} onClick={() => run(() => api.post(`/admin/users/${u.id}/bonus`, { amount: Math.round(Number(bonus) * 100), reason: 'Начисление администратором', key: `${u.id}-${Date.now()}` }), `Начислено ${rub(Number(bonus) * 100)}`).then(() => setBonus(''))}>Начислить</Button>
            </div>
          )}
          <div>
            <div className="mb-1 font-semibold">События безопасности</div>
            <ul className="max-h-48 space-y-0.5 overflow-y-auto text-ink-600">
              {u.securityEvents.map((e) => <li key={e.id}>{dt(e.createdAt)} · {e.type} · {e.ip}</li>)}
            </ul>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function UsersPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const r = useQuery({ queryKey: ['users', q, status, role, page], queryFn: () => api.get<Paginated<UserRow>>('/admin/users', { q: q || undefined, status: status || undefined, role: role || undefined, page, limit: 30 }) });
  return (
    <div>
      <PageTitle>Пользователи</PageTitle>
      <div className="mb-4 flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Email, имя, телефон, ID" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <Select className="w-auto!" aria-label="Статус" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Все статусы</option><option value="active">Активные</option><option value="blocked">Заблокированные</option><option value="deleted">Удалённые</option>
        </Select>
        <Select className="w-auto!" aria-label="Роль" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Любая роль</option>
          {ROLES.map((x) => <option key={x} value={x}>{LABELS.role[x]}</option>)}
        </Select>
      </div>
      {r.isError ? <ErrorState message={errorMessage(r.error)} /> : (
        <DataTable rows={r.data?.items} onRowClick={(u) => setOpen(u.id)} columns={[
          { key: 'n', label: 'Имя', render: (u) => <span className="font-semibold">{u.displayName}</span> },
          { key: 'e', label: 'Контакты', render: (u) => <span className="text-ink-600">{u.email}<br />{u.phone}</span> },
          { key: 's', label: 'Статус', render: (u) => <Badge tone={u.status === 'active' ? 'success' : 'danger'}>{u.status}</Badge> },
          { key: 'r', label: 'Роли', render: (u) => u.roles.map((x) => LABELS.role[x]).join(', ') },
          { key: 'c', label: 'Создан', render: (u) => dt(u.createdAt) },
        ]} />
      )}
      {r.data && <Pagination page={page} total={r.data.total} limit={30} onChange={setPage} />}
      <UserModal id={open} onClose={() => { setOpen(null); void r.refetch(); }} />
    </div>
  );
}
