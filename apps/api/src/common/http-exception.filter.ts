import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from './errors';

interface PgError {
  code?: string;
  constraint?: string;
  detail?: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') throw exception;
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const requestId = (req.id as string | undefined) ?? (req.headers['x-request-id'] as string | undefined);

    let status = 500;
    let body: Record<string, unknown> = { statusCode: 500, code: 'internal_error', message: 'Внутренняя ошибка сервера' };

    const pg = (exception as { cause?: PgError })?.cause ?? (exception as PgError);
    if (exception instanceof ZodError) {
      status = 400;
      body = {
        statusCode: 400,
        code: 'validation_error',
        message: 'Проверьте правильность заполнения полей',
        details: exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code })),
      };
    } else if (exception instanceof AppError) {
      status = exception.getStatus();
      body = exception.getResponse() as Record<string, unknown>;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      const message = typeof r === 'string' ? r : ((r as { message?: string | string[] }).message ?? exception.message);
      body = { statusCode: status, code: httpCode(status), message: Array.isArray(message) ? message.join('; ') : message };
    } else if (pg && typeof pg.code === 'string' && /^[0-9A-Z]{5}$/.test(pg.code)) {
      if (pg.code === '23505') {
        status = 409;
        body = { statusCode: 409, code: 'already_exists', message: 'Такая запись уже существует', details: { constraint: pg.constraint } };
      } else if (pg.code === '23503') {
        status = 409;
        body = { statusCode: 409, code: 'reference_error', message: 'Связанная запись не найдена или используется', details: { constraint: pg.constraint } };
      } else if (pg.code === '23514') {
        status = 422;
        body = { statusCode: 422, code: 'constraint_violation', message: 'Нарушено ограничение целостности данных', details: { constraint: pg.constraint } };
      } else if (pg.code === '40001' || pg.code === '40P01') {
        status = 409;
        body = { statusCode: 409, code: 'concurrent_update', message: 'Конкурентное изменение, повторите запрос' };
      }
    }

    if (status >= 500) {
      this.logger.error({ err: exception, requestId, path: req.url }, 'Unhandled error');
    }
    if (status === 429) {
      const retry = (body.details as { retryAfterSec?: number } | undefined)?.retryAfterSec;
      if (retry) res.setHeader('Retry-After', String(retry));
    }
    res.status(status).json({ ...body, requestId });
  }
}

function httpCode(status: number): string {
  switch (status) {
    case 400:
      return 'bad_request';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 413:
      return 'payload_too_large';
    case 415:
      return 'unsupported_media_type';
    case 429:
      return 'rate_limited';
    default:
      return status >= 500 ? 'internal_error' : 'http_error';
  }
}
