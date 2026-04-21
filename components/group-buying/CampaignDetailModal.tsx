"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Package, BarChart3, DollarSign, Tag, Edit3, Save, Plus, Trash2, ExternalLink, MessageSquare, Copy, Check } from "lucide-react";
import {
  GB_STATUS_CONFIG, SHIPPING_STATUS_CONFIG, getInfluencerProfileUrl, fillTemplate,
  type GbCampaign, type GbOrder, type GbProduct, type GbSettlement, type GbPriceCheck, type ShippingStatus, type GbProposalTemplate,
} from "@/lib/groupBuying/types";

interface Props {
  campaign: GbCampaign;
  onUpdate: () => void;
  onClose: () => void;
}

type Tab = "info" | "products" | "orders" | "prices" | "settlement" | "performance" | "proposal";

function formatPrice(n: number | null | undefined) {
  if (n == null) return "-";
  return n.toLocaleString("ko-KR") + "원";
}

export default function CampaignDetailModal({ campaign: initialCampaign, onUpdate, onClose }: Props) {
  const [campaign, setCampaign] = useState(initialCampaign);
  const [tab, setTab] = useState<Tab>("info");
  const [products, setProducts] = useState<GbProduct[]>([]);
  const [orders, setOrders] = useState<GbOrder[]>([]);
  const [settlement, setSettlement] = useState<GbSettlement | null>(null);
  const [priceChecks, setPriceChecks] = useState<GbPriceCheck[]>([]);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<GbCampaign>>({});

  const id = campaign.id;
  const base = `/api/group-buying/campaigns/${id}`;

  const loadProducts = useCallback(async () => {
    const res = await fetch(`${base}/products`);
    const json = await res.json();
    setProducts(json.products ?? []);
  }, [base]);

  const loadOrders = useCallback(async () => {
    const res = await fetch(`${base}/orders`);
    const json = await res.json();
    setOrders(json.orders ?? []);
  }, [base]);

  const loadSettlement = useCallback(async () => {
    const res = await fetch(`${base}/settlement`);
    const json = await res.json();
    setSettlement(json.settlement ?? null);
  }, [base]);

  const loadPrices = useCallback(async () => {
    const res = await fetch(`${base}/price-check`);
    const json = await res.json();
    setPriceChecks(json.checks ?? []);
  }, [base]);

  // 제안 템플릿
  const [templates, setTemplates] = useState<GbProposalTemplate[]>([]);
  const [proposalDraft, setProposalDraft] = useState<string>(initialCampaign.proposal_message ?? "");
  const [proposalSaving, setProposalSaving] = useState(false);
  const [proposalCopied, setProposalCopied] = useState(false);

  const loadTemplates = useCallback(async () => {
    const res = await fetch("/api/group-buying/proposal-templates");
    const json = await res.json();
    setTemplates(json.templates ?? []);
  }, []);

  useEffect(() => {
    loadProducts();
    loadOrders();
    loadSettlement();
    loadPrices();
    loadTemplates();
  }, [loadProducts, loadOrders, loadSettlement, loadPrices, loadTemplates]);

  useEffect(() => {
    setProposalDraft(campaign.proposal_message ?? "");
  }, [campaign.proposal_message]);

  const refreshCampaign = async () => {
    const res = await fetch(base);
    const json = await res.json();
    if (json.campaign) setCampaign(json.campaign);
    onUpdate();
  };

  const handleSaveEdit = async () => {
    await fetch(base, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editForm),
    });
    await refreshCampaign();
    setEditing(false);
  };

  // ── 상품 ──

  const [addingProduct, setAddingProduct] = useState(false);
  const [newProduct, setNewProduct] = useState({ product_name: "", product_sku: "", original_price: "", discount_price: "", allocated_stock: "" });

  const handleAddProduct = async () => {
    if (!newProduct.product_name) return;
    await fetch(`${base}/products`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product_name: newProduct.product_name,
        product_sku: newProduct.product_sku || null,
        product_image: null,
        original_price: newProduct.original_price ? Number(newProduct.original_price) : null,
        discount_price: newProduct.discount_price ? Number(newProduct.discount_price) : null,
        allocated_stock: newProduct.allocated_stock ? Number(newProduct.allocated_stock) : 0,
      }),
    });
    setNewProduct({ product_name: "", product_sku: "", original_price: "", discount_price: "", allocated_stock: "" });
    setAddingProduct(false);
    loadProducts();
    onUpdate();
  };

  const handleDeleteProduct = async (productId: string) => {
    if (!confirm("이 상품을 삭제하시겠습니까?")) return;
    await fetch(`${base}/products`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id: productId }),
    });
    loadProducts();
    onUpdate();
  };

  // ── 주문 ──

  const handleAddOrder = async () => {
    const name = prompt("고객명");
    if (!name) return;
    const qty = Number(prompt("수량", "1") ?? 1);
    // 상품이 여러개면 선택
    let productId: string | null = null;
    let productName = "";
    let unitPrice = 0;
    if (products.length === 1) {
      productId = products[0].id;
      productName = products[0].product_name;
      unitPrice = products[0].discount_price ?? products[0].original_price ?? 0;
    } else if (products.length > 1) {
      const options = products.map((p, i) => `${i + 1}. ${p.product_name}`).join("\n");
      const idx = Number(prompt(`상품 선택:\n${options}`, "1") ?? 1) - 1;
      const selected = products[idx];
      if (selected) {
        productId = selected.id;
        productName = selected.product_name;
        unitPrice = selected.discount_price ?? selected.original_price ?? 0;
      }
    }
    if (!unitPrice) {
      unitPrice = Number(prompt("단가 (원)", "0") ?? 0);
    }
    await fetch(`${base}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_name: name,
        quantity: qty,
        unit_price: unitPrice,
        total_amount: unitPrice * qty,
        product_name: productName,
        product_id: productId,
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

  // ── 정산 ──

  const handleCalculateSettlement = async () => {
    const shippingCost = Number(prompt("배송비 총액 (원)", "0") ?? 0);
    const productCost = Number(prompt("원가 총액 (원)", "0") ?? 0);
    await fetch(`${base}/settlement`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shipping_cost: shippingCost, product_cost: productCost }),
    });
    loadSettlement();
    onUpdate();
  };

  // ── 제안메시지 ──

  const handleLoadTemplate = (templateId: string) => {
    const t = templates.find((x) => x.id === templateId);
    if (!t) return;
    if (proposalDraft.trim() && !confirm("현재 작성 중인 내용을 덮어씁니다. 계속할까요?")) return;
    const filled = fillTemplate(t.body, { campaign: { ...campaign, products } });
    setProposalDraft(filled);
  };

  const handleSaveProposal = async () => {
    setProposalSaving(true);
    try {
      await fetch(base, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposal_message: proposalDraft || null }),
      });
      await refreshCampaign();
    } finally {
      setProposalSaving(false);
    }
  };

  const handleCopyProposal = async () => {
    if (!proposalDraft) return;
    await navigator.clipboard.writeText(proposalDraft);
    setProposalCopied(true);
    setTimeout(() => setProposalCopied(false), 1500);
  };

  // ── 가격비교 ──

  const handleAddPriceCheck = async () => {
    const channel = prompt("채널 (예: musinsa, wconcept, 29cm, cafe24)");
    if (!channel) return;
    const price = Number(prompt("판매가 (원)") ?? 0);
    if (!price) return;
    await fetch(`${base}/price-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel,
        price,
        checked_at: new Date().toISOString(),
        is_lowest: false,
      }),
    });
    loadPrices();
  };

  const status = GB_STATUS_CONFIG[campaign.status];
  const profileUrl = getInfluencerProfileUrl(campaign.influencer_handle, campaign.influencer_platform);
  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "info", label: "정보", icon: Edit3 },
    { id: "proposal", label: "제안", icon: MessageSquare },
    { id: "products", label: `상품 (${products.length})`, icon: Package },
    { id: "orders", label: `주문 (${orders.length})`, icon: Package },
    { id: "prices", label: "가격비교", icon: Tag },
    { id: "settlement", label: "정산", icon: DollarSign },
    { id: "performance", label: "성과", icon: BarChart3 },
  ];

  const inputCls = "w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

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
            {profileUrl ? (
              <a
                href={profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-violet-600 transition-colors mt-0.5"
                title={`${campaign.influencer_platform ?? ""} 프로필 방문`}
              >
                @{campaign.influencer_handle.replace(/^@+/, "")}
                <ExternalLink size={12} />
              </a>
            ) : (
              <p className="text-sm text-zinc-400 mt-0.5">@{campaign.influencer_handle}</p>
            )}
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

        <div className="p-5 space-y-4">
          {/* ── 정보 탭 ── */}
          {tab === "info" && (
            <>
              {!editing ? (
                <div className="space-y-3">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-zinc-500">인플루언서</span>
                    {profileUrl ? (
                      <a
                        href={profileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-violet-600 hover:underline"
                      >
                        @{campaign.influencer_handle.replace(/^@+/, "")}
                        {campaign.influencer_name ? ` (${campaign.influencer_name})` : ""}
                        <ExternalLink size={12} />
                      </a>
                    ) : (
                      <span className="font-medium text-zinc-700 dark:text-zinc-200">
                        @{campaign.influencer_handle} ({campaign.influencer_name ?? "-"})
                      </span>
                    )}
                  </div>
                  <Row label="플랫폼" value={campaign.influencer_platform ?? "-"} />
                  <Row label="팔로워" value={campaign.influencer_followers?.toLocaleString() ?? "-"} />
                  <Row label="수수료" value={campaign.commission_type === "rate" ? (campaign.commission_rate != null ? `${campaign.commission_rate}%` : "미정") : `건당 ${formatPrice(campaign.commission_fixed_amount)}`} />
                  <Row label="기간" value={campaign.start_date ? `${campaign.start_date} ~ ${campaign.end_date ?? ""}` : "미정"} />
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
                      <label className="text-xs font-medium text-zinc-500 mb-1 block">수수료 방식</label>
                      <select className={inputCls} value={editForm.commission_type ?? "rate"} onChange={(e) => setEditForm((f) => ({ ...f, commission_type: e.target.value as "rate" | "fixed_per_unit" }))}>
                        <option value="rate">비율 (%)</option>
                        <option value="fixed_per_unit">건당 고정</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-zinc-500 mb-1 block">
                        {editForm.commission_type === "rate" ? "수수료율 (%)" : "건당 금액 (원)"}
                      </label>
                      <input className={inputCls} type="number" step="0.1"
                        value={(editForm.commission_type === "rate" ? editForm.commission_rate : editForm.commission_fixed_amount) ?? ""}
                        onChange={(e) => {
                          const v = Number(e.target.value) || null;
                          setEditForm((f) => editForm.commission_type === "rate"
                            ? { ...f, commission_rate: v }
                            : { ...f, commission_fixed_amount: v ? Math.round(v) : null }
                          );
                        }}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-zinc-500 mb-1 block">시작일</label>
                      <input className={inputCls} type="date" value={editForm.start_date ?? ""} onChange={(e) => setEditForm((f) => ({ ...f, start_date: e.target.value || null }))} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-zinc-500 mb-1 block">종료일</label>
                      <input className={inputCls} type="date" value={editForm.end_date ?? ""} onChange={(e) => setEditForm((f) => ({ ...f, end_date: e.target.value || null }))} />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-zinc-500 mb-1 block">주문방식</label>
                    <select className={inputCls} value={editForm.order_mode ?? "cafe24"} onChange={(e) => setEditForm((f) => ({ ...f, order_mode: e.target.value as "cafe24" | "purchase_order" }))}>
                      <option value="cafe24">자사몰 (Cafe24)</option>
                      <option value="purchase_order">발주서</option>
                    </select>
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

          {/* ── 상품 탭 ── */}
          {tab === "products" && (
            <>
              {products.length === 0 && !addingProduct && (
                <p className="text-center text-sm text-zinc-400 py-8">아직 등록된 상품이 없습니다</p>
              )}
              {products.map((p) => (
                <div key={p.id} className="flex items-center justify-between bg-zinc-50 dark:bg-zinc-800 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {p.product_image ? (
                      <img src={p.product_image} alt="" className="w-10 h-10 rounded-lg object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center">
                        <Package size={16} className="text-zinc-400" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200 truncate">{p.product_name}</p>
                      <div className="flex gap-2 text-xs text-zinc-400">
                        {p.product_sku && <span>SKU: {p.product_sku}</span>}
                        {p.discount_price && <span className="text-violet-600 font-medium">{formatPrice(p.discount_price)}</span>}
                        {p.original_price && <span className="line-through">{formatPrice(p.original_price)}</span>}
                        {p.allocated_stock > 0 && <span>배정 {p.allocated_stock}개</span>}
                      </div>
                    </div>
                  </div>
                  <button onClick={() => handleDeleteProduct(p.id)} className="p-1.5 text-zinc-400 hover:text-red-500 transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}

              {addingProduct && (
                <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl p-4 space-y-3">
                  <div>
                    <label className="text-xs font-medium text-zinc-500 mb-1 block">상품명 *</label>
                    <input className={inputCls} placeholder="상품명" value={newProduct.product_name} onChange={(e) => setNewProduct((f) => ({ ...f, product_name: e.target.value }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-zinc-500 mb-1 block">SKU</label>
                      <input className={inputCls} placeholder="Cafe24 SKU" value={newProduct.product_sku} onChange={(e) => setNewProduct((f) => ({ ...f, product_sku: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-zinc-500 mb-1 block">배정 수량</label>
                      <input className={inputCls} type="number" placeholder="100" value={newProduct.allocated_stock} onChange={(e) => setNewProduct((f) => ({ ...f, allocated_stock: e.target.value }))} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-zinc-500 mb-1 block">정가 (원)</label>
                      <input className={inputCls} type="number" placeholder="150000" value={newProduct.original_price} onChange={(e) => setNewProduct((f) => ({ ...f, original_price: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-zinc-500 mb-1 block">공구가 (원)</label>
                      <input className={inputCls} type="number" placeholder="120000" value={newProduct.discount_price} onChange={(e) => setNewProduct((f) => ({ ...f, discount_price: e.target.value }))} />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setAddingProduct(false)} className="flex-1 py-2 text-sm text-zinc-500 border border-zinc-200 dark:border-zinc-700 rounded-xl hover:bg-zinc-50 transition-colors">취소</button>
                    <button onClick={handleAddProduct} className="flex-1 py-2 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-xl transition-colors">추가</button>
                  </div>
                </div>
              )}

              {!addingProduct && (
                <button
                  onClick={() => setAddingProduct(true)}
                  className="w-full flex items-center justify-center gap-1.5 text-sm font-medium text-violet-600 border border-violet-200 dark:border-violet-800 rounded-xl py-2.5 hover:bg-violet-50 dark:hover:bg-violet-950/30 transition-colors"
                >
                  <Plus size={14} /> 상품 추가
                </button>
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
                <button onClick={handleAddOrder} className="text-xs font-medium bg-violet-600 text-white px-3 py-1.5 rounded-lg hover:bg-violet-700 transition-colors">
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
                            {o.product_name && <span className="text-zinc-400 ml-1 text-xs">· {o.product_name}</span>}
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

          {/* ── 제안 탭 ── */}
          {tab === "proposal" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <select
                  onChange={(e) => { if (e.target.value) { handleLoadTemplate(e.target.value); e.target.value = ""; } }}
                  defaultValue=""
                  className={inputCls + " flex-1"}
                >
                  <option value="" disabled>
                    {templates.length === 0 ? "등록된 템플릿이 없습니다" : "템플릿 불러오기..."}
                  </option>
                  {templates
                    .filter((t) => !t.platform || t.platform === "all" || t.platform === campaign.influencer_platform)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.platform && t.platform !== "all" ? ` · ${t.platform}` : ""}
                      </option>
                    ))}
                </select>
                <a
                  href="/tools/group-buying/proposal-templates"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-xs text-violet-600 hover:underline whitespace-nowrap px-2"
                >
                  템플릿 관리
                </a>
              </div>

              <textarea
                className={inputCls + " font-mono"}
                rows={12}
                placeholder="템플릿을 불러오거나 직접 작성하세요. {{handle}} 같은 변수는 불러올 때 자동 치환됩니다."
                value={proposalDraft}
                onChange={(e) => setProposalDraft(e.target.value)}
              />

              <div className="flex gap-2">
                <button
                  onClick={handleCopyProposal}
                  disabled={!proposalDraft}
                  className="flex-1 flex items-center justify-center gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 rounded-xl py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
                >
                  {proposalCopied ? <><Check size={14} /> 복사됨</> : <><Copy size={14} /> 클립보드 복사</>}
                </button>
                <button
                  onClick={handleSaveProposal}
                  disabled={proposalSaving}
                  className="flex-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-xl py-2.5 transition-colors disabled:opacity-50"
                >
                  <Save size={14} /> {proposalSaving ? "저장 중..." : "저장"}
                </button>
              </div>

              <p className="text-xs text-zinc-400 leading-relaxed">
                💡 실제 전송은 IG/카톡 등에서 붙여넣기. 저장하면 나중에 이 캠페인을 다시 열었을 때 보낸 메시지가 복원됩니다.
              </p>
            </div>
          )}

          {/* ── 가격비교 탭 ── */}
          {tab === "prices" && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-zinc-500">
                  {products.length > 0
                    ? `공구가: ${products.map((p) => p.discount_price ? formatPrice(p.discount_price) : "미정").join(", ")}`
                    : "상품 미등록"}
                </p>
                <button onClick={handleAddPriceCheck} className="text-xs font-medium bg-violet-600 text-white px-3 py-1.5 rounded-lg hover:bg-violet-700 transition-colors">
                  + 채널 추가
                </button>
              </div>
              {priceChecks.length === 0 ? (
                <p className="text-center text-sm text-zinc-400 py-12">아직 가격 비교 데이터가 없습니다</p>
              ) : (
                <div className="space-y-2">
                  {priceChecks.map((pc) => (
                    <div key={pc.id} className="flex items-center justify-between bg-zinc-50 dark:bg-zinc-800 rounded-xl px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{pc.channel}</p>
                        <p className="text-xs text-zinc-400">{new Date(pc.checked_at).toLocaleDateString("ko-KR")}</p>
                      </div>
                      <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{formatPrice(pc.price)}</p>
                    </div>
                  ))}
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
                  <button onClick={handleCalculateSettlement} className="w-full text-sm font-medium text-violet-600 border border-violet-200 dark:border-violet-800 rounded-xl py-2 hover:bg-violet-50 transition-colors">재계산</button>
                </div>
              ) : (
                <div className="text-center py-12">
                  <p className="text-sm text-zinc-400 mb-4">아직 정산이 진행되지 않았습니다</p>
                  <button onClick={handleCalculateSettlement} className="text-sm font-semibold bg-violet-600 text-white px-6 py-2.5 rounded-xl hover:bg-violet-700 transition-colors">
                    <DollarSign size={14} className="inline mr-1" />정산 계산
                  </button>
                </div>
              )}
            </>
          )}

          {/* ── 성과 탭 ── */}
          {tab === "performance" && (
            <div className="grid grid-cols-2 gap-3">
              <MiniCard label="총 판매" value={`${totalQty}개`} />
              <MiniCard label="총 매출" value={formatPrice(totalRev)} />
              <MiniCard label="배정 대비 판매율" value={(() => {
                const totalAlloc = products.reduce((s, p) => s + p.allocated_stock, 0);
                return totalAlloc > 0 ? `${Math.round((totalQty / totalAlloc) * 100)}%` : "-";
              })()} />
              <MiniCard label="순이익" value={settlement ? formatPrice(settlement.net_profit) : "-"} />
              <MiniCard label="수수료" value={settlement ? formatPrice(settlement.commission_amount) : "-"} />
              <MiniCard label="ROI" value={settlement && settlement.product_cost > 0 ? `${Math.round((settlement.net_profit / settlement.product_cost) * 100)}%` : "-"} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

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
