/**
 * Auth module unit tests.
 *
 * jsonwebtoken is mocked so no real signing/verification is performed.
 */

jest.mock('jsonwebtoken');

import * as jwt from 'jsonwebtoken';
import {
  issueToken,
  verifyToken,
  extractBearerToken,
  Claims,
} from './index';

const mockJwt = jest.mocked(jwt);

// ---------------------------------------------------------------------------
// issueToken
// ---------------------------------------------------------------------------

describe('issueToken()', () => {
  beforeEach(() => {
    mockJwt.sign.mockReturnValue('signed-token' as unknown as ReturnType<typeof jwt.sign>);
  });

  afterEach(() => jest.clearAllMocks());

  it('calls jwt.sign and returns the token string', () => {
    const claims: Omit<Claims, 'iat' | 'exp'> = { userId: 'u1', roles: ['admin'], sub: 'u1' };
    const token = issueToken(claims, 'secret', 3600);
    expect(token).toBe('signed-token');
    expect(mockJwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', roles: ['admin'] }),
      'secret',
      { algorithm: 'HS256' },
    );
  });

  it('injects iat and exp into the payload', () => {
    const before = Math.floor(Date.now() / 1000);
    const claims: Omit<Claims, 'iat' | 'exp'> = { userId: 'u2', roles: [], sub: 'u2' };
    issueToken(claims, 'secret', 100);

    const payload = (mockJwt.sign as jest.Mock).mock.calls[0][0] as Record<string, number>;
    expect(payload['iat']).toBeGreaterThanOrEqual(before);
    expect(payload['exp']).toBeGreaterThanOrEqual(payload['iat'] + 100);
  });
});

// ---------------------------------------------------------------------------
// verifyToken
// ---------------------------------------------------------------------------

describe('verifyToken()', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns Claims from a valid decoded payload', () => {
    const decoded = {
      userId: 'u1',
      roles: ['user'],
      sub: 'u1',
      iat: 1000,
      exp: 2000,
    };
    mockJwt.verify.mockReturnValue(decoded as unknown as ReturnType<typeof jwt.verify>);

    const claims = verifyToken('token', 'secret');
    expect(claims.userId).toBe('u1');
    expect(claims.roles).toEqual(['user']);
    expect(claims.sub).toBe('u1');
    expect(claims.iat).toBe(1000);
    expect(claims.exp).toBe(2000);
  });

  it('falls back to sub when userId is absent', () => {
    mockJwt.verify.mockReturnValue({
      sub: 'fallback-sub',
      roles: [],
      iat: 0,
      exp: 0,
    } as unknown as ReturnType<typeof jwt.verify>);

    const claims = verifyToken('token', 'secret');
    expect(claims.userId).toBe('fallback-sub');
  });

  it('propagates errors from jwt.verify', () => {
    mockJwt.verify.mockImplementation(() => { throw new Error('invalid signature'); });
    expect(() => verifyToken('bad-token', 'secret')).toThrow('invalid signature');
  });
});

// ---------------------------------------------------------------------------
// extractBearerToken
// ---------------------------------------------------------------------------

describe('extractBearerToken()', () => {
  it('returns the token from a valid Bearer header', () => {
    expect(extractBearerToken('Bearer my-token-123')).toBe('my-token-123');
  });

  it('returns null for undefined header', () => {
    expect(extractBearerToken(undefined)).toBeNull();
  });

  it('returns null for a header without "Bearer " prefix', () => {
    expect(extractBearerToken('Basic abc')).toBeNull();
  });

  it('returns null for an empty token after the prefix', () => {
    expect(extractBearerToken('Bearer ')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(extractBearerToken('')).toBeNull();
  });
});
