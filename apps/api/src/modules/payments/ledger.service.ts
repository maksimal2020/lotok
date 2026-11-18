import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { DB, type Db, type DbOrTx } from '../../database/database.module';
import { ledgerAccounts, ledgerEntries, ledgerTransactions } from '../../database/schema';
import { Errors } from '../../common/errors';

export type LedgerAccountType = (typeof ledgerAccounts.$inferSelect)['type'];

export interface LedgerPosting {
  kind: string;
  description: string;
  idempotencyKey: string;
  paymentId?: string | null;
  orderId?: string | null;
  purchaseId?: string | null;
  entries: { account: LedgerAccountType; userId?: string | null; amount: number }[];
}

/**
 * Двойная запись. Инварианты:
 *  — сумма проводок каждой операции равна нулю;
 *  — операция с тем же idempotencyKey проводится не более одного раза;
 *  — бонусный баланс не может стать отрицательным (CHECK в БД);
 *  — средства продавцов (seller_payable), выручка (platform_revenue) и бонусы (user_bonus) — разные счета.
 */
@Injectable()
export class LedgerService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async account(tx: DbOrTx, type: LedgerAccountType, userId: string | null): Promise<number> {
    const cond = and(eq(ledgerAccounts.type, type), userId ? eq(ledgerAccounts.userId, userId) : isNull(ledgerAccounts.userId), eq(ledgerAccounts.currency, 'RUB'));
    const [found] = await tx.select({ id: ledgerAccounts.id }).from(ledgerAccounts).where(cond);
    if (found) return found.id;
    await tx.insert(ledgerAccounts).values({ type, userId, currency: 'RUB' }).onConflictDoNothing();
    const [created] = await tx.select({ id: ledgerAccounts.id }).from(ledgerAccounts).where(cond);
    return created.id;
  }

  /** Возвращает false, если операция уже была проведена ранее. */
  async post(tx: DbOrTx, p: LedgerPosting): Promise<boolean> {
    const nonZero = p.entries.filter((e) => e.amount !== 0);
    if (!nonZero.length) return false;
    const total = nonZero.reduce((s, e) => s + e.amount, 0);
    if (total !== 0) throw new Error(`Unbalanced ledger posting ${p.kind}: ${total}`);
    const [txRow] = await tx
      .insert(ledgerTransactions)
      .values({ kind: p.kind, description: p.description, idempotencyKey: p.idempotencyKey, paymentId: p.paymentId ?? null, orderId: p.orderId ?? null, purchaseId: p.purchaseId ?? null })
      .onConflictDoNothing()
      .returning({ id: ledgerTransactions.id });
    if (!txRow) return false;
    for (const e of nonZero) {
      const accountId = await this.account(tx, e.account, e.userId ?? null);
      await tx.insert(ledgerEntries).values({ transactionId: txRow.id, accountId, amount: e.amount });
      await tx
        .update(ledgerAccounts)
        .set({ balance: sql`${ledgerAccounts.balance} + ${e.amount}` })
        .where(eq(ledgerAccounts.id, accountId));
    }
    return true;
  }

  async balance(type: LedgerAccountType, userId: string | null, tx: DbOrTx = this.db) {
    const cond = and(eq(ledgerAccounts.type, type), userId ? eq(ledgerAccounts.userId, userId) : isNull(ledgerAccounts.userId));
    const [r] = await tx.select({ b: ledgerAccounts.balance }).from(ledgerAccounts).where(cond);
    return r?.b ?? 0;
  }

  /** Начисление бонусов (маркетинг, компенсации). Бонусы — не деньги, обналичить нельзя. */
  async issueBonus(userId: string, amount: number, reason: string, idempotencyKey: string) {
    if (amount <= 0) throw Errors.badRequest('invalid_amount', 'Сумма должна быть положительной');
    return this.db.transaction((tx) =>
      this.post(tx, {
        kind: 'bonus_issue',
        description: reason,
        idempotencyKey,
        entries: [
          { account: 'user_bonus', userId, amount },
          { account: 'bonus_issued', amount: -amount },
        ],
      }),
    );
  }

  async userHistory(userId: string, limit = 100) {
    return this.db
      .select({
        id: ledgerEntries.id,
        amount: ledgerEntries.amount,
        account: ledgerAccounts.type,
        kind: ledgerTransactions.kind,
        description: ledgerTransactions.description,
        createdAt: ledgerEntries.createdAt,
        paymentId: ledgerTransactions.paymentId,
        orderId: ledgerTransactions.orderId,
      })
      .from(ledgerEntries)
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
      .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerEntries.transactionId))
      .where(eq(ledgerAccounts.userId, userId))
      .orderBy(desc(ledgerEntries.createdAt))
      .limit(limit);
  }

  /** Сверка: сумма всех балансов должна быть равна нулю. */
  async trialBalance() {
    const rows = await this.db
      .select({ type: ledgerAccounts.type, total: sql<string>`sum(${ledgerAccounts.balance})` })
      .from(ledgerAccounts)
      .groupBy(ledgerAccounts.type);
    const byType = Object.fromEntries(rows.map((r) => [r.type, Number(r.total)]));
    const sum = rows.reduce((s, r) => s + Number(r.total), 0);
    return { byType, balanced: sum === 0 };
  }
}
