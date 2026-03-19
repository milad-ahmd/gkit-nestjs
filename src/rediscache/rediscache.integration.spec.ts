import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { RedisCache } from './index';
import Redis from 'ioredis';

describe('RedisCache Integration', () => {
  let container: StartedTestContainer;
  let client: Redis;
  let cache: RedisCache<string>;

  beforeAll(async () => {
    container = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forListeningPort())
      .start();

    client = new Redis({
      host: container.getHost(),
      port: container.getMappedPort(6379),
    });

    cache = new RedisCache<string>(client, { keyPrefix: 'test:' });
  });

  afterAll(async () => {
    await client.quit();
    await container.stop();
  });

  beforeEach(async () => {
    await client.flushdb();
  });

  it('should set and get a value', async () => {
    await cache.set('greeting', 'hello');
    const val = await cache.get('greeting');
    expect(val).toBe('hello');
  });

  it('should return null on cache miss', async () => {
    const val = await cache.get('nonexistent');
    expect(val).toBeNull();
  });

  it('should delete a key', async () => {
    await cache.set('to-delete', 'bye');
    await cache.delete('to-delete');
    const val = await cache.get('to-delete');
    expect(val).toBeNull();
  });

  it('should expire after TTL', async () => {
    await cache.set('expires', 'soon', 1); // 1 second TTL
    await new Promise(r => setTimeout(r, 1500));
    const val = await cache.get('expires');
    expect(val).toBeNull();
  });

  it('should return cached value from getOrSet', async () => {
    let called = 0;
    const factory = async () => { called++; return 'computed'; };

    const v1 = await cache.getOrSet('lazy', factory);
    const v2 = await cache.getOrSet('lazy', factory);

    expect(v1).toBe('computed');
    expect(v2).toBe('computed');
    expect(called).toBe(1); // factory called only once
  });

  it('should ping successfully', async () => {
    await expect(cache.ping()).resolves.toBe(true);
  });
});
