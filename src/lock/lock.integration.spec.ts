import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { DistributedLock } from './index';
import Redis from 'ioredis';

describe('DistributedLock Integration', () => {
  let container: StartedTestContainer;
  let client: Redis;
  let locker: DistributedLock;

  beforeAll(async () => {
    container = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forListeningPort())
      .start();

    client = new Redis({
      host: container.getHost(),
      port: container.getMappedPort(6379),
    });

    locker = new DistributedLock(client);
  });

  afterAll(async () => {
    await client.quit();
    await container.stop();
  });

  beforeEach(async () => {
    await client.flushdb();
  });

  it('should acquire and release a lock', async () => {
    const lock = await locker.acquire('resource:1', 10000);
    expect(lock).toBeTruthy();
    await lock.release();
  });

  it('should prevent double acquisition', async () => {
    const lock1 = await locker.acquire('resource:2', 10000);
    const lock2 = await locker.tryAcquire('resource:2', 10000);
    expect(lock2).toBeNull();
    await lock1.release();
  });

  it('should allow re-acquire after release', async () => {
    const lock1 = await locker.acquire('resource:3', 10000);
    await lock1.release();

    const lock2 = await locker.acquire('resource:3', 10000);
    expect(lock2).toBeTruthy();
    await lock2.release();
  });

  it('should execute withLock callback exclusively', async () => {
    const results: number[] = [];

    await Promise.all([
      locker.withLock('resource:4', 10000, async () => {
        results.push(1);
        await new Promise(r => setTimeout(r, 50));
        results.push(2);
      }),
      new Promise(r => setTimeout(r, 10)).then(() =>
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
