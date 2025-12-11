/**
 * Planner Metrics Module
 *
 * Implements planner metrics emission per PRD2 §12.2.
 * Tracks planning time, tables discovered, LLM token usage, and other metrics.
 *
 * @module agents/planner/metrics
 */

/**
 * Planner metrics per PRD2 §12.2.
 * Emitted to logs and optionally to metrics collector.
 */
export interface PlannerMetrics {
  // Required metrics
  planning_time_ms?: number;
  databases_analyzed: number;
  databases_unreachable: number;
  tables_discovered: number;
  domains_detected: number;
  llm_tokens_used?: number;
  llm_calls_made?: number;

  // Performance metrics
  connection_time_ms?: number;
  metadata_query_time_ms?: number;
  domain_inference_time_ms?: number;
  plan_write_time_ms?: number;

  // Quality metrics
  tables_per_domain_avg: number;
  unassigned_tables: number;
  domain_validation_warnings: number;
}

/**
 * Logger interface (subset of what we need)
 */
interface Logger {
  info(message: string, context?: Record<string, unknown>): void;
}

/**
 * Emit planner metrics to structured log.
 * Format matches PRD2 §12.1 structured JSON logging.
 */
export function emitPlannerMetrics(
  metrics: PlannerMetrics,
  logger: Logger,
  correlationId: string
): void {
  // Emit summary metrics
  logger.info('Planning phase completed', {
    operation: 'plan_complete',
    duration_ms: metrics.planning_time_ms,
    correlation_id: correlationId,
    metrics,
  });

  // Emit individual metric log entries for easy aggregation
  logger.info('Planner metric: databases', {
    operation: 'metric',
    metric_name: 'databases_analyzed',
    metric_value: metrics.databases_analyzed,
    correlation_id: correlationId,
  });

  if (metrics.databases_unreachable > 0) {
    logger.info('Planner metric: unreachable databases', {
      operation: 'metric',
      metric_name: 'databases_unreachable',
      metric_value: metrics.databases_unreachable,
      correlation_id: correlationId,
    });
  }

  logger.info('Planner metric: tables', {
    operation: 'metric',
    metric_name: 'tables_discovered',
    metric_value: metrics.tables_discovered,
    correlation_id: correlationId,
  });

  logger.info('Planner metric: domains', {
    operation: 'metric',
    metric_name: 'domains_detected',
    metric_value: metrics.domains_detected,
    correlation_id: correlationId,
  });

  if (metrics.llm_tokens_used && metrics.llm_tokens_used > 0) {
    logger.info('Planner metric: tokens', {
      operation: 'metric',
      metric_name: 'llm_tokens_used',
      metric_value: metrics.llm_tokens_used,
      correlation_id: correlationId,
    });
  }

  // Quality metrics
  if (metrics.unassigned_tables > 0) {
    logger.info('Planner metric: unassigned tables', {
      operation: 'metric',
      metric_name: 'unassigned_tables',
      metric_value: metrics.unassigned_tables,
      correlation_id: correlationId,
    });
  }

  if (metrics.domain_validation_warnings > 0) {
    logger.info('Planner metric: domain warnings', {
      operation: 'metric',
      metric_name: 'domain_validation_warnings',
      metric_value: metrics.domain_validation_warnings,
      correlation_id: correlationId,
    });
  }
}

/**
 * Create metrics collector that tracks timing throughout planning.
 */
export function createMetricsCollector(): {
  startTimer: (phase: string) => void;
  stopTimer: (phase: string) => void;
  increment: (metric: string, value?: number) => void;
  getMetrics: () => Partial<PlannerMetrics>;
} {
  const timers: Map<string, number> = new Map();
  const durations: Map<string, number> = new Map();
  const counters: Map<string, number> = new Map();

  return {
    startTimer: (phase: string): void => {
      timers.set(phase, Date.now());
    },

    stopTimer: (phase: string): void => {
      const start = timers.get(phase);
      if (start) {
        const duration = Date.now() - start;
        durations.set(phase, (durations.get(phase) || 0) + duration);
      }
    },

    increment: (metric: string, value: number = 1): void => {
      counters.set(metric, (counters.get(metric) || 0) + value);
    },

    getMetrics: (): Partial<PlannerMetrics> => ({
      planning_time_ms: durations.get('total'),
      connection_time_ms: durations.get('connection'),
      metadata_query_time_ms: durations.get('metadata'),
      domain_inference_time_ms: durations.get('domain_inference'),
      plan_write_time_ms: durations.get('write'),
      llm_tokens_used: counters.get('llm_tokens') || 0,
      llm_calls_made: counters.get('llm_calls') || 0,
      databases_analyzed: counters.get('databases') || 0,
      databases_unreachable: counters.get('databases_unreachable') || 0,
      tables_discovered: counters.get('tables') || 0,
      domains_detected: counters.get('domains') || 0,
    }),
  };
}

/**
 * Format metrics for CLI display.
 */
export function formatMetricsForDisplay(metrics: PlannerMetrics): string {
  const lines: string[] = [
    '=== Planner Metrics ===',
    '',
    'Databases:',
    `  Analyzed:     ${metrics.databases_analyzed}`,
    `  Unreachable:  ${metrics.databases_unreachable}`,
    '',
    'Tables:',
    `  Discovered:   ${metrics.tables_discovered}`,
    `  Per Domain:   ${metrics.tables_per_domain_avg.toFixed(1)} avg`,
    `  Unassigned:   ${metrics.unassigned_tables}`,
    '',
    'Domains:',
    `  Detected:     ${metrics.domains_detected}`,
    `  Warnings:     ${metrics.domain_validation_warnings}`,
    '',
  ];

  if (metrics.llm_tokens_used && metrics.llm_tokens_used > 0) {
    lines.push('LLM Usage:');
    lines.push(`  Tokens:       ${metrics.llm_tokens_used}`);
    lines.push(`  Calls:        ${metrics.llm_calls_made || 0}`);
    lines.push('');
  }

  if (metrics.planning_time_ms) {
    lines.push('Performance:');
    lines.push(`  Total Time:   ${(metrics.planning_time_ms / 1000).toFixed(2)}s`);

    if (metrics.connection_time_ms) {
      lines.push(`  Connection:   ${(metrics.connection_time_ms / 1000).toFixed(2)}s`);
    }
    if (metrics.domain_inference_time_ms) {
      lines.push(`  Inference:    ${(metrics.domain_inference_time_ms / 1000).toFixed(2)}s`);
    }
    if (metrics.plan_write_time_ms) {
      lines.push(`  Write:        ${(metrics.plan_write_time_ms / 1000).toFixed(2)}s`);
    }
  }

  return lines.join('\n');
}
