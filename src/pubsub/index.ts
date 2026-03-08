export type Handler<T> = (event: T) => Promise<void> | void;

interface Subscription<T> {
  handler: Handler<T>;
  cancelled: boolean;
}

export class Bus {
  private readonly subs = new Map<string, Subscription<unknown>[]>();

  subscribe<T>(topic: string, handler: Handler<T>): () => void {
    const sub: Subscription<T> = { handler, cancelled: false };
    const list = this.subs.get(topic) ?? [];
    list.push(sub as Subscription<unknown>);
    this.subs.set(topic, list);

    return () => {
      sub.cancelled = true;
      const current = this.subs.get(topic);
      if (current) {
        const idx = current.indexOf(sub as Subscription<unknown>);
        if (idx !== -1) current.splice(idx, 1);
      }
    };
  }

  async publish<T>(topic: string, payload: T): Promise<void> {
    const handlers = this.subs.get(topic) ?? [];
    const promises = handlers
      .filter(s => !s.cancelled)
      .map(s => Promise.resolve((s.handler as Handler<T>)(payload)).catch(console.error));
    await Promise.all(promises);
  }

  topics(): string[] { return [...this.subs.keys()]; }
}
