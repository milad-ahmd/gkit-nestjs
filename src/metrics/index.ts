import * as client from 'prom-client';

export interface CounterConfig {
  name: string;
  help: string;
  labelNames?: string[];
}

export interface GaugeConfig {
  name: string;
  help: string;
  labelNames?: string[];
}

export interface HistogramConfig {
  name: string;
  help: string;
  labelNames?: string[];
  buckets?: number[];
}

export class MetricsRegistry {
  private readonly registry: client.Registry;
  private readonly namespace: string;

  constructor(namespace: string) {
    this.namespace = namespace;
    this.registry = new client.Registry();
    client.collectDefaultMetrics({ register: this.registry });
  }

  createCounter(cfg: CounterConfig): client.Counter {
    const c = new client.Counter({
      name: `${this.namespace}_${cfg.name}`,
      help: cfg.help,
      labelNames: cfg.labelNames ?? [],
      registers: [this.registry],
    });
    return c;
  }

  createGauge(cfg: GaugeConfig): client.Gauge {
    return new client.Gauge({
      name: `${this.namespace}_${cfg.name}`,
      help: cfg.help,
      labelNames: cfg.labelNames ?? [],
      registers: [this.registry],
    });
  }

  createHistogram(cfg: HistogramConfig): client.Histogram {
    return new client.Histogram({
      name: `${this.namespace}_${cfg.name}`,
      help: cfg.help,
      labelNames: cfg.labelNames ?? [],
      buckets: cfg.buckets ?? client.linearBuckets(0, 50, 10),
      registers: [this.registry],
    });
  }

  async metricsHandler(req: any, res: any): Promise<void> {
    res.set('Content-Type', this.registry.contentType);
    res.end(await this.registry.metrics());
  }

  getRegistry(): client.Registry {
    return this.registry;
  }
}
