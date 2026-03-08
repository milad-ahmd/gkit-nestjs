/**
 * Auth module — JWT issuance, verification, NestJS guard, and RBAC helpers.
 *
 * Mirrors the Go gkit/pkg/auth package.
 */

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  ForbiddenException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';

// ---------------------------------------------------------------------------
// Claims

export interface Claims {
  userId: string;
  roles: string[];
  sub: string;
  iat: number;
  exp: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Token issuance

/**
 * Issues a signed HS256 JWT for the given claims with the specified TTL.
 * Sets iat, exp, and sub automatically.
 */
export function issueToken(
  claims: Omit<Claims, 'iat' | 'exp'>,
  secret: string,
  ttlSeconds: number,
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    ...claims,
    sub: claims.userId,
    iat: now,
    exp: now + ttlSeconds,
  };
  return jwt.sign(payload, secret, { algorithm: 'HS256' });
}

// ---------------------------------------------------------------------------
// Token verification

/**
 * Verifies and decodes a JWT. Throws a standard Error on invalid/expired tokens.
 */
export function verifyToken(token: string, secret: string): Claims {
  const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as Record<string, unknown>;
  return {
    userId: (decoded['userId'] as string) || (decoded['sub'] as string) || '',
    roles: (decoded['roles'] as string[]) || [],
    sub: (decoded['sub'] as string) || '',
    iat: decoded['iat'] as number,
    exp: decoded['exp'] as number,
    ...decoded,
  };
}

// ---------------------------------------------------------------------------
// Bearer token extraction

/**
 * Extracts the token string from an Authorization: Bearer <token> header.
 * Returns null if the header is absent or malformed.
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const prefix = 'Bearer ';
  if (!authHeader.startsWith(prefix)) return null;
  const token = authHeader.slice(prefix.length).trim();
  return token || null;
}

// ---------------------------------------------------------------------------
// NestJS JwtGuard

const CLAIMS_KEY = 'gkit:claims';
const ROLES_KEY = 'gkit:roles';

/**
 * Injects the Claims object into the request.
 * Looks for the JWT_SECRET environment variable by default.
 */
@Injectable()
export class JwtGuard implements CanActivate {
  private readonly secret: string;

  constructor(secret?: string) {
    this.secret = secret ?? process.env['JWT_SECRET'] ?? '';
    if (!this.secret) {
      throw new Error('JwtGuard: JWT_SECRET is not configured');
    }
  }

  canActivate(ctx: ExecutionContext): boolean {
    const request = ctx.switchToHttp().getRequest<Record<string, unknown>>();
    const authHeader = (request['headers'] as Record<string, string>)['authorization'];
    const token = extractBearerToken(authHeader);

    if (!token) {
      throw new UnauthorizedException('Missing or malformed Authorization header');
    }

    let claims: Claims;
    try {
      claims = verifyToken(token, this.secret);
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new ForbiddenException('Token has expired');
      }
      throw new UnauthorizedException('Invalid token');
    }

    (request as Record<string, unknown>)[CLAIMS_KEY] = claims;
    return true;
  }
}

// ---------------------------------------------------------------------------
// @GetClaims() parameter decorator

/**
 * Parameter decorator that extracts the Claims from the current request.
 *
 * Usage:
 *   async myHandler(@GetClaims() claims: Claims) { ... }
 */
export const GetClaims = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Claims | undefined => {
    const request = ctx.switchToHttp().getRequest<Record<string, unknown>>();
    return request[CLAIMS_KEY] as Claims | undefined;
  },
);

// ---------------------------------------------------------------------------
// requireRoles guard factory

/**
 * Creates a NestJS guard that enforces at least one of the given roles.
 * Must be chained after JwtGuard (which populates the claims).
 *
 * Usage:
 *   @UseGuards(JwtGuard, requireRoles('admin'))
 */
export function requireRoles(...roles: string[]): new (...args: unknown[]) => CanActivate {
  @Injectable()
  class RolesGuard implements CanActivate {
    canActivate(ctx: ExecutionContext): boolean {
      const request = ctx.switchToHttp().getRequest<Record<string, unknown>>();
      const claims = request[CLAIMS_KEY] as Claims | undefined;

      if (!claims) {
        throw new ForbiddenException('No claims found — ensure JwtGuard runs first');
      }

      if (roles.length === 0) return true;

      const hasRole = roles.some((role) => (claims.roles ?? []).includes(role));
      if (!hasRole) {
        throw new ForbiddenException('Insufficient role');
      }
      return true;
    }
  }

  return RolesGuard;
}

// ---------------------------------------------------------------------------
// Role decorator (metadata-based alternative)

export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Alternative roles guard using @Roles() decorator + Reflector.
 * Register in module providers as-is.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    if (!roles || roles.length === 0) return true;

    const request = ctx.switchToHttp().getRequest<Record<string, unknown>>();
    const claims = request[CLAIMS_KEY] as Claims | undefined;

    if (!claims) {
      throw new ForbiddenException('No claims found');
    }

    const hasRole = roles.some((role) => (claims.roles ?? []).includes(role));
    if (!hasRole) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
