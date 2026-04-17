"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Package, Truck, BarChart3, DollarSign, Tag, Edit3, Save } from "lucide-react";
import {
  GB_STATUS_CONFIG, SHIPPING_STATUS_CONFIG,
  type GbCampaign, type GbOrder, type GbSettlement, type GbPriceCheck, type ShippingStatus,
} from "@/lib/groupBuying/types";

interface Props {
  campaign: GbCampaign;
  onUpdate: () => void;
  onClose: () => void;
}

type Tab = "info" | "orders" | "prices" | "settlement" | "performance";

function formatPrice(n: number | null | undefined) {
  if (n == null) return "-";
  return n.toLocaleString("ko-KR") + "원";
}

// ── 메인 모달 ─────────────────────────────────────────────────────────

export default function CampaignDetailModal({ campaign: initialCampaign, onUpdate, onClose }: Props) {
  const [campaign, setCampaign] = useState(initialCampaign);
  const [tab, setTab] = useState<Tab>("info");
  const [orders, setOrders] = useState<GbOrder[]>([]);
  const [settlement, setSettlement] = useState<GbSettlement | null>(null);
  const [priceChecks, setPriceChecks] = useState<GbPriceCheck[]>([]);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<GbCampaign>>({});

  const id = campaign.id;

  const loadOrders = useCallback(async () => {
    const res = await fetch(`/api/group-buying/campaigns/${id}/orders`);
    const json = await res.json();
    setOrders(json.orders ?? []);
  }, [id]);

  const loadSettlement = useCallback(async () => {
    const res = await fetch(`/api/group-buying/campaigns/${id}/settlement`);
    const json = await res.json();
    setSettlement(json.settlement ?? null);
  }, [id]);

  const loadPrices = useCallback(async () => {
    const res = await fetch(`/api/group-buying/campaigns/${id}/price-check`);
    const json = await res.json();
    setPriceChecks(json.checks ?? []);
  }, [id]);

  useEffect(() => {
    loadOrders();
    loadSettlement();
    loadPrices();
  }, [loadOrders, loadSettlement, loadPrices]);

  const handleSaveEdit = async () => {
    await fetch(`/api/group-buying/campaigns/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editForm),
    });
    const res = await fetch(`/api/group-buying/campaigns/${id}`);
    const json = await res.json();
    setCampaign(json.campaign);
    setEditing(false);
    onUpdate();
  };

  const handleAddOrder = async () => {
    const name = prompt("고객명");
    if (!name) return;
    const qty = Number(prompt("수량", "1") ?? 1);
    const price = campaign.discount_price ?? campaign.original_price ?? 0;
    await fetch(`/api/group-buying/campaigns/${id}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_name: name,
        quantity: qty,
        unit_price: price,
        total_amount: price * qty,
        product_name: campaign.product_name,
        shipping_status: "pending",
        is_returned: false,
      }),
    });
    loadOrders();
  };

  const handleUpdateOrderStatus = async (orderId: string, status: ShippingStatus) => {
    await fetch(`/api/group-buying/orders/${orderId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shipping_status: status,
        ...(status === "shipped" ? { shipped_at: new Date().toISOString() } : {}),
        ...(status === "delivered" ? { delivered_at: new Date().toISOString() } : {}),
        ...(status === "returned" ? { is_returned: true } : {}),
      }),
    });
    loadOrders();
  };

  const handleCalculateSettlement = async () => {
    const shippingCost = Number(prompt("배송비 총액 (원)", "0") ?? 0);
    const productCost = Number(prompt("원가 총액 (원)", "0") ?? 0);
    await fetch(`/api/group-buying/campaigns/${id}/settlement`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shipping_cost: shippingCost, product_cost: productCost }),
    });
    loadSettlement();
    onUpdate();
  };

  const handleAddPriceCheck = async () => {
    const channel = prompt("채널 (예: musinsa, wconcept, 29cm, cafe24)");
    if (!channel) return;
    const price = Number(prompt("판매가 (원)") ?? 0);
    if (!price) return;
    await fetch(`/api/group-buying/campaigns/${id}/price-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel,
        price,
        checked_at: new Date().toISOString(),
        is_lowest: campaign.discount_price != null && campaign.discount_price <= price,
      }),
    });
    loadPrices();
  };

  const status = GB_STATUS_CONFIG[campaign.status];
  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "info", label: "정보", icon: Edit3 },
    { id: "orders", label: `주문 (${orders.length})`, icon: Package },
    { id: "prices", label: "가격비교", icon: Tag },
    { id: "settlement", label: "정산", icon: DollarSign },
    { id: "performance", label: "성과", icon: BarChart3 },
  ];

  const inputCls = "w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  // 주문 집계
  const validOrders = orders.filter((o) => !o.is_returned);
  const totalQty = validOrders.reduce((s, o) => s + o.quantity, 0);
  const totalRev = validOrders.reduce((s, o) => s + o.total_amount, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl">
        {/* 헤더 */}
        <div className="flex items-center justify-between p-5 border-b border-zinc-100 dark:border-zinc-800">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-zinc-800 dark:text-zinc-100">{campaign.title}</h2>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${status.bg} ${status.color}`}>{status.label}</span>
            </div>
            <p className="text-sm text-zinc-400 mt-0.5">@{campaign.influencer_handle}</p>
          </div>
          <button onClick={onClose} className="p-1 text-zinc-400 hover:text-zinc-600 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* 탭 */}
        <div className="flex gap-1 px-5 pt-3 border-b border-zinc-100 dark:border-zinc-800 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? "border-violet-600 text-violet-600"
                  : "border-transparent text-zinc-400 hover:text-zinc-600"
              }`}
            >
              <t.icon size={14} />
              {t.label}
            </button>
          ))}
        </div>

        {/* 탭 내용 */}
        <div className="p-5 space-y-4">
          {/* ── 정보 탭 ── */}
          {tab === "info" && (
            <>
              {!editing ? (
                <div className="space-y-3">
                  <Row label="인플루언서" value={`@${campaign.influencer_handle} (${campaign.influencer_name ?? "-"})`} />
                  <Row label="플랫폼" value={campaign.influencer_platform ?? "-"} />
                  <Row label="팔로워" value={campaign.influencer_followers?.toLocaleString() ?? "-"} />
                  <Row label="상품" value={campaign.product_name ?? "-"} />
                  <Row label="SKU" value={campaign.product_sku ?? "-"} />
                  <Row label="정가" value={formatPrice(campaign.original_price)} />
                  <Row label="공구가" value={formatPrice(campaign.discount_price)} />
                  <Row label="수수료" value={campaign.commission_type === "rate" ? `${campaign.commission_rate ?? 0}%` : `건당 ${formatPrice(campaign.commission_fixed_amount)}`} />
                  <Row label="기간" value={campaign.start_date ? `${campaign.start_date} ~ ${campaign.end_date ?? ""}` : "-"} />
                  <Row label="배정수량" value={`${campaign.allocated_stock}개`} />
                  <Row label="주문방식" value={campaign.order_mode === "cafe24" ? "자사몰 (Cafe24)" : "발주서"} />
                  {campaign.notes && <Row label="메모" value={campaign.notes} />}
                  <button
                    onClick={() => { setEditing(true); setEditForm(campaign); }}
                    className="w-full flex items-center justify-center gap-1.5 text-sm font-medium text-violet-600 border border-violet-200 dark:border-violet-800 rounded-xl py-2 hover:bg-violet-50 dark:hover:bg-violet-950/30 transition-colors"
                  >
                    <Edit3 size={14} /> 수정
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-zinc-500 mb-1 block">캠페인 제목</label>
                    <input className={inputCls} value={editForm.title ?? ""} onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-zinc-500 mb-1 block">공구가</label>
                      <input className={inputCls} type="number" value={editForm.discount_price ?? ""} onChange={(e) => setEditForm((f) => ({ ...f, discount_price: Number(e.target.value) || null }))} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-zinc-500 mb-1 block">수수료율 (%)</label>
                      <input className={inputCls} type="number" step="0.1" value={editForm.commission_rate ?? ""} onChange={(e) => setEditForm((f) => ({ ...f, commission_rate: Number(e.target.value) || null }))} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-zinc-500 mb-1 block">시작일</label>
                      <input className={inputCls} type="date" value={editForm.start_date ?? ""} onChange={(e) => setEditForm((f) => ({ ...f, start_date: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-zinc-500 mb-1 block">종료일</label>
                      <input className={inputCls} type="date" value={editForm.end_date ?? ""} onChange={(e) => setEditForm((f) => ({ ...f, end_date: e.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-zinc-500 mb-1 block">배정 수량</label>
                    <input className={inputCls} type="number" value={editForm.allocated_stock ?? 0} onChange={(e) => setEditForm((f) => ({ ...f, allocated_stock: Number(e.target.value) || 0 }))} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-zinc-500 mb-1 block">메모</label>
                    <textarea className={inputCls} rows={3} value={editForm.notes ?? ""} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setEditing(false)} className="flex-1 py-2 text-sm text-zinc-500 border border-zinc-200 dark:border-zinc-700 rounded-xl hover:bg-zinc-50 transition-colors">취소</button>
                    <button onClick={handleSaveEdit} className="flex-1 py-2 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-xl transition-colors flex items-center justify-center gap-1">
                      <Save size={14} /> 저장
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── 주문 탭 ── */}
          {tab === "orders" && (
            <>
              <div className="flex items-center justify-between">
                <div className="text-sm text-zinc-500">
                  총 <span className="font-semibold text-zinc-800 dark:text-zinc-200">{totalQty}개</span> 판매 ·{" "}
                  <span className="font-semibold text-violet-600">{formatPrice(totalRev)}</span>
                </div>
                <button
                  onClick={handleAddOrder}
                  className="text-xs font-medium bg-violet-600 text-white px-3 py-1.5 rounded-lg hover:bg-violet-700 transition-colors"
                >
                  + 주문 추가
                </button>
              </div>
              {orders.length === 0 ? (
                <p className="text-center text-sm text-zinc-400 py-12">아직 주문이 없습니다</p>
              ) : (
                <div className="space-y-2">
                  {orders.map((o) => {
                    const ss = SHIPPING_STATUS_CONFIG[o.shipping_status];
                    return (
                      <div key={o.id} className={`flex items-center justify-between bg-zinc-50 dark:bg-zinc-800 rounded-xl px-4 py-3 ${o.is_returned ? "opacity-50" : ""}`}>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200 truncate">
                            {o.customer_name ?? o.cafe24_order_id ?? "주문"}
                            {o.variant_name && <span className="text-zinc-400 ml-1">({o.variant_name})</span>}
                          </p>
                          <p className="text-xs text-zinc-400">{o.quantity}개 · {formatPrice(o.total_amount)}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-medium ${ss.color}`}>{ss.label}</span>
                          <select
                            className="text-xs bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-lg px-2 py-1"
                            value={o.shipping_status}
                            onChange={(e) => handleUpdateOrderStatus(o.id, e.target.value as ShippingStatus)}
                          >
                            <option value="pending">대기</option>
                            <option value="preparing">준비중</option>
                            <option value="shipped">발송</option>
                            <option value="delivered">배달완료</option>
                            <option value="returned">반품</option>
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* ── 가격비교 탭 ── */}
          {tab === "prices" && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-zinc-500">
                  공구가: <span className="font-semibold text-violet-600">{formatPrice(campaign.discount_price)}</span>
                </p>
                <button
                  onClick={handleAddPriceCheck}
                  className="text-xs font-medium bg-violet-600 text-white px-3 py-1.5 rounded-lg hover:bg-violet-700 transition-colors"
                >
                  + 채널 추가
                </button>
              </div>
              {priceChecks.length === 0 ? (
                <p className="text-center text-sm text-zinc-400 py-12">아직 가격 비교 데이터가 없습니다</p>
              ) : (
                <div className="space-y-2">
                  {priceChecks.map((pc) => {
                    const isLower = campaign.discount_price != null && campaign.discount_price <= pc.price;
                    return (
                      <div key={pc.id} className="flex items-center justify-between bg-zinc-50 dark:bg-zinc-800 rounded-xl px-4 py-3">
                        <div>
                          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{pc.channel}</p>
                          <p className="text-xs text-zinc-400">{new Date(pc.checked_at).toLocaleDateString("ko-KR")}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{formatPrice(pc.price)}</p>
                          {isLower ? (
                            <p className="text-[10px] text-emerald-600 font-medium">최저가 OK</p>
                          ) : (
                            <p className="text-[10px] text-red-500 font-medium">공구가가 더 높음!</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* ── 정산 탭 ── */}
          {tab === "settlement" && (
            <>
              {settlement ? (
                <div className="space-y-3">
                  <Row label="총 매출" value={formatPrice(settlement.total_revenue)} />
                  <Row label="총 수량" value={`${settlement.total_quantity}개`} />
                  <Row label="반품 차감" value={`-${formatPrice(settlement.return_amount)}`} />
                  <Row label="순매출" value={formatPrice(settlement.net_revenue)} highlight />
                  <Row label="수수료" value={`-${formatPrice(settlement.commission_amount)}`} />
                  <Row label="배송비" value={`-${formatPrice(settlement.shipping_cost)}`} />
                  <Row label="원가" value={`-${formatPrice(settlement.product_cost)}`} />
                  <div className="border-t border-zinc-200 dark:border-zinc-700 pt-3">
                    <Row label="순이익" value={formatPrice(settlement.net_profit)} highlight />
                  </div>
                  {settlement.settled_at && (
                    <p className="text-xs text-zinc-400">정산일: {new Date(settlement.settled_at).toLocaleDateString("ko-KR")}</p>
                  )}
                  <button onClick={handleCalculateSettlement} className="w-full text-sm font-medium text-violet-600 border border-violet-200 dark:border-violet-800 rounded-xl py-2 hover:bg-violet-50 transition-colors">
                    재계산
                  </button>
                </div>
              ) : (
                <div className="text-center py-12">
                  <p className="text-sm text-zinc-400 mb-4">아직 정산이 진행되지 않았습니다</p>
                  <button
                    onClick={handleCalculateSettlement}
                    className="text-sm font-semibold bg-violet-600 text-white px-6 py-2.5 rounded-xl hover:bg-violet-700 transition-colors"
                  >
                    <DollarSign size={14} className="inline mr-1" />
                    정산 계산
                  </button>
                </div>
              )}
            </>
          )}

          {/* ── 성과 탭 ── */}
          {tab === "performance" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <MiniCard label="총 판매" value={`${totalQty}개`} />
                <MiniCard label="총 매출" value={formatPrice(totalRev)} />
                <MiniCard label="배정 대비 판매율" value={campaign.allocated_stock > 0 ? `${Math.round((totalQty / campaign.allocated_stock) * 100)}%` : "-"} />
                <MiniCard label="순이익" value={settlement ? formatPrice(settlement.net_profit) : "-"} />
                <MiniCard label="수수료" value={settlement ? formatPrice(settlement.commission_amount) : "-"} />
                <MiniCard label="ROI" value={settlement && settlement.product_cost > 0 ? `${Math.round((settlement.net_profit / settlement.product_cost) * 100)}%` : "-"} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 유틸 컴포넌트 ─────────────────────────────────────────────────────

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-zinc-500">{label}</span>
      <span className={highlight ? "font-bold text-violet-600 text-base" : "font-medium text-zinc-700 dark:text-zinc-200"}>{value}</span>
    </div>
  );
}

function MiniCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl px-4 py-3">
      <p className="text-xs text-zinc-400 mb-1">{label}</p>
      <p className="text-lg font-bold text-zinc-800 dark:text-zinc-100">{value}</p>
    </div>
  );
}
