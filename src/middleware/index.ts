import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';

export const REQUEST_ID_HEADER = 'x-request-id';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const id = (req.headers[REQUEST_ID_HEADER] as string) || randomBytes(8).toString('hex');
    (req as any).requestId = id;
    res.setHeader(REQUEST_ID_HEADER, id);
    next();
  }
}

@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const start = Date.now();
    const { method, originalUrl } = req;
    res.on('finish', () => {
      const ms = Date.now() - start;
      const id = (req as any).requestId ?? '-';
      console.log(`${method} ${originalUrl} ${res.statusCode} ${ms}ms id=${id}`);
    });
    next();
  }
}

@Injectable()
export class RecoveryMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    try {
      next();
    } catch (err) {
      console.error('Unhandled error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal Server Error' });
      }
    }
  }
}

export function timeoutMiddleware(timeoutMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(503).json({ error: 'Request timeout' });
      }
    }, timeoutMs);
    res.on('finish', () => clearTimeout(timer));
    next();
  };
}
