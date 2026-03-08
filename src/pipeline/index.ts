export type StageFunc<In, Out> = (input: In) => Promise<Out>;

export async function process<In, Out>(
  items: In[],
  fn: StageFunc<In, Out>,
  workers = items.length,
): Promise<Out[]> {
  if (items.length === 0) return [];
  const w = Math.min(workers > 0 ? workers : items.length, items.length);
  const results: Out[] = new Array(items.length);
  let index = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = index++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!);
    }
  }

  await Promise.all(Array.from({ length: w }, () => worker()));
  return results;
}

export function chain<T>(...stages: StageFunc<T, T>[]): StageFunc<T, T> {
  return async (input: T): Promise<T> => {
    let current = input;
    for (const stage of stages) {
      current = await stage(current);
    }
    return current;
  };
}

export function compose<A, B, C>(
  first: StageFunc<A, B>,
  second: StageFunc<B, C>,
): StageFunc<A, C> {
  return async (input: A): Promise<C> => second(await first(input));
}

export class Pipeline<T> {
  private constructor(private readonly value: T) {}

  static of<T>(value: T): Pipeline<T> { return new Pipeline(value); }

  async then<U>(stage: StageFunc<T, U>): Promise<Pipeline<U>> {
    return new Pipeline(await stage(this.value));
  }

  get(): T { return this.value; }
}
