import test from 'node:test';
import assert from 'node:assert/strict';
import type { AppBindings } from './types';
import { recordRateLimitAudit } from './audit';
import { createDualWriteSignature, verifyDualWriteRequest } from './dual_write';

type MockStatementResult = {
  results?: Array<Record<string, unknown>>;
  first?: Record<string, unknown> | null;
  run?: { success: boolean; meta?: Record<string, unknown> };
};

class MockD1Database {
  auditRows: Array<Record<string, unknown>> = [];
  nonceRows = new Map<string, { created_at: string; expires_at: string }>();

  prepare(query: string) {
    const db = this;
    const buildRunner = (args: unknown[]) => ({
      async first() {
        return db.handle(query, args).first ?? null;
      },
      async run() {
        return db.handle(query, args).run ?? { success: true, meta: {} };
      },
      async all() {
        return { results: db.handle(query, args).results ?? [] };
      }
    });
    return {
      first() {
        return buildRunner([]).first();
      },
      run() {
        return buildRunner([]).run();
      },
      all() {
        return buildRunner([]).all();
      },
      bind(...args: unknown[]) {
        return buildRunner(args);
      }
    };
  }

  private handle(query: string, args: unknown[]): MockStatementResult {
    if (query.includes("sqlite_master") && query.includes("audit_logs")) {
      return { first: { name: 'audit_logs' } };
    }
    if (query.includes('INSERT INTO audit_logs')) {
      this.auditRows.push({
        actor_user_id: args[0],
        actor_username: args[1],
        actor_role: args[2],
        action: args[3],
        resource_type: args[4],
        resource_id: args[5],
        summary: args[6],
        details: args[7],
        created_at: args[8]
      });
      return { run: { success: true, meta: { changes: 1 } } };
    }
    if (query.includes('CREATE TABLE IF NOT EXISTS dual_write_nonces') || query.includes('CREATE INDEX IF NOT EXISTS idx_dual_write_nonces_expires_at')) {
      return { run: { success: true } };
    }
    if (query.includes('DELETE FROM dual_write_nonces WHERE expires_at <=')) {
      const cutoff = String(args[0]);
      for (const [key, value] of this.nonceRows.entries()) {
        if (value.expires_at <= cutoff) {
          this.nonceRows.delete(key);
        }
      }
      return { run: { success: true } };
    }
    if (query.includes('SELECT request_id FROM dual_write_nonces WHERE request_id = ?')) {
      const requestId = String(args[0]);
      return { first: this.nonceRows.has(requestId) ? { request_id: requestId } : null };
    }
    if (query.includes('INSERT INTO dual_write_nonces')) {
      this.nonceRows.set(String(args[0]), {
        created_at: String(args[1]),
        expires_at: String(args[2])
      });
      return { run: { success: true, meta: { changes: 1 } } };
    }
    throw new Error(`Unhandled query in test mock: ${query}`);
  }
}

const createTestContext = (db: MockD1Database) => {
  const sessionUser: AppBindings['Variables']['sessionUser'] = {
    userId: 'user-1',
    username: 'admin',
    role: 'admin'
  };
  return {
    env: { DB: db } as unknown as AppBindings['Bindings'],
    get(key: 'sessionUser') {
      if (key === 'sessionUser') return sessionUser;
      return undefined;
    }
  } as unknown as Parameters<typeof recordRateLimitAudit>[0];
};

test('recordRateLimitAudit writes security audit entries', async () => {
  const db = new MockD1Database();
  const context = createTestContext(db);

  await recordRateLimitAudit(context, {
    action: 'people_create',
    limiterKey: 'user-1:127.0.0.1',
    route: '/api/people',
    retryAfterSeconds: 120,
    summary: '人物建立速率限制：admin'
  });

  assert.equal(db.auditRows.length, 1);
  const row = db.auditRows[0];
  assert.equal(row.action, 'rate_limit_block');
  assert.equal(row.resource_type, 'security');
  assert.equal(row.resource_id, 'people_create');
  assert.match(String(row.details), /"route":"\/api\/people"/);
  assert.match(String(row.details), /"retry_after_seconds":120/);
});

test('verifyDualWriteRequest accepts valid signed request and rejects replay', async () => {
  const db = new MockD1Database();
  const sharedSecret = 'test-shared-secret';
  const body = JSON.stringify({ hello: 'world' });
  const path = '/api/people';
  const requestId = '11111111-1111-4111-8111-111111111111';
  const signed = await createDualWriteSignature(sharedSecret, 'POST', path, body, '2026-04-04T00:00:00.000Z', requestId);
  const headers = new Headers({
    'X-Dual-Write': '1',
    'X-Dual-Write-Request-Id': requestId,
    'X-Dual-Write-Body-SHA256': signed.bodyHash,
    'X-Dual-Write-Timestamp': new Date().toISOString(),
    'X-Dual-Write-Signature': (await createDualWriteSignature(sharedSecret, 'POST', path, body, new Date().toISOString(), requestId)).signature
  });

  const timestamp = headers.get('X-Dual-Write-Timestamp')!;
  const finalSigned = await createDualWriteSignature(sharedSecret, 'POST', path, body, timestamp, requestId);
  headers.set('X-Dual-Write-Signature', finalSigned.signature);
  headers.set('X-Dual-Write-Body-SHA256', finalSigned.bodyHash);

  const env = {
    DB: db,
    DUAL_WRITE_REMOTE: 'true',
    DUAL_WRITE_REMOTE_BASE: 'https://remote.example.com',
    DUAL_WRITE_REMOTE_ORIGIN: 'https://remote.example.com',
    DUAL_WRITE_REMOTE_USER: 'mirror',
    DUAL_WRITE_REMOTE_PASS: 'secret',
    DUAL_WRITE_SHARED_SECRET: sharedSecret
  } as const;

  const request = new Request(`https://local.example.com${path}`, {
    method: 'POST',
    headers,
    body
  });

  const accepted = await verifyDualWriteRequest(env as any, request);
  assert.equal(accepted.ok, true);

  const replay = await verifyDualWriteRequest(env as any, new Request(`https://local.example.com${path}`, {
    method: 'POST',
    headers,
    body
  }));
  assert.equal(replay.ok, false);
  if (!replay.ok) {
    assert.equal(replay.status, 409);
    assert.equal(replay.error, 'Dual-write request replay detected');
  }
});

test('verifyDualWriteRequest rejects body tampering', async () => {
  const db = new MockD1Database();
  const sharedSecret = 'test-shared-secret';
  const originalBody = JSON.stringify({ hello: 'world' });
  const tamperedBody = JSON.stringify({ hello: 'attacker' });
  const path = '/api/people';
  const timestamp = new Date().toISOString();
  const requestId = '22222222-2222-4222-8222-222222222222';
  const signed = await createDualWriteSignature(sharedSecret, 'POST', path, originalBody, timestamp, requestId);
  const env = {
    DB: db,
    DUAL_WRITE_REMOTE: 'true',
    DUAL_WRITE_REMOTE_BASE: 'https://remote.example.com',
    DUAL_WRITE_REMOTE_ORIGIN: 'https://remote.example.com',
    DUAL_WRITE_REMOTE_USER: 'mirror',
    DUAL_WRITE_REMOTE_PASS: 'secret',
    DUAL_WRITE_SHARED_SECRET: sharedSecret
  } as const;

  const request = new Request(`https://local.example.com${path}`, {
    method: 'POST',
    headers: {
      'X-Dual-Write': '1',
      'X-Dual-Write-Request-Id': signed.requestId,
      'X-Dual-Write-Body-SHA256': signed.bodyHash,
      'X-Dual-Write-Timestamp': signed.timestamp,
      'X-Dual-Write-Signature': signed.signature
    },
    body: tamperedBody
  });

  const result = await verifyDualWriteRequest(env as any, request);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 401);
    assert.equal(result.error, 'Dual-write signature mismatch');
  }
});
