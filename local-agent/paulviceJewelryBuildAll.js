/** paulvice 주얼리 상세페이지 빌더 — 전 판매상품(73종) 버전. FTP/API PUT 제외, 읽기+로컬생성만.
 *  대상: downloads/jewelry-audit/audit.json 중 display==='T' && selling==='T' (73개).
 *    - desc_imgs===0 (빈 16종): 미니멀 템플릿(착용샷+대표 제품컷+스펙표).
 *    - desc_imgs>0  (기존상세 57종): 증강 — 상단 대표 착용샷 → 기존 상세 이미지 그대로 → 하단 추가 착용샷.
 *  각 상품: source/(참조 제품컷) · upload/(사장님 착용샷, 보존) · prompt.txt · detail.html 생성.
 *  ※ upload/ 안 기존 착용샷은 절대 건드리지 않음. source/ 이미 받은 파일은 재다운로드 스킵. */
const fs=require("fs"),path=require("path");
const DASH=path.resolve(__dirname,"..");
function loadEnv(p){try{for(const l of fs.readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim().replace(/^["']|["']$/g,"");if(!(m[1] in process.env))process.env[m[1]]=v;}}catch{}}
require("dotenv").config({override:true});
loadEnv(path.join(DASH,".env.supabase"));loadEnv(path.join(DASH,".env.local"));
const{createClient}=require(path.join(DASH,"node_modules/@supabase/supabase-js"));
const MALL=process.env.CAFE24_MALL_ID,BASE=`https://${MALL}.cafe24api.com`;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function token(sb){const{data}=await sb.from("kv_store").select("data").eq("key","cafe24_refresh_token").maybeSingle();let t=data.data,now=Date.now();if(t.access_token&&t.expires_at&&t.expires_at-90000>now)return t.access_token;const r=await fetch(`${BASE}/api/v2/oauth/token`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",Authorization:"Basic "+Buffer.from(`${process.env.CAFE24_CLIENT_ID}:${process.env.CAFE24_CLIENT_SECRET}`).toString("base64")},body:`grant_type=refresh_token&refresh_token=${encodeURIComponent(t.refresh_token)}`});const j=await r.json();await sb.from("kv_store").upsert({key:"cafe24_refresh_token",data:{access_token:j.access_token,refresh_token:j.refresh_token,expires_at:now+110*60*1000},updated_at:new Date().toISOString()},{onConflict:"key"});return j.access_token;}

// 상품명 → 착용부위/타입 분류. 착용컷 2장이 서로 다른 앵글이 되도록 w1/w2 두 변형 제공.
function classify(name){
  if(/이어커프|ear cuff/i.test(name)) return {part:"earcuff",ko:"이어커프",
    w1ko:"귀 연골(헬릭스)에 착용, 측면 클로즈업",w1en:"worn on the ear cartilage (helix), close-up side profile of the ear",
    w2ko:"머리를 귀 뒤로 살짝 넘겨 이어커프 위치가 또렷이 보이는 약간 다른 3/4 앵글",w2en:"slightly different three-quarter angle with hair tucked behind the ear so the ear cuff placement is clearly visible"};
  if(/귀걸이|이어링|후프|earring|hoop/i.test(name)) return {part:"ear",ko:"귀걸이",
    w1ko:"왼쪽 귀에 착용, 측면 3/4 앵글의 귓불·턱선 클로즈업",w1en:"worn on the model's left ear, three-quarter side profile close-up of the ear and jawline",
    w2ko:"정면에 가까운 앵글로 머리를 한쪽으로 넘겨 귀걸이가 흔들리듯 드러나는 컷",w2en:"near-front angle with hair swept to one side, earring shown dangling and clearly visible, softer framing"};
  if(/팔찌|bracelet/i.test(name)) return {part:"wrist",ko:"팔찌",
    w1ko:"손목에 착용, 손목과 손등이 우아하게 보이는 클로즈업",w1en:"worn on the wrist, close-up of the wrist and back of the hand resting elegantly",
    w2ko:"라이프스타일 컷 — 손으로 커피잔을 살짝 잡거나 얼굴 근처에 손을 둔 자연스러운 장면에서 팔찌가 보이게",w2en:"lifestyle shot — hand gently holding a coffee cup or resting near the face, bracelet naturally visible"};
  if(/반지|링|ring/i.test(name)) return {part:"finger",ko:"반지",
    w1ko:"손가락에 착용, 손 전체가 우아하게 보이는 클로즈업",w1en:"worn on the finger, elegant close-up of the whole hand",
    w2ko:"손을 턱·볼 근처에 자연스럽게 둔 다른 제스처의 디테일 컷",w2en:"different gesture — hand resting gently near the chin or cheek, detail crop on the ring"};
  if(/목걸이|펜던트|necklace|pendant/i.test(name)) return {part:"neck",ko:"목걸이",
    w1ko:"목·데콜테에 착용, 쇄골 라인이 보이는 상반신 클로즈업",w1en:"worn around the neck, upper-chest close-up showing the collarbone and décolletage",
    w2ko:"펜던트 부분을 손끝으로 살짝 만지는 제스처의 클로즈업 디테일 컷",w2en:"closer detail crop of the pendant with the model gently touching it with her fingertips"};
  return {part:"misc",ko:"주얼리",
    w1ko:"모델이 착용한 우아한 클로즈업",w1en:"worn by the model, elegant close-up",
    w2ko:"다른 앵글의 착용 디테일 컷",w2en:"a different-angle close-up detail of the piece worn"};
}
const slug=s=>s.replace(/\[[^\]]*\]/g,"").replace(/[^\w가-힣]+/g,"_").replace(/^_+|_+$/g,"").slice(0,40);

const STYLE_KO=`- 제품의 형태/색/소재/디테일은 사진과 완전히 동일하게 유지(임의 변형·추가 금지)
- 한국인 20~30대 여성 모델, 자연스럽고 깨끗한 피부, 미니멀·우아한 분위기
- 배경: 부드러운 뉴트럴 톤(아이보리/베이지), 스튜디오 소프트 라이트, 얕은 심도
- 폴바이스(Paulvice) 브랜드 톤: 미니멀·모던·럭셔리, 과하지 않은 색보정
- 세로 4:5 비율, 고해상도, 워터마크/텍스트 없음`;
const STYLE_EN=`Keep the product's shape, color, material and every detail IDENTICAL to the reference — do not redesign or add elements. Korean female model, 20s–30s, clean natural skin, minimal elegant mood. Soft neutral ivory/beige studio background, soft diffused lighting, shallow depth of field, true-to-life color. Minimal modern luxury brand aesthetic (Paulvice). Vertical 4:5, high resolution, no watermark, no text.`;

function promptText(p,c){
  const block=(label,file,wko,wen)=>`────────────────────────────────────────
■ ${label}  (저장 파일명: ${file})

[한글 지시]
첨부한 ${c.ko} 제품 사진을 참조해, 동일한 제품을 ${wko} 형태로 한 고급 이커머스 착용컷을 만들어줘.
${STYLE_KO}

[English prompt]
Editorial e-commerce product-on-model shot. Using the attached ${c.ko} (jewelry) photo as the exact reference, generate the SAME piece ${wen}.
${STYLE_EN}`;
  return `# 착용샷 생성 프롬프트 — ${p.name} (상품번호 ${p.no})
# 방식: ChatGPT(GPT-4o 이미지) image-to-image. source/ 폴더의 상품사진을 첨부하고 아래 프롬프트 사용.
# 핵심: 첨부한 실제 제품의 디자인·색상·소재를 100% 그대로 유지(변형 금지), 모델 착용 장면만 생성.
# 착용컷 2장(앵글이 서로 다름) → 각각 아래 두 프롬프트로 생성.

${block("착용컷 1 (대표컷)","model_01.png",c.w1ko,c.w1en)}

${block("착용컷 2 (보조/디테일컷)","model_02.png",c.w2ko,c.w2en)}

────────────────────────────────────────
[생성 후] 결과를 이 상품 폴더의 upload/ 에 model_01.png, model_02.png 로 저장.
  → upload/ 안의 파일을 FTP /web/product/pv-detail/${p.no}/ 경로로 업로드하면 HTML이 자동으로 그 URL을 가리킴.`;
}

const imgTag=(src,alt)=>`  <div style="text-align:center;margin:0 0 8px;">
    <img src="${src}" alt="${alt}" style="width:100%;display:block;"/>
  </div>`;

// 빈 상세(desc_imgs===0): 미니멀 템플릿. productImg=기존 대표 제품컷, modelBase=착용샷 공개 URL 베이스.
function detailHtmlEmpty(p,c,productImg,modelBase){
  return `<div class="pv-detail" style="width:1000px;max-width:100%;margin:0 auto;font-family:'Noto Sans KR',sans-serif;color:#222;line-height:1.7;">

  <!-- 1) 대표 착용샷 (upload/model_01.png → FTP 업로드 후 표시) -->
${imgTag(`${modelBase}/model_01.png`,`${p.name} 착용 이미지`)}

  <!-- 2) 브랜드/상품 카피 -->
  <div style="text-align:center;padding:48px 24px;">
    <p style="font-size:13px;letter-spacing:3px;color:#a98;margin:0 0 12px;">PAULVICE</p>
    <h2 style="font-size:24px;font-weight:600;margin:0 0 16px;">${p.name}</h2>
    <p style="font-size:15px;color:#555;margin:0 auto;max-width:560px;">
      일상에 우아함을 더하는 ${c.ko}. 군더더기 없는 미니멀한 디자인으로
      데일리룩부터 특별한 날까지 자연스럽게 어울립니다.
    </p>
  </div>

  <!-- 3) 제품 단독컷 (기존 카페24 CDN 원본 사용) -->
${imgTag(productImg,`${p.name} 제품 이미지`)}

  <!-- 4) 추가 착용/디테일컷 (upload/model_02.png → FTP 업로드 후 표시) -->
${imgTag(`${modelBase}/model_02.png`,`${p.name} 착용 디테일`)}

  <!-- 5) 포인트 -->
  <div style="padding:40px 24px;border-top:1px solid #eee;">
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:10px 0;color:#999;width:120px;">분류</td><td>${c.ko}</td></tr>
      <tr><td style="padding:10px 0;color:#999;">소재</td><td>(소재 입력)</td></tr>
      <tr><td style="padding:10px 0;color:#999;">사이즈</td><td>(사이즈 입력)</td></tr>
    </table>
  </div>
</div>`;
}

// 기존상세(desc_imgs>0): 증강. 상단 대표 착용샷 → 기존 상세 이미지 전부(원본 유지) → 하단 추가 착용샷.
function detailHtmlAugment(p,c,descUrls,modelBase){
  const body=descUrls.map((u,i)=>imgTag(u,`${p.name} 상세 이미지 ${i+1}`)).join("\n");
  return `<div class="pv-detail" style="width:1000px;max-width:100%;margin:0 auto;font-family:'Noto Sans KR',sans-serif;color:#222;line-height:1.7;">

  <!-- 1) 대표 착용샷 (신규 / upload/model_01.png → FTP 업로드 후 표시) -->
${imgTag(`${modelBase}/model_01.png`,`${p.name} 착용 이미지`)}

  <!-- 2) 기존 상세 이미지 (카페24 원본 그대로, ${descUrls.length}컷) -->
${body}

  <!-- 3) 추가 착용/디테일컷 (신규 / upload/model_02.png → FTP 업로드 후 표시) -->
${imgTag(`${modelBase}/model_02.png`,`${p.name} 착용 디테일`)}
</div>`;
}

(async()=>{
  const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);const tk=await token(sb);const H={Authorization:`Bearer ${tk}`};
  const audit=require(path.join(DASH,"downloads","jewelry-audit","audit.json"));
  const targets=audit.filter(r=>r.display==="T"&&r.selling==="T").sort((a,b)=>a.no-b.no);
  const root=path.join(DASH,"downloads","jewelry-detail");fs.mkdirSync(root,{recursive:true});
  const FTP_DIR="/web/product/pv-detail";
  const urlBaseFrom=url=>{ const m=(url||"").match(/^(https?:\/\/.*?\/web\/product)\//); return m?m[1]:null; };
  const manifest=[];let cdnBase=null;
  for(const p of targets){
    const c=classify(p.name);
    const augment=p.desc_imgs>0;
    const dir=path.join(root,`${p.no}_${slug(p.name)}`);
    fs.mkdirSync(path.join(dir,"source"),{recursive:true});
    fs.mkdirSync(path.join(dir,"upload"),{recursive:true}); // 기존 착용샷 보존 — writeFileSync 하지 않음
    // 상세 fetch → detail_image/list_image (참조 제품컷)
    const d=(await (await fetch(`${BASE}/api/v2/admin/products/${p.no}`,{headers:H})).json()).product||{};
    cdnBase=cdnBase||urlBaseFrom(d.detail_image)||urlBaseFrom(d.list_image)||urlBaseFrom(p.list_image);
    // source 참조컷: 이미 받은 파일 있으면 스킵
    const dl=async(url,fn)=>{ if(!url)return null; const fp=path.join(dir,"source",fn); if(fs.existsSync(fp))return fn+"(skip)"; try{const r=await fetch(url);const b=Buffer.from(await r.arrayBuffer());fs.writeFileSync(fp,b);return fn;}catch(e){return "FAIL:"+e.message;} };
    const di=await dl(d.detail_image,"detail"+path.extname(new URL(d.detail_image||"http://x/x.jpg").pathname));
    const li=await dl(d.list_image||p.list_image,"list"+path.extname(new URL(d.list_image||p.list_image||"http://x/x.jpg").pathname));
    const modelBase=`${urlBaseFrom(d.detail_image)||cdnBase}/pv-detail/${p.no}`;
    fs.writeFileSync(path.join(dir,"prompt.txt"),promptText(p,c));
    const html=augment
      ? detailHtmlAugment(p,c,(p.desc_img_urls||[]),modelBase)
      : detailHtmlEmpty(p,c,d.detail_image,modelBase);
    fs.writeFileSync(path.join(dir,"detail.html"),html);
    const hasShots=fs.existsSync(path.join(dir,"upload","model_01.png"));
    manifest.push({no:p.no,name:p.name,type:c.ko,price:p.price,mode:augment?"augment":"empty",
      desc_imgs:p.desc_imgs,has_model_shots:hasShots,dir:path.relative(DASH,dir),
      product_image:d.detail_image,existing_detail_imgs:augment?(p.desc_img_urls||[]).length:0,
      ftp_upload_to:`${FTP_DIR}/${p.no}/`,model_url_base:modelBase});
    console.log(`✔ ${p.no} ${p.name} [${c.ko}] ${augment?"증강("+(p.desc_img_urls||[]).length+"컷)":"빈템플릿"}${hasShots?" ★착용샷보유":""} src(${di},${li})`);
    await sleep(130);
  }
  fs.writeFileSync(path.join(root,"manifest.json"),JSON.stringify(manifest,null,2));
  const nEmpty=manifest.filter(m=>m.mode==="empty").length, nAug=manifest.filter(m=>m.mode==="augment").length, nShot=manifest.filter(m=>m.has_model_shots).length;
  const readme=`# 폴바이스 주얼리 상세페이지 작업 (판매중 전 상품 ${manifest.length}종)

각 상품 폴더 구성:
  source/    : 참조용 기존 제품사진(착용샷 생성 시 ChatGPT에 첨부). 업로드 X
  upload/    : 여기에 생성한 착용샷을 model_01.png, model_02.png 로 저장 → FTP 업로드 대상
  prompt.txt : 착용샷 생성용 GPT 프롬프트(상품별 맞춤)
  detail.html: 상세페이지 HTML. 빈 상품=미니멀 템플릿 / 기존상세 보유=증강(상단 착용샷+기존 상세+하단 착용샷)

구성: 빈템플릿 ${nEmpty}종 · 증강 ${nAug}종 · 이미 착용샷 보유 ${nShot}종

## 사장님 작업 순서
1) prompt.txt 로 ChatGPT에서 착용샷 생성 → 각 상품 upload/ 에 model_01.png(필수), model_02.png(선택) 저장
2) 각 상품 upload/ 안의 파일을 FTP 경로  ${FTP_DIR}/<상품번호>/  로 업로드
   예) 235번 → ${FTP_DIR}/235/model_01.png
3) 알려주시면 제가 detail.html 을 카페24 상품 description 에 코드로 일괄 반영(PUT)합니다.

* 제품 단독컷·기존 상세 이미지는 기존 카페24 CDN 원본을 그대로 써서 재업로드 불필요. 새로 올릴 건 착용샷뿐입니다.
* 공개 URL 베이스(확인): ${cdnBase || "(추출 실패 — 확인 필요)"}
`;
  fs.writeFileSync(path.join(root,"README.md"),readme);
  console.log(`\n총 ${manifest.length}종 (빈 ${nEmpty} / 증강 ${nAug} / 착용샷보유 ${nShot}) → ${path.relative(DASH,root)}`);
  console.log(`CDN 공개 URL 베이스: ${cdnBase}`);
})().catch(e=>{console.error("ERR",e.stack||e.message);process.exit(1);});
