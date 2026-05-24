import { Scheduler } from './index';

describe('Scheduler', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('every()', () => {
    it('runs the handler immediately on start and then at each interval', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      const sched = new Scheduler();
      sched.every(1000, 'tick', handler);
      sched.start();

      await Promise.resolve();
      expect(handler).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(1000);
      expect(handler).toHaveBeenCalledTimes(2);

      sched.stop();
    });

    it('stops running after stop()', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      const sched = new Scheduler();
      sched.every(500, 'tick', handler);
      sched.start();
      await Promise.resolve();
      sched.stop();

      await jest.advanceTimersByTimeAsync(2000);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('supports method chaining', () => {
      const sched = new Scheduler();
      const result = sched.every(1000, 'job', jest.fn().mockResolvedValue(undefined));
      expect(result).toBe(sched);
    });
  });

  describe('after()', () => {
    it('runs the handler once after the delay', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      const sched = new Scheduler();
      sched.after(200, 'once', handler);
      sched.start();

      expect(handler).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(200);
      expect(handler).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(500);
      expect(handler).toHaveBeenCalledTimes(1);

      sched.stop();
    });

    it('supports method chaining', () => {
      const sched = new Scheduler();
      const result = sched.after(100, 'once', jest.fn().mockResolvedValue(undefined));
      expect(result).toBe(sched);
    });
  });

  describe('error handling', () => {
    it('calls onError when a job throws', async () => {
      const err = new Error('job failed');
      const handler = jest.fn().mockRejectedValue(err);
      const onError = jest.fn();
      const sched = new Scheduler(1, onError);
      sched.every(100, 'bad-job', handler);
      sched.start();
      await Promise.resolve();
      sched.stop();

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'bad-job' }),
        err,
      );
    });

    it('logs to console.error when no onError is provided and job throws', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const handler = jest.fn().mockRejectedValue(new Error('boom'));
      const sched = new Scheduler();
      sched.every(100, 'noisy-job', handler);
      sched.start();
      await Promise.resolve();
      sched.stop();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('multiple jobs', () => {
    it('runs multiple jobs independently', async () => {
      const h1 = jest.fn().mockResolvedValue(undefined);
      const h2 = jest.fn().mockResolvedValue(undefined);
      const sched = new Scheduler();
      sched.every(500, 'job1', h1);
      sched.every(1000, 'job2', h2);
      sched.start();

      await Promise.resolve();
      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(500);
      expect(h1).toHaveBeenCalledTimes(2);
      expect(h2).toHaveBeenCalledTimes(1);

      sched.stop();
    });
  });
});
