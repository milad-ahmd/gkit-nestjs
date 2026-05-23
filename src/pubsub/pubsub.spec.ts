import { Bus } from './index';

describe('Bus', () => {
  let bus: Bus;

  beforeEach(() => {
    bus = new Bus();
  });

  // -------------------------------------------------------------------------
  // subscribe / publish
  // -------------------------------------------------------------------------

  describe('subscribe / publish', () => {
    it('delivers a published payload to a subscriber', async () => {
      const received: number[] = [];
      bus.subscribe<number>('numbers', (n) => { received.push(n); });
      await bus.publish('numbers', 42);
      expect(received).toEqual([42]);
    });

    it('delivers to multiple subscribers on the same topic', async () => {
      const a: string[] = [];
      const b: string[] = [];
      bus.subscribe<string>('greet', (msg) => { a.push(msg); });
      bus.subscribe<string>('greet', (msg) => { b.push(msg); });
      await bus.publish('greet', 'hello');
      expect(a).toEqual(['hello']);
      expect(b).toEqual(['hello']);
    });

    it('does not deliver to subscribers on a different topic', async () => {
      const received: string[] = [];
      bus.subscribe<string>('topic-a', (m) => { received.push(m); });
      await bus.publish('topic-b', 'ignored');
      expect(received).toHaveLength(0);
    });

    it('handles async handlers', async () => {
      const results: number[] = [];
      bus.subscribe<number>('async-topic', async (n) => {
        await new Promise((r) => setTimeout(r, 5));
        results.push(n);
      });
      await bus.publish('async-topic', 99);
      expect(results).toEqual([99]);
    });

    it('silently catches errors in handlers (does not throw)', async () => {
      bus.subscribe('err-topic', () => { throw new Error('handler error'); });
      await expect(bus.publish('err-topic', 'x')).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // unsubscribe (returned cancellation function)
  // -------------------------------------------------------------------------

  describe('unsubscribe', () => {
    it('stops delivering to unsubscribed handler', async () => {
      const received: string[] = [];
      const unsub = bus.subscribe<string>('news', (m) => { received.push(m); });
      await bus.publish('news', 'first');
      unsub();
      await bus.publish('news', 'second');
      expect(received).toEqual(['first']);
    });

    it('only removes the specific subscription, not others', async () => {
      const a: string[] = [];
      const b: string[] = [];
      const unsubA = bus.subscribe<string>('shared', (m) => { a.push(m); });
      bus.subscribe<string>('shared', (m) => { b.push(m); });

      await bus.publish('shared', 'msg1');
      unsubA();
      await bus.publish('shared', 'msg2');

      expect(a).toEqual(['msg1']);
      expect(b).toEqual(['msg1', 'msg2']);
    });

    it('is idempotent — calling unsub twice does not throw', async () => {
      const unsub = bus.subscribe('safe', () => {});
      unsub();
      expect(() => unsub()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // topics
  // -------------------------------------------------------------------------

  describe('topics()', () => {
    it('returns registered topic names', () => {
      bus.subscribe('alpha', () => {});
      bus.subscribe('beta', () => {});
      const topics = bus.topics();
      expect(topics).toContain('alpha');
      expect(topics).toContain('beta');
    });

    it('returns empty array when no subscriptions', () => {
      expect(bus.topics()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('publishing to a topic with no subscribers resolves immediately', async () => {
      await expect(bus.publish('ghost-topic', 'data')).resolves.toBeUndefined();
    });

    it('delivers to multiple published messages in order', async () => {
      const received: number[] = [];
      bus.subscribe<number>('ordered', (n) => { received.push(n); });
      await bus.publish('ordered', 1);
      await bus.publish('ordered', 2);
      await bus.publish('ordered', 3);
      expect(received).toEqual([1, 2, 3]);
    });
  });
});
