"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import styles from "./moon.module.css";

const SYNODIC_MONTH = 29.530588853;
const NEW_MOON_EPOCH = Date.UTC(2000, 0, 6, 18, 14);

type MoonData = {
  age: number;
  phase: number;
  illumination: number;
  label: string;
  fact: string;
  phaseKey: PhaseKey;
};

type PhaseKey = "new" | "crescent" | "half" | "waxing" | "full" | "waning" | "lastHalf" | "balsamic";
type Occasion = "birth" | "love" | "promise" | "departure" | "farewell" | "unsaid";

const OCCASIONS: Array<{ value: Occasion; label: string }> = [
  { value: "birth", label: "누군가 태어난 밤" },
  { value: "love", label: "사랑을 시작한 밤" },
  { value: "promise", label: "약속을 나눈 밤" },
  { value: "departure", label: "새로운 길을 떠난 밤" },
  { value: "farewell", label: "누군가와 헤어진 밤" },
  { value: "unsaid", label: "말로 정하기 어려운 밤" },
];

const PHASE_STORIES: Record<PhaseKey, string> = {
  new: "달은 보이지 않았지만, 사라진 것은 아니었습니다. 빛이 닿지 않는 자리에서 다음 모습을 준비하고 있었습니다.",
  crescent: "하늘에는 아주 가느다란 빛만 남아 있었습니다. 모든 길을 밝히지는 못해도, 시작의 방향을 보여주기에는 충분한 빛이었습니다.",
  half: "달의 절반은 빛났고 절반은 어둠 속에 있었습니다. 서로 다른 두 마음이 한 몸 안에 머물던, 선택과 변화의 시간이었습니다.",
  waxing: "아직 완전히 둥글지는 않았지만 달은 매일 조금씩 빛을 더해가고 있었습니다. 완성보다 가능성에 가까운 밤이었습니다.",
  full: "달은 가장 많은 빛을 품고 있었습니다. 오래 기다린 것이 잠시 온전한 모습을 드러내고, 서로의 얼굴을 알아볼 수 있었던 밤이었습니다.",
  waning: "달빛은 천천히 작아지고 있었습니다. 하지만 작아지는 것은 사라지는 일이 아니라, 충분히 빛난 시간을 자기 안에 거두는 일이었습니다.",
  lastHalf: "달은 다시 빛과 어둠을 반씩 나누고 있었습니다. 지나온 시간을 돌아보고, 무엇을 남길지 고르는 고요한 순간이었습니다.",
  balsamic: "달은 거의 보이지 않는 쪽으로 기울고 있었습니다. 끝처럼 보이는 어둠 속에서 다음 시작을 위한 자리를 비우고 있었습니다.",
};

const OCCASION_STORIES: Record<Occasion, string> = {
  birth: "한 사람의 시간도 처음부터 완성된 모습으로 오지 않습니다. 그날 시작된 생은 자기만의 빛을 천천히 만들어가기 시작했습니다.",
  love: "두 마음이 같은 하늘 아래 머물기로 한 순간은 달력의 하루보다 오래갑니다. 그날의 빛은 이후의 수많은 밤 속에도 조용히 남아 있습니다.",
  promise: "약속은 말한 순간 완성되는 것이 아니라, 그다음의 시간 속에서 조금씩 모양을 얻습니다. 그날은 함께 지켜갈 시간이 처음 생긴 밤이었습니다.",
  departure: "떠난다는 것은 모든 길을 이미 알고 있다는 뜻이 아닙니다. 보이는 만큼만 걸어도 새로운 풍경은 천천히 모습을 드러냅니다.",
  farewell: "이별은 함께한 시간을 지우지 못합니다. 달이 보이지 않는 동안에도 그 자리에 있듯, 남겨진 기억은 다른 모양으로 곁에 머뭅니다.",
  unsaid: "어떤 밤은 하나의 이름으로 정리되지 않습니다. 기쁨과 슬픔, 시작과 끝이 함께 있었기에 오히려 더 오래 기억되기도 합니다.",
};

const PHASE_MESSAGES: Record<PhaseKey, string> = {
  new: "보이지 않는 동안에도, 시작은 이미 진행되고 있습니다.",
  crescent: "다음 한 걸음을 비출 만큼의 빛이면 충분합니다.",
  half: "빛과 어둠이 함께 있다는 것은, 어느 쪽도 끝이 아니라는 뜻입니다.",
  waxing: "아직 다 차오르지 않았다는 것은, 앞으로 더 밝아질 시간이 남았다는 뜻입니다.",
  full: "충분히 빛난 순간은 지나간 뒤에도 당신 안에서 사라지지 않습니다.",
  waning: "내려놓는 것은 잃는 일이 아니라, 소중했던 것을 자기 안에 남기는 일입니다.",
  lastHalf: "지나온 시간을 돌아보는 일도 앞으로 나아가는 한 가지 방법입니다.",
  balsamic: "잠시 어두워지는 시간도 다음 시작을 준비하는 빛의 일부입니다.",
};

function OfficialLogo({ className = "", tone = "black" }: { className?: string; tone?: "black" | "white" }) {
  const src = tone === "white" ? "/harriot-logo-horizontal-white.png" : "/harriot-logo-horizontal-black.png";
  return <img className={className} src={src} alt="harriot" />;
}

function getMoonData(dateString: string): MoonData {
  const [year, month, day] = dateString.split("-").map(Number);
  const nightInKorea = Date.UTC(year, month - 1, day, 12);
  const days = (nightInKorea - NEW_MOON_EPOCH) / 86_400_000;
  const age = ((days % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH;
  const phase = age / SYNODIC_MONTH;
  const illumination = (1 - Math.cos(phase * Math.PI * 2)) / 2;

  let label = "차오르는 달";
  let phaseKey: PhaseKey = "waxing";
  if (age < 1.3 || age > 28.3) { label = "새달"; phaseKey = "new"; }
  else if (age < 6.4) { label = "가느다란 초승달"; phaseKey = "crescent"; }
  else if (age < 8.8) { label = "반달"; phaseKey = "half"; }
  else if (age < 13.5) { label = "보름을 향하는 달"; phaseKey = "waxing"; }
  else if (age < 16.1) { label = "보름달"; phaseKey = "full"; }
  else if (age < 21.0) { label = "천천히 기우는 달"; phaseKey = "waning"; }
  else if (age < 23.4) { label = "기우는 반달"; phaseKey = "lastHalf"; }
  else { label = "새달을 향하는 달"; phaseKey = "balsamic"; }

  const toFull = Math.max(0, Math.round(SYNODIC_MONTH / 2 - age));
  const sinceFull = Math.max(0, Math.round(age - SYNODIC_MONTH / 2));
  const toNew = Math.max(1, Math.round(SYNODIC_MONTH - age));
  let fact = `달빛은 약 ${Math.round(illumination * 100)}% 차 있었습니다.`;
  if (age < 13.5) fact = `${toFull || 1}일 뒤면 보름이 되는, 아직 차오르는 중인 달이었습니다.`;
  else if (age <= 16.1) fact = "달이 가장 둥근 때에 아주 가까운 밤이었습니다.";
  else if (age < 23.4) fact = `보름을 지난 지 ${sinceFull || 1}일, 달빛이 천천히 작아지던 밤이었습니다.`;
  else fact = `${toNew}일 뒤면 다시 보이지 않게 되는, 가만히 기우는 달이었습니다.`;

  return { age, phase, illumination, label, fact, phaseKey };
}

function formatKoreanDate(dateString: string) {
  const [year, month, day] = dateString.split("-").map(Number);
  return `${year}년 ${month}월 ${day}일 밤`;
}

function MoonCanvas({ phase, label }: { phase: number; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const size = 520;
    const context = canvas.getContext("2d");
    if (!context) return;
    let cancelled = false;
    const packageMoon = new Image();
    packageMoon.src = "/seolwol-package-moon.png";
    packageMoon.onload = () => {
      if (cancelled) return;
      const sourceCanvas = document.createElement("canvas");
      sourceCanvas.width = size;
      sourceCanvas.height = size;
      const sourceContext = sourceCanvas.getContext("2d");
      if (!sourceContext) return;
      sourceContext.drawImage(packageMoon, 0, 0, size, size);
      const source = sourceContext.getImageData(0, 0, size, size).data;
      const output = context.createImageData(size, size);
      const center = size / 2;
      const radius = size * 0.43;
      const angle = phase * Math.PI * 2;
      const sunX = Math.sin(angle);
      const sunZ = -Math.cos(angle);

      for (let py = 0; py < size; py += 1) {
        for (let px = 0; px < size; px += 1) {
          const x = (px - center) / radius;
          const y = (py - center) / radius;
          const rr = x * x + y * y;
          if (rr > 1) continue;
          const z = Math.sqrt(1 - rr);
          const light = x * sunX + z * sunZ;
          const edge = Math.min(1, z * 5);
          const idx = (py * size + px) * 4;
          const sourceGray = source[idx] * 0.3 + source[idx + 1] * 0.59 + source[idx + 2] * 0.11;
          const engravedTexture = 178 + (sourceGray - 210) * 1.28;
          const lit = engravedTexture + Math.max(0, light) * 38;
          const shaded = 20 + Math.max(0, light + 0.06) * 30;
          const value = Math.max(0, Math.min(255, (light > 0 ? lit : shaded) * edge));
          output.data[idx] = value;
          output.data[idx + 1] = value + 4;
          output.data[idx + 2] = value + 8;
          output.data[idx + 3] = Math.round(255 * Math.min(1, edge + 0.18));
        }
      }
      context.clearRect(0, 0, size, size);
      context.putImageData(output, 0, 0);
    };
    return () => { cancelled = true; };
  }, [phase]);

  return <canvas ref={canvasRef} className={styles.moon} width="520" height="520" aria-label={label} />;
}

export default function MoonExperience() {
  const [date, setDate] = useState("");
  const [occasion, setOccasion] = useState<Occasion | "">("");
  const [memory, setMemory] = useState("");
  const [result, setResult] = useState<{ date: string; occasion: Occasion; memory: string } | null>(null);
  const resultRef = useRef<HTMLElement>(null);
  const moonData = useMemo(() => (result ? getMoonData(result.date) : null), [result]);
  const occasionLabel = useMemo(() => result ? OCCASIONS.find((item) => item.value === result.occasion)?.label : "", [result]);

  function revealMoon(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!date || !occasion) return;
    setResult({ date, occasion, memory: memory.trim() });
    window.setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 90);
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <a href="#begin" className={styles.brand} aria-label="HARRIOT 홈">
          <OfficialLogo className={styles.headerLogo} tone="white" />
        </a>
        <span className={styles.issue}>A record of the night</span>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>그날의 달 · The moon of your night</p>
          <h1>어떤 밤은 지나가도,<br /><em>사라지지는 않습니다.</em></h1>
          <p className={styles.lead}>오래 남아 있는 날짜를 알려주세요.<br />해리엇이 그날 밤의 달을 찾아 한 장의 기록으로 남겨드립니다.</p>
          <a className={styles.beginLink} href="#begin">그 밤을 꺼내보기 <span>↓</span></a>
        </div>
        <div className={styles.object} aria-hidden="true">
          <div className={styles.paperBack}><OfficialLogo className={styles.paperLogo} /><b>雪月</b></div>
          <div className={styles.paperMoon}></div>
          <div className={styles.vellum}>
            <p>기억은 아주 천천히<br />모양을 드러냅니다.</p>
            <small>THE MOON OF YOUR NIGHT</small>
          </div>
        </div>
        <p className={styles.verticalText}>시간이 지워서는 안 되는 것</p>
      </section>

      <section id="begin" className={styles.formSection}>
        <div className={styles.formIntro}>
          <p className={styles.step}>01 · 기억을 꺼내는 일</p>
          <h2>오래 남아 있는 밤이<br />있으신가요?</h2>
          <p>기억하고 싶은 날짜 하나면 충분합니다.<br />어떤 정보도 남겨두지 않습니다.</p>
        </div>
        <form className={styles.form} onSubmit={revealMoon}>
          <label htmlFor="moon-date">그날은 언제였나요?</label>
          <input id="moon-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} max="2099-12-31" required />
          <fieldset className={styles.occasionFieldset}>
            <legend>그날은 어떤 밤이었나요? <span>필수</span></legend>
            <div className={styles.occasionGrid}>
              {OCCASIONS.map((item) => (
                <label className={styles.occasionChoice} key={item.value}>
                  <input
                    type="radio"
                    name="occasion"
                    value={item.value}
                    checked={occasion === item.value}
                    onChange={() => setOccasion(item.value)}
                    required
                  />
                  <span aria-hidden="true"></span>
                  {item.label}
                </label>
              ))}
            </div>
            <p>이 선택은 달의 사실을 바꾸지 않습니다. 이야기를 당신의 밤에 조금 더 가까이 가져옵니다.</p>
          </fieldset>
          <label htmlFor="moon-memory">그날을 한 문장으로 남긴다면 <span>선택</span></label>
          <input id="moon-memory" type="text" value={memory} onChange={(e) => setMemory(e.target.value)} maxLength={44} placeholder="예: 네가 태어난 밤" />
          <button type="submit" disabled={!date || !occasion}>그날의 달을 만나기 <span>↗</span></button>
          <p className={styles.privacy}>로그인도, 이메일도 필요하지 않습니다.</p>
        </form>
      </section>

      {result && moonData && (
        <section ref={resultRef} className={styles.resultSection}>
          <div className={styles.resultHeading}>
            <p className={styles.step}>02 · 그날의 기록</p>
            <p>반투명 종이를 천천히 걷어보세요.</p>
          </div>
          <article className={styles.card}>
            <div className={styles.cardSky}>
              <div className={styles.moonHalo}></div>
              <MoonCanvas phase={moonData.phase} label={moonData.label} />
              <div className={styles.eaves}><span></span></div>
            </div>
            <div className={styles.cardText}>
              <p className={styles.cardDate}>{formatKoreanDate(result.date)} · {occasionLabel}</p>
              <h2>{moonData.label}</h2>
              <p className={styles.fact}>{moonData.fact}</p>
              {result.memory && <blockquote>“{result.memory}”</blockquote>}
              <div className={styles.cardSeal}>
                <span>THE MOON OF YOUR NIGHT</span>
                <OfficialLogo className={styles.cardLogo} />
              </div>
            </div>
            <button type="button" className={styles.peel} aria-label="트레이싱지 걷기">
              <span>기억을 덮은 종이</span>
              <small>위로 밀어 걷어보세요</small>
            </button>
          </article>
          <section className={styles.reading} aria-label="그날의 달 이야기">
            <header className={styles.readingHeader}>
              <p className={styles.step}>Moon Reading · 달을 읽는 일</p>
              <h2>그날의 달에는,<br />이런 이야기가 있었습니다.</h2>
              <p>천문학적으로 계산한 사실 위에 해리엇이 한 편의 이야기를 덧붙였습니다.<br />운명을 단정하는 말이 아니라, 그날을 다시 바라보는 하나의 시선입니다.</p>
            </header>
            <div className={styles.readingGrid}>
              <article className={styles.skyFact}>
                <span>01 · THE SKY</span>
                <h3>하늘이 남긴 사실</h3>
                <p><b>{formatKoreanDate(result.date)}</b><br />{moonData.fact}</p>
                <small>한국 표준시 오후 9시 기준 · 삭망월 계산</small>
              </article>
              <article className={styles.moonStory}>
                <span>02 · THE STORY</span>
                <h3>해리엇이 읽은<br />그날의 달</h3>
                <p>{PHASE_STORIES[moonData.phaseKey]}</p>
                <p>{OCCASION_STORIES[result.occasion]}</p>
                {result.memory && <blockquote>당신이 남긴 말<br />“{result.memory}”</blockquote>}
              </article>
              <article className={styles.moonMessage}>
                <span>03 · FOR YOU</span>
                <h3>그날의 달이 지금의 당신에게<br />이런 말을 건넸을지도 모릅니다.</h3>
                <blockquote>“{PHASE_MESSAGES[moonData.phaseKey]}”</blockquote>
              </article>
            </div>
          </section>
          <div className={styles.actions}>
            <p>이 카드는 당신의 것입니다.</p>
            <button type="button">이미지로 간직하기</button>
            <button type="button">이 밤을 나누기</button>
          </div>
          <div className={styles.bridge}>
            <p className={styles.step}>그리고, 오래 두는 방법</p>
            <h2>그날의 달을<br />손목에 둘 수 있습니다.</h2>
            <p>설월의 뒷면에는 이름도, 날짜도 새길 수 있습니다.<br />각인은 언제나 무료입니다.</p>
            <a href="#seolwol">설월에 담긴 달 이야기 <span>↗</span></a>
            <small>SEOLWOL · {result.date.replaceAll("-", ". ")}.</small>
          </div>
        </section>
      )}

      <footer className={styles.footer}>
        <OfficialLogo className={styles.footerLogo} tone="white" />
        <p>시간이 지워서는 안 되는 것을 기억합니다.</p>
        <small>Moon phases are calculated for 9 PM KST.</small>
      </footer>
    </main>
  );
}
