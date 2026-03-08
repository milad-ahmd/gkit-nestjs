import { Saga, SagaStep, SagaError, CompensationError } from './index';

interface Ctx {
  log: string[];
}

function makeStep(
  name: string,
  executeResult: (ctx: Ctx) => Promise<Ctx>,
  compensateFn?: (ctx: Ctx) => Promise<void>,
): SagaStep<Ctx> {
  return {
    name,
    execute: executeResult,
    compensate: compensateFn,
  };
}

describe('Saga', () => {
  describe('successful execution', () => {
    it('runs all steps and returns final context', async () => {
      const saga = new Saga<Ctx>('test-saga');
      saga
        .addStep(makeStep('step1', async (ctx) => ({ log: [...ctx.log, 'step1'] })))
        .addStep(makeStep('step2', async (ctx) => ({ log: [...ctx.log, 'step2'] })))
        .addStep(makeStep('step3', async (ctx) => ({ log: [...ctx.log, 'step3'] })));

      const result = await saga.run({ log: [] });
      expect(result.log).toEqual(['step1', 'step2', 'step3']);
    });

    it('runs steps in order', async () => {
      const order: string[] = [];
      const saga = new Saga<Ctx>('order-saga');
      ['a', 'b', 'c'].forEach((name) => {
        saga.addStep(makeStep(name, async (ctx) => {
          order.push(name);
          return ctx;
        }));
      });

      await saga.run({ log: [] });
      expect(order).toEqual(['a', 'b', 'c']);
    });

    it('returns unchanged ctx for a saga with no steps', async () => {
      const saga = new Saga<Ctx>('empty');
      const ctx = { log: ['initial'] };
      const result = await saga.run(ctx);
      expect(result).toBe(ctx);
    });
  });

  describe('failure and compensation', () => {
    it('throws SagaError when a step fails', async () => {
      const saga = new Saga<Ctx>('fail-saga');
      saga.addStep(makeStep('step1', async (ctx) => ctx));
      saga.addStep(makeStep('step2', async () => { throw new Error('step2 failed'); }));

      await expect(saga.run({ log: [] })).rejects.toBeInstanceOf(SagaError);
    });

    it('SagaError has correct sagaName, failedStep, cause', async () => {
      const saga = new Saga<Ctx>('my-saga');
      const cause = new Error('something went wrong');
      saga.addStep(makeStep('bad-step', async () => { throw cause; }));

      try {
        await saga.run({ log: [] });
        fail('should have thrown');
      } catch (err) {
        const sagaErr = err as SagaError;
        expect(sagaErr.sagaName).toBe('my-saga');
        expect(sagaErr.failedStep).toBe('bad-step');
        expect(sagaErr.cause).toBe(cause);
      }
    });

    it('runs compensations in LIFO order for completed steps', async () => {
      const compensated: string[] = [];
      const saga = new Saga<Ctx>('comp-saga');

      saga.addStep(makeStep(
        'step1',
        async (ctx) => ctx,
        async () => { compensated.push('comp1'); },
      ));
      saga.addStep(makeStep(
        'step2',
        async (ctx) => ctx,
        async () => { compensated.push('comp2'); },
      ));
      saga.addStep(makeStep(
        'step3',
        async () => { throw new Error('step3 failed'); },
      ));

      await saga.run({ log: [] }).catch(() => {});
      // step1 and step2 completed; step3 failed.
      // Compensations run in LIFO: step2, then step1.
      expect(compensated).toEqual(['comp2', 'comp1']);
    });

    it('skips compensation for steps without a compensate fn', async () => {
      const compensated: string[] = [];
      const saga = new Saga<Ctx>('no-comp');

      saga.addStep(makeStep('a', async (ctx) => ctx)); // no compensation
      saga.addStep(makeStep('b', async (ctx) => ctx, async () => { compensated.push('b'); }));
      saga.addStep(makeStep('c', async () => { throw new Error('fail'); }));

      await saga.run({ log: [] }).catch(() => {});
      // Only 'b' has compensation; 'a' does not.
      expect(compensated).toEqual(['b']);
    });

    it('hasCompensationErrors is false when all compensations succeed', async () => {
      const saga = new Saga<Ctx>('clean-comp');
      saga.addStep(makeStep('s1', async (ctx) => ctx, async () => {}));
      saga.addStep(makeStep('fail', async () => { throw new Error('x'); }));

      try {
        await saga.run({ log: [] });
      } catch (err) {
        expect((err as SagaError).hasCompensationErrors).toBe(false);
      }
    });

    it('hasCompensationErrors is true when a compensation throws', async () => {
      const saga = new Saga<Ctx>('dirty-comp');
      saga.addStep(makeStep(
        's1',
        async (ctx) => ctx,
        async () => { throw new Error('comp failed'); },
      ));
      saga.addStep(makeStep('fail', async () => { throw new Error('main fail'); }));

      try {
        await saga.run({ log: [] });
        fail('should have thrown');
      } catch (err) {
        const sagaErr = err as SagaError;
        expect(sagaErr.hasCompensationErrors).toBe(true);
        expect(sagaErr.compensationErrors).toHaveLength(1);
        expect(sagaErr.compensationErrors[0]?.step).toBe('s1');
      }
    });
  });

  describe('addStep chaining', () => {
    it('addStep returns this for chaining', () => {
      const saga = new Saga<Ctx>('chain');
      const result = saga.addStep(makeStep('x', async (ctx) => ctx));
      expect(result).toBe(saga);
    });
  });

  describe('SagaError', () => {
    it('message includes sagaName, failedStep, and cause message', () => {
      const err = new SagaError('my-saga', 'step-1', new Error('the cause'), []);
      expect(err.message).toContain('my-saga');
      expect(err.message).toContain('step-1');
      expect(err.message).toContain('the cause');
    });

    it('name is SagaError', () => {
      const err = new SagaError('s', 'x', new Error(), []);
      expect(err.name).toBe('SagaError');
    });
  });
});
