import type { LeadSource } from '../types';
import { overpassSource } from './overpass';
import { apolloSource } from './apollo';

export const SOURCES: Record<string, LeadSource> = {
  osm: overpassSource,
  apollo: apolloSource,
};

export function getSource(id?: string): LeadSource {
  const key = (id ?? process.env.LEAD_SOURCE ?? 'osm').toLowerCase();
  const source = SOURCES[key];
  if (!source) {
    throw new Error(
      `Bilinmeyen lead kaynagi: "${key}". Gecerli degerler: ${Object.keys(SOURCES).join(', ')}`,
    );
  }
  return source;
}

export { overpassSource, apolloSource };
export { ApolloUnavailableError } from './apollo';
