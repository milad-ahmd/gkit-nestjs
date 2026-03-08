/**
 * Metrics module unit tests.
 *
 * prom-client is mocked so no real Prometheus registry is created.
 */

jest.mock('prom-client');

import * as client from 'prom-client';
import { MetricsRegistry } from './index';

const mockClient = jest.mocked(client);

describe('MetricsRegistry', () => {
  let mockRegistryInstance: {
    contentType: string;
    metrics: jest.Mock;
  };
  let mockCounterInstance: { inc: jest.Mock };
  let mockGaugeInstance: { set: jest.Mock };
  let mockHistogramInstance: { observe: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();

    mockRegistryInstance = { contentType: 'text/plain', metrics: jest.fn().mockResolvedValue('# metrics') };
    mockCounterInstance = { inc: jest.fn() };
    mockGaugeInstance = { set: jest.fn() };
    mockHistogramInstance = { observe: jest.fn() };

    (mockClient.Registry as unknown as jest.Mock).mockImplementation(() => mockRegistryInstance);
    (mockClient.Counter as unknown as jest.Mock).mockImplementation(() => mockCounterInstance);
    (mockClient.Gauge as unknown as jest.Mock).mockImplementation(() => mockGaugeInstance);
    (mockClient.Histogram as unknown as jest.Mock).mockImplementation(() => mockHistogramInstance);
    (mockClient.collectDefaultMetrics as jest.Mock).mockImplementation(() => {});
    (mockClient.linearBuckets as jest.Mock).mockReturnValue([0, 50, 100, 150]);
  });

  it('creates a registry and collects default metrics on construction', () => {
    const reg = new MetricsRegistry('myapp');
    expect(mockClient.Registry).toHaveBeenCalled();
    expect(mockClient.collectDefaultMetrics).toHaveBeenCalledWith({ register: mockRegistryInstance });
    expect(reg).toBeDefined();
  });

  describe('createCounter()', () => {
    it('creates a Counter with namespace prefix', () => {
      const reg = new MetricsRegistry('app');
      reg.createCounter({ name: 'requests', help: 'Total requests' });
      expect(mockClient.Counter).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'app_requests', help: 'Total requests' }),
      );
    });

    it('returns the Counter instance', () => {
      const reg = new MetricsRegistry('app');
      const counter = reg.createCounter({ name: 'c', help: 'h' });
      expect(counter).toBe(mockCounterInstance);
    });
  });

  describe('createGauge()', () => {
    it('creates a Gauge with namespace prefix', () => {
      const reg = new MetricsRegistry('app');
      reg.createGauge({ name: 'connections', help: 'Active connections' });
      expect(mockClient.Gauge).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'app_connections' }),
      );
    });

    it('returns the Gauge instance', () => {
      const reg = new MetricsRegistry('app');
      const gauge = reg.createGauge({ name: 'g', help: 'h' });
      expect(gauge).toBe(mockGaugeInstance);
    });
  });

  describe('createHistogram()', () => {
    it('creates a Histogram with namespace prefix', () => {
      const reg = new MetricsRegistry('app');
      reg.createHistogram({ name: 'latency', help: 'Response latency' });
      expect(mockClient.Histogram).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'app_latency' }),
      );
    });

    it('uses provided buckets', () => {
      const reg = new MetricsRegistry('app');
      reg.createHistogram({ name: 'h', help: 'h', buckets: [10, 50, 100] });
      expect(mockClient.Histogram).toHaveBeenCalledWith(
        expect.objectContaining({ buckets: [10, 50, 100] }),
      );
    });

    it('falls back to linearBuckets when no buckets provided', () => {
      const reg = new MetricsRegistry('app');
      reg.createHistogram({ name: 'h', help: 'h' });
      expect(mockClient.linearBuckets).toHaveBeenCalled();
    });
  });

  describe('metricsHandler()', () => {
    it('sets Content-Type and writes metrics output', async () => {
      const reg = new MetricsRegistry('app');
      const res = { set: jest.fn(), end: jest.fn() };
      await reg.metricsHandler({}, res);
      expect(res.set).toHaveBeenCalledWith('text/plain');
      expect(res.end).toHaveBeenCalledWith('# metrics');
    });
  });

  describe('getRegistry()', () => {
    it('returns the underlying prom-client Registry', () => {
      const reg = new MetricsRegistry('app');
      expect(reg.getRegistry()).toBe(mockRegistryInstance);
    });
  });
});
