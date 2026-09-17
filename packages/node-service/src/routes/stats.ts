import type { SeedSize } from '@rljson-tryout/domain';
import type { FastifyInstance } from 'fastify';

import type { Configuration } from '../configuration.ts';
import type { PetShopStore } from '../store/petShopStore.ts';

/**
 * The answer of `GET /api/stats` (roadmap section 2.5): what this node was
 * seeded with, how long it has been up, how much memory the process holds
 * (`rssBytes`, the resident set size, which is what a large seed in an
 * in-memory store shows up in) and the row count of every table.
 */
export type StatsReport = {
  nodeName: string;
  seedSize: SeedSize;
  uptimeSeconds: number;
  startedAt: string;
  rssBytes: number;
  tables: Record<string, number>;
};

export type StatsSources = Readonly<{
  configuration: Pick<Configuration, 'nodeName' | 'seedSize'>;
  store: Pick<PetShopStore, 'tableRowCounts'>;
  startedAt: Date;
  now?: () => Date;
  residentSetSize?: () => number;
}>;

export const buildStatsReport = async ({
  configuration,
  store,
  startedAt,
  now = () => new Date(),
  residentSetSize = () => process.memoryUsage().rss,
}: StatsSources): Promise<StatsReport> => ({
  nodeName: configuration.nodeName,
  seedSize: configuration.seedSize,
  uptimeSeconds: Math.max(
    0,
    Math.round((now().getTime() - startedAt.getTime()) / 1000),
  ),
  startedAt: startedAt.toISOString(),
  rssBytes: residentSetSize(),
  tables: await store.tableRowCounts(),
});

/**
 * Registers `GET /api/stats`. Like `/status`, the response allows
 * cross-origin reads so that a browser on any node can compare the nodes.
 */
export const registerStatsRoute = (
  server: FastifyInstance,
  sources: StatsSources,
): void => {
  server.get('/api/stats', async (_request, reply): Promise<StatsReport> => {
    reply.header('access-control-allow-origin', '*');
    return buildStatsReport(sources);
  });
};
