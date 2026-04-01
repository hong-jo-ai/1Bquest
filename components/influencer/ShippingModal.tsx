"use client";

import { useState, useEffect } from "react";
import { X, Save, Download, MapPin, Phone, User, Package, Hash, FileText } from "lucide-react";
import { updateInfluencer } from "@/lib/influencerStorage";
import { generateSingleShippingCSV, downloadCSV } from "@/lib/shippingExport";
import type { Influencer, ShippingInfo } from "@/lib/influencerStorage";

interface Props {
  influencer: Influencer;
  onUpdate: () => void;
  onClose: () => void;
}

export default function ShippingModal({ influencer, onUpdate, onClose }: Props) {
  const existing = influencer.shippingInfo;
  const [recipientName, setRecipientName] = useState(existing?.recipientName ?? influencer.name);
  const [phone, setPhone]                 = useState(existing?.phone ?? "");
  const [address, setAddress]             = useState(existing?.address ?? "");
  const [addressDetail, setAddressDetail] = useState(existing?.addressDetail ?? "");
  const [postalCode, setPostalCode]       = useState(existing?.postalCode ?? "");
  const [productName, setProductName]     = useState(existing?.productName ?? "PAULVICE 시계");
  const [quantity, setQuantity]           = useState(existing?.quantity ?? 1);
  const [memo, setMemo]                   = useState(existing?.memo ?? "");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const isValid = recipientName && phone && address && postalCode && productName;

  const buildShippingInfo = (): ShippingInfo => ({
    recipientName, phone, address, addressDetail, postalCode, productName, quantity, memo,
  });

  const handleSave = () => {
    updateInfluencer(influencer.id, { shippingInfo: buildShippingInfo(), status: "confirmed" });
    onUpdate();
    onClose();
  };

  const handleDownload = () => {
    const shippingInfo = buildShippingInfo();
    const tempInf: Influencer = { ...influencer, shippingInfo, status: "confirmed" };
    const csv = generateSingleShippingCSV(tempInf);
    const filename = `우체국택배_${recipientName}_${new Date().toLocaleDateString("ko-KR").replace(/\./g, "").replace(/ /g, "")}.csv`;
    downloadCSV(csv, filename);
  };

  const handleSaveAndDownload = () => {
    handleSave();
    setTimeout(handleDownload, 100);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col">

        {/* 헤더 */}
        <div className="px-6 py-5 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-teal-100 dark:bg-teal-950/50 rounded-lg flex items-center justify-center">
                <Package size={16} className="text-teal-600" />
              </div>
              <h3 className="text-base font-bold text-zinc-800 dark:text-zinc-100">배송 정보 입력</h3>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 transition-colors">
              <X size={18} />
            </button>
          </div>
          <p className="text-xs text-zinc-400 ml-10">@{influencer.handle} · {influencer.name}</p>
        </div>

        {/* 폼 */}
        <div className="p-6 space-y-4 overflow-y-auto">

          {/* 받는분 성함 */}
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              <User size={14} />
              받는분 성함 <span className="text-red-500">*</span>
            </label>
            <input type="text" value={recipientName} onChange={(e) => setRecipientName(e.target.value)}
              placeholder="홍길동"
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          {/* 전화번호 */}
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              <Phone size={14} />
              연락처 <span className="text-red-500">*</span>
            </label>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
              placeholder="010-0000-0000"
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          {/* 우편번호 */}
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              <Hash size={14} />
              우편번호 <span className="text-red-500">*</span>
            </label>
            <input type="text" value={postalCode} onChange={(e) => setPostalCode(e.target.value)}
              placeholder="12345"
              maxLength={5}
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          {/* 주소 */}
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              <MapPin size={14} />
              주소 <span className="text-red-500">*</span>
            </label>
            <input type="text" value={address} onChange={(e) => setAddress(e.target.value)}
              placeholder="서울특별시 강남구 테헤란로 123"
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          {/* 상세주소 */}
          <div>
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2 block">상세주소</label>
            <input type="text" value={addressDetail} onChange={(e) => setAddressDetail(e.target.value)}
              placeholder="101동 202호"
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          {/* 제품명 + 수량 */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                <Package size={14} />
                제품명 <span className="text-red-500">*</span>
              </label>
              <input type="text" value={productName} onChange={(e) => setProductName(e.target.value)}
                placeholder="PAULVICE 시계"
                className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2 block">수량</label>
              <input type="number" min="1" value={quantity} onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
          </div>

          {/* 배달 메시지 */}
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              <FileText size={14} />
              배달 메시지 <span className="text-xs font-normal text-zinc-400">(선택)</span>
            </label>
            <input type="text" value={memo} onChange={(e) => setMemo(e.target.value)}
              placeholder="문 앞에 놔주세요"
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          {/* 미리보기 */}
          {isValid && (
            <div className="bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800 rounded-xl p-4 text-xs text-teal-700 dark:text-teal-300 space-y-1">
              <p className="font-semibold text-teal-800 dark:text-teal-200 mb-2">📦 발송 미리보기</p>
              <p>받는분: {recipientName} ({phone})</p>
              <p>주소: ({postalCode}) {address} {addressDetail}</p>
              <p>제품: {productName} × {quantity}개</p>
              {memo && <p>메시지: {memo}</p>}
            </div>
          )}
        </div>

        {/* 버튼 */}
        <div className="flex gap-2 px-6 py-4 border-t border-zinc-100 dark:border-zinc-800 shrink-0">
          <button onClick={handleSave} disabled={!isValid}
            className="flex-1 flex items-center justify-center gap-1.5 bg-zinc-800 dark:bg-zinc-700 hover:bg-zinc-700 dark:hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-3 text-sm transition-colors"
          >
            <Save size={14} />
            저장
          </button>
          <button onClick={handleSaveAndDownload} disabled={!isValid}
            className="flex-1 flex items-center justify-center gap-1.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-3 text-sm transition-colors"
          >
            <Download size={14} />
            저장 + CSV 다운로드
          </button>
        </div>
      </div>
    </div>
  );
}
