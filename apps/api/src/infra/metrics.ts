import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import client from 'prom-client';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: 'lotok_' });

export const httpDuration = new client.Histogram({
  name: 'lotok_http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const businessCounter = new client.Counter({
  name: 'lotok_business_events_total',
  help: 'Business events (listings created, orders, payments, ...)',
  labelNames: ['event'],
  registers: [registry],
});

export const wsConnections = new client.Gauge({
  name: 'lotok_ws_connections',
  help: 'Active WebSocket connections on this instance',
  registers: [registry],
});

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const end = httpDuration.startTimer();
    res.on('finish', () => {
      const route = (req.route?.path as string | undefined) ?? 'unmatched';
      end({ method: req.method, route: `${req.baseUrl ?? ''}${route}`, status: String(res.statusCode) });
    });
    next();
  }
}

export function track(event: string) {
  businessCounter.inc({ event });
}
