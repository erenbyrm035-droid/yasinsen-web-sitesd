import type { LeadSource } from '../types';
import { overpassSource } from './overpass';
import { apolloSource } from './apollo';
import { placesSource } from './places';

export const SOURCES: Record<string, LeadSource> = {
  osm: overpassSource,
  places: placesSource,
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

export { overpassSource, apolloSource, placesSource };
export { ApolloUnavailableError } from './apollo';
export { PlacesUnavailableError } from './places';
