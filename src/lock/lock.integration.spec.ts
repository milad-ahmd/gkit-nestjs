import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { Locker, RedisLock } from './index';
import Redis from 'ioredis';

describe('DistributedLock Integration', () => {
  let container: StartedTestContainer;
  let client: Redis;
  let lock: RedisLock;
  let locker: Locker;

  beforeAll(async () => {
    container = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forListeningPorts())
      .start();

    client = new Redis({
      host: container.getHost(),
      port: container.getMappedPort(6379),
    });

    lock = new RedisLock(client);
    locker = new Locker(client, { retryCount: 10, retryIntervalMs: 10 });
  });

  afterAll(async () => {
    await client.quit();
    await container.stop();
  });

  beforeEach(async () => {
    await client.flushdb();
  });

  it('should acquire and release a lock', async () => {
    const token = await lock.acquire('resource:1', 10000);
    expect(token).toBeTruthy();
    expect(await lock.release('resource:1', token!)).toBe(true);
  });

  it('should prevent double acquisition', async () => {
    const token1 = await lock.acquire('resource:2', 10000);
    const token2 = await lock.acquire('resource:2', 10000);
    expect(token2).toBeNull();
    expect(await lock.release('resource:2', token1!)).toBe(true);
  });

  it('should allow re-acquire after release', async () => {
    const token1 = await lock.acquire('resource:3', 10000);
    expect(await lock.release('resource:3', token1!)).toBe(true);

    const token2 = await lock.acquire('resource:3', 10000);
    expect(token2).toBeTruthy();
    expect(await lock.release('resource:3', token2!)).toBe(true);
  });

  it('should execute withLock callback exclusively', async () => {
    const results: number[] = [];

    await Promise.all([
      locker.withLock('resource:4', 10000, async () => {
        results.push(1);
        await new Promise(r => setTimeout(r, 50));
        results.push(2);
      }),
      new Promise(r => setTimeout(r, 100)).then(() =>
        locker.withLock('resource:4', 10000, async () => {
          results.push(3);
        })
      ),
    ]);

    // 1 and 2 must both appear before 3
    const idx1 = results.indexOf(1);
    const idx2 = results.indexOf(2);
    const idx3 = results.indexOf(3);
    expect(idx1).toBeLessThan(idx2);
    expect(idx2).toBeLessThan(idx3);
  });
});
