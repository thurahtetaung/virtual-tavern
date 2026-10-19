/**
 * A tiny Prometheus text-format registry: counters, histograms, and gauges read when scraped.
 * Labels must come from small fixed sets (game ids, error codes), never from rooms or players.
 */

export type Labels = Readonly<Record<string, string>>;
export type Sample = readonly [labels: Labels, value: number];

const escape = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

function labelText(labels: Labels): string {
  const parts = Object.entries(labels).map(([k, v]) => `${k}="${escape(v)}"`);
  return parts.length ? `{${parts.join(',')}}` : '';
}

const num = (value: number) =>
  Number.isNaN(value)
    ? 'NaN'
    : value === Infinity
      ? '+Inf'
      : value === -Infinity
        ? '-Inf'
        : String(value);

const header = (name: string, help: string, type: string) => [
  `# HELP ${name} ${help}`,
  `# TYPE ${name} ${type}`,
];

interface Metric {
  readonly name: string;
  render(): string[];
}

export class Counter implements Metric {
  readonly name: string;
  private readonly help: string;
  private readonly values = new Map<string, number>();

  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }

  inc(labels: Labels = {}, by = 1): void {
    const key = labelText(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + by);
  }

  render(): string[] {
    const lines = header(this.name, this.help, 'counter');
    for (const [key, value] of this.values) lines.push(`${this.name}${key} ${num(value)}`);
    return lines;
  }
}

interface Buckets {
  labels: Labels;
  counts: number[];
  sum: number;
  count: number;
}

export class Histogram implements Metric {
  readonly name: string;
  private readonly help: string;
  private readonly bounds: readonly number[];
  private readonly series = new Map<string, Buckets>();

  constructor(name: string, help: string, bounds: readonly number[]) {
    this.name = name;
    this.help = help;
    this.bounds = bounds;
  }

  /** Starts a series at zero, so its first observation already shows as an increase. */
  touch(labels: Labels = {}): Buckets {
    const key = labelText(labels);
    let s = this.series.get(key);
    if (!s) {
      s = { labels, counts: this.bounds.map(() => 0), sum: 0, count: 0 };
      this.series.set(key, s);
    }
    return s;
  }

  observe(labels: Labels, value: number): void {
    const s = this.touch(labels);
    this.bounds.forEach((le, i) => {
      if (value <= le) s.counts[i]! += 1;
    });
    s.sum += value;
    s.count += 1;
  }

  render(): string[] {
    const lines = header(this.name, this.help, 'histogram');
    for (const s of this.series.values()) {
      this.bounds.forEach((le, i) =>
        lines.push(`${this.name}_bucket${labelText({ ...s.labels, le: num(le) })} ${s.counts[i]}`),
      );
      lines.push(`${this.name}_bucket${labelText({ ...s.labels, le: '+Inf' })} ${s.count}`);
      lines.push(`${this.name}_sum${labelText(s.labels)} ${num(s.sum)}`);
      lines.push(`${this.name}_count${labelText(s.labels)} ${s.count}`);
    }
    return lines;
  }
}

/** A value worked out at scrape time. */
class Collected implements Metric {
  readonly name: string;
  private readonly help: string;
  private readonly type: 'gauge' | 'counter';
  private readonly collect: () => readonly Sample[];

  constructor(
    name: string,
    help: string,
    type: 'gauge' | 'counter',
    collect: () => readonly Sample[],
  ) {
    this.name = name;
    this.help = help;
    this.type = type;
    this.collect = collect;
  }

  render(): string[] {
    const samples = this.collect();
    if (!samples.length) return [];
    const lines = header(this.name, this.help, this.type);
    for (const [labels, value] of samples)
      lines.push(`${this.name}${labelText(labels)} ${num(value)}`);
    return lines;
  }
}

export class Registry {
  private readonly metrics: Metric[] = [];
  private readonly onError: (name: string, err: unknown) => void;

  constructor(onError: (name: string, err: unknown) => void = () => {}) {
    this.onError = onError;
  }

  counter(name: string, help: string): Counter {
    return this.add(new Counter(name, help));
  }

  histogram(name: string, help: string, bounds: readonly number[]): Histogram {
    return this.add(new Histogram(name, help, bounds));
  }

  gauge(name: string, help: string, collect: () => readonly Sample[]): void {
    this.add(new Collected(name, help, 'gauge', collect));
  }

  /** A counter someone else keeps (the process CPU time). */
  collectedCounter(name: string, help: string, collect: () => readonly Sample[]): void {
    this.add(new Collected(name, help, 'counter', collect));
  }

  /** The text exposition; a metric that fails to collect is left out, never the whole page. */
  render(): string {
    const lines: string[] = [];
    for (const m of this.metrics) {
      try {
        lines.push(...m.render());
      } catch (err) {
        this.onError(m.name, err);
      }
    }
    return `${lines.join('\n')}\n`;
  }

  private add<M extends Metric>(metric: M): M {
    this.metrics.push(metric);
    return metric;
  }
}
