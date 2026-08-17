/** `--limit 10 --city istanbul --source osm` seklindeki CLI argumanlari. */
export interface CliArgs {
  limit?: number;
  city?: string;
  source?: string;
  force?: boolean;
  /** Buyuk partilerde per-lead gerekce ciktisini susturur. */
  quiet?: boolean;
  /** Es zamanli website denetimi sayisi. */
  concurrency?: number;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];

    switch (token) {
      case '--limit':
        if (next) {
          const parsed = Number.parseInt(next, 10);
          if (Number.isNaN(parsed) || parsed < 1) {
            throw new Error(`--limit pozitif bir tam sayi olmali, alinan: "${next}"`);
          }
          args.limit = parsed;
          i += 1;
        }
        break;
      case '--city':
        if (next) {
          args.city = next;
          i += 1;
        }
        break;
      case '--source':
        if (next) {
          args.source = next;
          i += 1;
        }
        break;
      case '--concurrency':
        if (next) {
          const parsed = Number.parseInt(next, 10);
          if (Number.isNaN(parsed) || parsed < 1 || parsed > 12) {
            throw new Error(`--concurrency 1-12 arasi olmali, alinan: "${next}"`);
          }
          args.concurrency = parsed;
          i += 1;
        }
        break;
      case '--force':
        args.force = true;
        break;
      case '--quiet':
        args.quiet = true;
        break;
      default:
        break;
    }
  }

  return args;
}
