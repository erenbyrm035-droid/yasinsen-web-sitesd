import { NextResponse } from 'next/server';
import { getDashboardStats, listLeadTable, getLeadDetail } from '@/lib/db/repositories/views';

export const dynamic = 'force-dynamic';

/**
 * GET /api/leads          → KPI'lar + lead tablosu (purchase score azalan)
 * GET /api/leads?id=3     → tek lead'in tam detayi (denetimler, skor kirilimi, teklif)
 *
 * Salt okunur. Bu uc hicbir yazma islemi yapmaz.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id');

  if (id) {
    const leadId = Number.parseInt(id, 10);
    if (Number.isNaN(leadId)) {
      return NextResponse.json({ error: 'Geçersiz lead id' }, { status: 400 });
    }

    const detail = getLeadDetail(leadId);
    if (!detail) {
      return NextResponse.json({ error: 'Lead bulunamadı' }, { status: 404 });
    }
    return NextResponse.json(detail);
  }

  return NextResponse.json({
    stats: getDashboardStats(),
    leads: listLeadTable(),
    generatedAt: new Date().toISOString(),
  });
}
