import { getDb } from '../client';
import type { SocialPlatform } from '../../types';

/**
 * Elle girilen sosyal medya metrikleri.
 *
 * Instagram login duvari nedeniyle otomatik olculemeyen alanlar buradan
 * beslenir. Denetim tablolarindan ayri durur — `npm run audit` tekrar
 * calistiginda silinmez.
 */

export interface SocialManualInput {
  followers: number | null;
  postsLast30d: number | null;
  reelsLast30d: number | null;
  avgLikes: number | null;
  visualQuality: number | null;
  salesContent: number | null;
  bioHasWebsite: boolean | null;
  bioHasContact: boolean | null;
  note: string | null;
  enteredBy: string | null;
}

export interface StoredSocialManualInput extends SocialManualInput {
  id: number;
  companyId: number;
  platform: SocialPlatform;
  updatedAt: string;
}

interface Row {
  id: number;
  company_id: number;
  platform: SocialPlatform;
  followers: number | null;
  posts_last_30d: number | null;
  reels_last_30d: number | null;
  avg_likes: number | null;
  visual_quality: number | null;
  sales_content: number | null;
  bio_has_website: number | null;
  bio_has_contact: number | null;
  note: string | null;
  entered_by: string | null;
  updated_at: string;
}

function toModel(row: Row): StoredSocialManualInput {
  return {
    id: row.id,
    companyId: row.company_id,
    platform: row.platform,
    followers: row.followers,
    postsLast30d: row.posts_last_30d,
    reelsLast30d: row.reels_last_30d,
    avgLikes: row.avg_likes,
    visualQuality: row.visual_quality,
    salesContent: row.sales_content,
    bioHasWebsite: row.bio_has_website === null ? null : row.bio_has_website === 1,
    bioHasContact: row.bio_has_contact === null ? null : row.bio_has_contact === 1,
    note: row.note,
    enteredBy: row.entered_by,
    updatedAt: row.updated_at,
  };
}

/**
 * Elle girilen metrikleri kaydeder (company + platform basina tek satir).
 * Bos birakilan alanlar NULL kalir ve skorlamada hesaba katilmaz.
 */
export function upsertManualInput(
  companyId: number,
  platform: SocialPlatform,
  input: SocialManualInput,
): number {
  const row = getDb()
    .prepare(
      `INSERT INTO social_manual_inputs (
         company_id, platform, followers, posts_last_30d, reels_last_30d, avg_likes,
         visual_quality, sales_content, bio_has_website, bio_has_contact, note, entered_by
       ) VALUES (
         @companyId, @platform, @followers, @postsLast30d, @reelsLast30d, @avgLikes,
         @visualQuality, @salesContent, @bioHasWebsite, @bioHasContact, @note, @enteredBy
       )
       ON CONFLICT (company_id, platform) DO UPDATE SET
         followers       = excluded.followers,
         posts_last_30d  = excluded.posts_last_30d,
         reels_last_30d  = excluded.reels_last_30d,
         avg_likes       = excluded.avg_likes,
         visual_quality  = excluded.visual_quality,
         sales_content   = excluded.sales_content,
         bio_has_website = excluded.bio_has_website,
         bio_has_contact = excluded.bio_has_contact,
         note            = excluded.note,
         entered_by      = excluded.entered_by,
         updated_at      = datetime('now')
       RETURNING id`,
    )
    .get({
      companyId,
      platform,
      followers: input.followers,
      postsLast30d: input.postsLast30d,
      reelsLast30d: input.reelsLast30d,
      avgLikes: input.avgLikes,
      visualQuality: input.visualQuality,
      salesContent: input.salesContent,
      bioHasWebsite: input.bioHasWebsite === null ? null : input.bioHasWebsite ? 1 : 0,
      bioHasContact: input.bioHasContact === null ? null : input.bioHasContact ? 1 : 0,
      note: input.note,
      enteredBy: input.enteredBy,
    }) as { id: number };

  return row.id;
}

export function listManualInputs(companyId: number): StoredSocialManualInput[] {
  const rows = getDb()
    .prepare('SELECT * FROM social_manual_inputs WHERE company_id = ? ORDER BY platform')
    .all(companyId) as Row[];
  return rows.map(toModel);
}

export function getManualInput(
  companyId: number,
  platform: SocialPlatform,
): StoredSocialManualInput | null {
  const row = getDb()
    .prepare('SELECT * FROM social_manual_inputs WHERE company_id = ? AND platform = ?')
    .get(companyId, platform) as Row | undefined;
  return row ? toModel(row) : null;
}

export function deleteManualInput(companyId: number, platform: SocialPlatform): void {
  getDb()
    .prepare('DELETE FROM social_manual_inputs WHERE company_id = ? AND platform = ?')
    .run(companyId, platform);
}

/** Elle veri girilmis sirket sayisi — dashboard KPI'si icin. */
export function countCompaniesWithManualInput(): number {
  const row = getDb()
    .prepare('SELECT COUNT(DISTINCT company_id) AS n FROM social_manual_inputs')
    .get() as { n: number };
  return row.n;
}
