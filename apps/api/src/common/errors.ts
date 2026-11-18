import { HttpException } from '@nestjs/common';

/**
 * Прикладная ошибка с машинным кодом. Клиенты ориентируются на `code`, а не на текст.
 */
export class AppError extends HttpException {
  constructor(
    status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super({ statusCode: status, code, message, details }, status);
  }
}

export const Errors = {
  badRequest: (code: string, message: string, details?: unknown) => new AppError(400, code, message, details),
  unauthorized: (message = 'Требуется авторизация', code = 'unauthorized') => new AppError(401, code, message),
  forbidden: (message = 'Недостаточно прав', code = 'forbidden') => new AppError(403, code, message),
  notFound: (what = 'Объект', code = 'not_found') => new AppError(404, code, `${what} не найден`),
  conflict: (code: string, message: string, details?: unknown) => new AppError(409, code, message, details),
  paymentRequired: (code: string, message: string, details?: unknown) => new AppError(402, code, message, details),
  tooMany: (retryAfterSec: number, message = 'Слишком много запросов, попробуйте позже') =>
    new AppError(429, 'rate_limited', message, { retryAfterSec }),
  unprocessable: (code: string, message: string, details?: unknown) => new AppError(422, code, message, details),
  invalidTransition: (from: string, to: string) =>
    new AppError(409, 'invalid_transition', `Недопустимый переход статуса: ${from} → ${to}`, { from, to }),
  versionConflict: () => new AppError(409, 'version_conflict', 'Данные были изменены в другом окне. Обновите страницу и повторите.'),
};
