"use client";

import { useState, useEffect } from "react";
import { X, Save, User, Hash, Users, TrendingUp, Tag, StickyNote, Star } from "lucide-react";
import { addInfluencer, PLATFORM_CONFIG, type Platform, type Priority } from "@/lib/influencerStorage";

interface Props {
  onSave: () => void;
  onClose: () => void;
}

const CATEGORY_PRESETS = ["패션", "라이프스타일", "뷰티", "여행", "음식", "운동/헬스", "럭셔리", "비즈니스"];

export default function AddInfluencerModal({ onSave, onClose }: Props) {
  const [platform, setPlatform]       = useState<Platform>("instagram");
  const [handle, setHandle]           = useState("");
  const [name, setName]               = useState("");
  const [profileImage, setProfileImage] = useState("");
  const [followers, setFollowers]     = useState("");
  const [engRate, setEngRate]         = useState("");
  const [categories, setCategories]   = useState<string[]>([]);
  const [priority, setPriority]       = useState<Priority>("medium");
  const [notes, setNotes]             = useState("");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const toggleCategory = (cat: string) => {
    setCategories((prev) => prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]);
  };

  const handleSave = () => {
    if (!handle.trim() || !name.trim()) return;
    addInfluencer({
      platform,
      handle: handle.trim().replace(/^@/, ""),
      name: name.trim(),
      profileImage: profileImage.trim(),
      followers: parseInt(followers.replace(/,/g, "")) || 0,
      engagementRate: parseFloat(engRate) || 0,
      categories,
      priority,
      notes: notes.trim(),
      status: "discovered",
    });
    onSave();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col">

        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-pink-100 dark:bg-pink-950/50 rounded-lg flex items-center justify-center">
              <Users size={16} className="text-pink-600" />
            </div>
            <h3 className="text-base font-bold text-zinc-800 dark:text-zinc-100">인플루언서 추가</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* 폼 */}
        <div className="p-6 space-y-5 overflow-y-auto">

          {/* 플랫폼 */}
          <div>
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2 block">플랫폼</label>
            <div className="flex gap-2">
              {(Object.keys(PLATFORM_CONFIG) as Platform[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPlatform(p)}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-all ${
                    platform === p
                      ? "bg-violet-600 text-white border-violet-600"
                      : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300"
                  }`}
                >
                  {PLATFORM_CONFIG[p].label}
                </button>
              ))}
            </div>
          </div>

          {/* 핸들 + 이름 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                <Hash size={14} />
                @핸들 <span className="text-red-500">*</span>
              </label>
              <input
                type="text" value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="username"
                className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                <User size={14} />
                이름/닉네임 <span className="text-red-500">*</span>
              </label>
              <input
                type="text" value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="홍길동"
                className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
          </div>

          {/* 팔로워 + 참여율 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                <Users size={14} />
                팔로워 수
              </label>
              <input
                type="text" value={followers}
                onChange={(e) => setFollowers(e.target.value)}
                placeholder="50000"
                className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                <TrendingUp size={14} />
                참여율 (%)
              </label>
              <input
                type="number" min="0" max="100" step="0.1" value={engRate}
                onChange={(e) => setEngRate(e.target.value)}
                placeholder="3.5"
                className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
          </div>

          {/* 카테고리 */}
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              <Tag size={14} />
              카테고리
            </label>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_PRESETS.map((cat) => (
                <button
                  key={cat}
                  onClick={() => toggleCategory(cat)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    categories.includes(cat)
                      ? "bg-violet-600 text-white border-violet-600"
                      : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* 우선순위 */}
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              <Star size={14} />
              우선순위
            </label>
            <div className="flex gap-2">
              {([["high", "높음", "bg-red-500"], ["medium", "보통", "bg-amber-400"], ["low", "낮음", "bg-zinc-400"]] as const).map(([val, label, dotColor]) => (
                <button
                  key={val}
                  onClick={() => setPriority(val)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-medium border transition-all ${
                    priority === val
                      ? "bg-violet-600 text-white border-violet-600"
                      : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300"
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${priority === val ? "bg-white" : dotColor}`} />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* 프로필 이미지 URL */}
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              프로필 이미지 URL <span className="text-xs font-normal text-zinc-400">(선택)</span>
            </label>
            <input
              type="url" value={profileImage}
              onChange={(e) => setProfileImage(e.target.value)}
              placeholder="https://..."
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          {/* 메모 */}
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              <StickyNote size={14} />
              메모
            </label>
            <textarea
              value={notes} rows={2}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="협업 방향, 특이사항 등..."
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>
        </div>

        {/* 버튼 */}
        <div className="flex gap-3 px-6 py-4 border-t border-zinc-100 dark:border-zinc-800 shrink-0">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={!handle.trim() || !name.trim()}
            className="flex-1 flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-3 text-sm transition-colors"
          >
            <Save size={15} />
            추가하기
          </button>
        </div>
      </div>
    </div>
  );
}
