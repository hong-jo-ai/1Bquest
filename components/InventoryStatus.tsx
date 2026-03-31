"use client";

import { inventory } from "@/lib/dummyData";
import { AlertTriangle, XCircle, CheckCircle, AlertCircle } from "lucide-react";

const statusConfig = {
  soldout: {
    label: "품절",
    icon: XCircle,
    rowClass: "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800",
    badgeClass: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
    iconClass: "text-red-500",
    barClass: "bg-red-400",
  },
  critical: {
    label: "품절임박",
    icon: AlertTriangle,
    rowClass: "bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800",
    badgeClass: "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300",
    iconClass: "text-orange-500",
    barClass: "bg-orange-400",
  },
  warning: {
    label: "재고부족",
    icon: AlertCircle,
    rowClass: "bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800",
    badgeClass: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300",
    iconClass: "text-yellow-500",
    barClass: "bg-yellow-400",
  },
  ok: {
    label: "정상",
    icon: CheckCircle,
    rowClass: "border-transparent",
    badgeClass: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300",
    iconClass: "text-emerald-500",
    barClass: "bg-emerald-400",
  },
};

export default function InventoryStatus() {
  const sorted = [...inventory].sort((a, b) => {
    const order = { soldout: 0, critical: 1, warning: 2, ok: 3 };
    return order[a.status as keyof typeof order] - order[b.status as keyof typeof order];
  });

  const critical = inventory.filter((i) => i.status === "soldout" || i.status === "critical").length;
  const warning = inventory.filter((i) => i.status === "warning").length;

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-zinc-100 dark:border-zinc-800 p-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-100">재고 현황</h2>
        <div className="flex gap-2">
          {critical > 0 && (
            <span className="text-xs font-medium bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300 px-2.5 py-1 rounded-full">
              긴급 {critical}개
            </span>
          )}
          {warning > 0 && (
            <span className="text-xs font-medium bg-yellow-100 text-yellow-600 dark:bg-yellow-900/40 dark:text-yellow-300 px-2.5 py-1 rounded-full">
              주의 {warning}개
            </span>
          )}
        </div>
      </div>
      <p className="text-xs text-zinc-400 mb-4">임계값 이하 항목은 상단에 강조 표시됩니다</p>

      <div className="space-y-2">
        {sorted.map((item) => {
          const cfg = statusConfig[item.status as keyof typeof statusConfig];
          const Icon = cfg.icon;
          const pct = item.stock === 0 ? 0 : Math.min((item.stock / (item.threshold * 3)) * 100, 100);

          return (
            <div
              key={item.sku}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${cfg.rowClass} transition-all`}
            >
              <Icon size={16} className={cfg.iconClass} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200 truncate pr-2">
                    {item.name}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-bold text-zinc-700 dark:text-zinc-200">
                      {item.stock}개
                    </span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.badgeClass}`}>
                      {cfg.label}
                    </span>
                  </div>
                </div>
                <div className="h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${cfg.barClass} rounded-full transition-all duration-500`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-xs text-zinc-400 mt-0.5">임계값: {item.threshold}개 · SKU: {item.sku}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
