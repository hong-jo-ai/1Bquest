"use client";

import { useState, useCallback } from "react";
import {
  Upload,
  ImagePlus,
  Sparkles,
  Loader2,
  X,
  Download,
  ChevronRight,
  Camera,
  Palette,
  Check,
} from "lucide-react";

interface StyleGuide {
  brand_mood: string;
  color_tone: string;
  lighting: string;
  composition: string;
  model_pose: string;
  background: string;
  styling: string;
  overall_aesthetic: string;
  prompt_template: string;
}

interface GeneratedImage {
  image: string;
  description: string;
}

type Step = "reference" | "style" | "product" | "result";

const MAX_SIZE = 768;
const QUALITY = 0.6;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      const ratio = Math.min(MAX_SIZE / width, MAX_SIZE / height, 1);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", QUALITY);
      resolve(dataUrl.split(",")[1]);
    };
    img.src = URL.createObjectURL(file);
  });
}

export default function ImageMakerPage() {
  const [step, setStep] = useState<Step>("reference");
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [referencePreviews, setReferencePreviews] = useState<string[]>([]);
  const [styleGuide, setStyleGuide] = useState<StyleGuide | null>(null);
  const [productBase64, setProductBase64] = useState<string | null>(null);
  const [productPreview, setProductPreview] = useState<string | null>(null);
  const [productDescription, setProductDescription] = useState("");
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleReferenceUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      const base64s = await Promise.all(files.map(fileToBase64));
      setReferenceImages((prev) => [...prev, ...base64s]);
      setReferencePreviews((prev) => [
        ...prev,
        ...base64s.map((b) => `data:image/jpeg;base64,${b}`),
      ]);
    },
    []
  );

  const removeReference = (index: number) => {
    setReferenceImages((prev) => prev.filter((_, i) => i !== index));
    setReferencePreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const analyzeStyle = async () => {
    if (referenceImages.length === 0) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/imagemaker/analyze-style", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: referenceImages }),
      });

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`서버 오류: ${text.slice(0, 100)}`);
      }
      if (!res.ok) throw new Error(data.error);

      setStyleGuide(data.styleGuide);
      setStep("style");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "스타일 분석에 실패했습니다."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleProductUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const b64 = await fileToBase64(file);
    setProductBase64(b64);
    setProductPreview(`data:image/jpeg;base64,${b64}`);
  };

  const generateImages = async () => {
    if (!productBase64 || !styleGuide) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/imagemaker/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productImage: productBase64,
          styleGuide,
          productDescription,
        }),
      });

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`서버 오류: ${text.slice(0, 100)}`);
      }
      if (!res.ok) throw new Error(data.error);

      setGeneratedImages(data.images);
      setStep("result");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "이미지 생성에 실패했습니다."
      );
    } finally {
      setLoading(false);
    }
  };

  const downloadImage = (base64: string, index: number) => {
    const link = document.createElement("a");
    link.href = `data:image/png;base64,${base64}`;
    link.download = `paulvice-lookbook-${index + 1}.png`;
    link.click();
  };

  const reset = () => {
    setStep("reference");
    setReferenceImages([]);
    setReferencePreviews([]);
    setStyleGuide(null);
    setProductBase64(null);
    setProductPreview(null);
    setProductDescription("");
    setGeneratedImages([]);
    setError(null);
  };

  const STEPS: { key: Step; label: string; icon: React.ElementType }[] = [
    { key: "reference", label: "레퍼런스", icon: Camera },
    { key: "style", label: "스타일 분석", icon: Palette },
    { key: "product", label: "제품 업로드", icon: Upload },
    { key: "result", label: "결과", icon: Sparkles },
  ];

  const stepIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            화보 메이커
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            브랜드 톤에 맞는 착용컷을 AI로 생성합니다
          </p>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center gap-2 mb-8">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const isActive = i === stepIndex;
            const isDone = i < stepIndex;
            return (
              <div key={s.key} className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (isDone) setStep(s.key);
                  }}
                  disabled={!isDone && !isActive}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    isActive
                      ? "bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300"
                      : isDone
                        ? "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 cursor-pointer hover:bg-emerald-200 dark:hover:bg-emerald-500/30"
                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400"
                  }`}
                >
                  {isDone ? (
                    <Check size={14} />
                  ) : (
                    <Icon size={14} />
                  )}
                  {s.label}
                </button>
                {i < STEPS.length - 1 && (
                  <ChevronRight
                    size={14}
                    className="text-zinc-300 dark:text-zinc-600"
                  />
                )}
              </div>
            );
          })}
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {/* Step 1: Reference Upload */}
        {step === "reference" && (
          <div className="space-y-6">
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
                레퍼런스 이미지 업로드
              </h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
                원하는 톤의 화보 이미지를 업로드하세요. 구도, 포즈, 조명, 색감
                등을 분석하여 브랜드 스타일 가이드라인을 만듭니다.
              </p>

              <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-xl cursor-pointer hover:border-violet-400 dark:hover:border-violet-500 hover:bg-violet-50/50 dark:hover:bg-violet-500/5 transition-colors">
                <ImagePlus
                  size={32}
                  className="text-zinc-400 dark:text-zinc-500 mb-2"
                />
                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                  클릭하여 이미지를 선택하세요
                </span>
                <span className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
                  JPG, PNG, WebP (여러 장 선택 가능)
                </span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleReferenceUpload}
                />
              </label>

              {referencePreviews.length > 0 && (
                <div className="mt-6">
                  <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-3">
                    업로드된 이미지 ({referencePreviews.length}장)
                  </p>
                  <div className="grid grid-cols-4 gap-3">
                    {referencePreviews.map((src, i) => (
                      <div key={i} className="relative group aspect-[3/4]">
                        <img
                          src={src}
                          alt={`Reference ${i + 1}`}
                          className="w-full h-full object-cover rounded-lg"
                        />
                        <button
                          onClick={() => removeReference(i)}
                          className="absolute top-1.5 right-1.5 p-1 bg-black/60 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={analyzeStyle}
              disabled={referenceImages.length === 0 || loading}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-violet-600 hover:bg-violet-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white rounded-xl font-medium transition-colors disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  스타일 분석 중...
                </>
              ) : (
                <>
                  <Sparkles size={18} />
                  스타일 분석하기
                </>
              )}
            </button>
          </div>
        )}

        {/* Step 2: Style Guide Review */}
        {step === "style" && styleGuide && (
          <div className="space-y-6">
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
                브랜드 스타일 가이드라인
              </h2>

              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: "브랜드 무드", value: styleGuide.brand_mood },
                  { label: "색감/톤", value: styleGuide.color_tone },
                  { label: "조명", value: styleGuide.lighting },
                  { label: "구도", value: styleGuide.composition },
                  { label: "모델 포즈", value: styleGuide.model_pose },
                  { label: "배경", value: styleGuide.background },
                  { label: "스타일링", value: styleGuide.styling },
                ].map(({ label, value }) => (
                  <div
                    key={label}
                    className="p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl"
                  >
                    <p className="text-xs font-medium text-violet-600 dark:text-violet-400 mb-1">
                      {label}
                    </p>
                    <p className="text-sm text-zinc-700 dark:text-zinc-300">
                      {value}
                    </p>
                  </div>
                ))}
                <div className="col-span-2 p-4 bg-violet-50 dark:bg-violet-500/10 rounded-xl">
                  <p className="text-xs font-medium text-violet-600 dark:text-violet-400 mb-1">
                    종합 미학
                  </p>
                  <p className="text-sm text-zinc-700 dark:text-zinc-300">
                    {styleGuide.overall_aesthetic}
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={() => setStep("product")}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-violet-600 hover:bg-violet-700 text-white rounded-xl font-medium transition-colors"
            >
              <ChevronRight size={18} />
              제품 사진 업로드하기
            </button>
          </div>
        )}

        {/* Step 3: Product Upload */}
        {step === "product" && (
          <div className="space-y-6">
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
                제품 사진 업로드
              </h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
                착용컷을 만들고 싶은 제품의 사진을 업로드하세요.
              </p>

              {!productPreview ? (
                <label className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-xl cursor-pointer hover:border-violet-400 dark:hover:border-violet-500 hover:bg-violet-50/50 dark:hover:bg-violet-500/5 transition-colors">
                  <Upload
                    size={32}
                    className="text-zinc-400 dark:text-zinc-500 mb-2"
                  />
                  <span className="text-sm text-zinc-500 dark:text-zinc-400">
                    제품 사진을 업로드하세요
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleProductUpload}
                  />
                </label>
              ) : (
                <div className="flex gap-6">
                  <div className="relative w-64 aspect-[3/4] flex-shrink-0">
                    <img
                      src={productPreview}
                      alt="Product"
                      className="w-full h-full object-cover rounded-xl"
                    />
                    <button
                      onClick={() => {
                        setProductBase64(null);
                        setProductPreview(null);
                      }}
                      className="absolute top-2 right-2 p-1.5 bg-black/60 rounded-full text-white hover:bg-black/80 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                      제품 설명 (선택)
                    </label>
                    <textarea
                      value={productDescription}
                      onChange={(e) => setProductDescription(e.target.value)}
                      placeholder="예: 블랙 레더 크로노그래프 시계, 42mm 케이스, 스테인리스 스틸 밴드"
                      rows={4}
                      className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 resize-none focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500"
                    />
                    <p className="text-xs text-zinc-400 mt-2">
                      제품에 대한 설명을 추가하면 더 정확한 착용컷을 생성할 수
                      있습니다.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={generateImages}
              disabled={!productBase64 || loading}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-violet-600 hover:bg-violet-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white rounded-xl font-medium transition-colors disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  착용컷 생성 중... (약 30초~1분 소요)
                </>
              ) : (
                <>
                  <Sparkles size={18} />
                  착용컷 3장 생성하기
                </>
              )}
            </button>
          </div>
        )}

        {/* Step 4: Results */}
        {step === "result" && (
          <div className="space-y-6">
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  생성된 착용컷
                </h2>
                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                  {generatedImages.length}장
                </span>
              </div>

              <div className="grid grid-cols-3 gap-4">
                {generatedImages.map((img, i) => (
                  <div key={i} className="space-y-2">
                    <div className="relative group aspect-[3/4] bg-zinc-100 dark:bg-zinc-800 rounded-xl overflow-hidden">
                      <img
                        src={`data:image/png;base64,${img.image}`}
                        alt={`Generated ${i + 1}`}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                        <button
                          onClick={() => downloadImage(img.image, i)}
                          className="p-2 bg-white/90 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white"
                        >
                          <Download
                            size={18}
                            className="text-zinc-800"
                          />
                        </button>
                      </div>
                    </div>
                    {img.description && (
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2">
                        {img.description}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setStep("product");
                  setProductBase64(null);
                  setProductPreview(null);
                  setProductDescription("");
                  setGeneratedImages([]);
                }}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-xl font-medium transition-colors"
              >
                <Upload size={18} />
                다른 제품으로 생성
              </button>
              <button
                onClick={reset}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-xl font-medium transition-colors"
              >
                <Camera size={18} />
                처음부터 다시
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
