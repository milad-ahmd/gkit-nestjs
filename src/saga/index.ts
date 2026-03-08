export interface SagaStep<T = void> {
  name: string;
  execute(ctx: T): Promise<T>;
  compensate?(ctx: T): Promise<void>;
}

export interface CompensationError {
  step: string;
  error: Error;
}

export class SagaError extends Error {
  constructor(
    public readonly sagaName: string,
    public readonly failedStep: string,
    public readonly cause: Error,
    public readonly compensationErrors: CompensationError[],
  ) {
    super(`Saga '${sagaName}' failed at step '${failedStep}': ${cause.message}`);
    this.name = 'SagaError';
  }

  get hasCompensationErrors(): boolean { return this.compensationErrors.length > 0; }
}

export class Saga<T = void> {
  private readonly steps: SagaStep<T>[] = [];

  constructor(private readonly name: string) {}

  addStep(step: SagaStep<T>): this {
    this.steps.push(step);
    return this;
  }

  async run(initialCtx: T): Promise<T> {
    const completed: number[] = [];
    let ctx = initialCtx;

    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i]!;
      try {
        ctx = await step.execute(ctx);
        completed.push(i);
      } catch (err) {
        const compErrors = await this.compensate(completed, ctx);
        throw new SagaError(this.name, step.name, err as Error, compErrors);
      }
    }
    return ctx;
  }

  private async compensate(completed: number[], ctx: T): Promise<CompensationError[]> {
    const errors: CompensationError[] = [];
    for (let i = completed.length - 1; i >= 0; i--) {
      const step = this.steps[completed[i]!]!;
      if (!step.compensate) continue;
      try {
        await step.compensate(ctx);
      } catch (err) {
        errors.push({ step: step.name, error: err as Error });
      }
    }
    return errors;
  }
}
