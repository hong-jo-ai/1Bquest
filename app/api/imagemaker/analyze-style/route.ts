import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("images") as File[];

    if (files.length === 0) {
      return Response.json(
        { error: "레퍼런스 이미지를 하나 이상 업로드해주세요." },
        { status: 400 }
      );
    }

    const imageParts = await Promise.all(
      files.map(async (file) => {
        const bytes = await file.arrayBuffer();
        const base64 = Buffer.from(bytes).toString("base64");
        return {
          inlineData: {
            mimeType: file.type as
              | "image/png"
              | "image/jpeg"
              | "image/webp",
            data: base64,
          },
        };
      })
    );

    const response = await ai.models.generateContent({
      model: "gemini-2.5-pro-preview-05-06",
      contents: [
        {
          role: "user",
          parts: [
            ...imageParts,
            {
              text: `당신은 패션 화보 디렉터입니다. 업로드된 레퍼런스 이미지들을 분석하여 브랜드 "PAULVICE(폴바이스)"의 화보 스타일 가이드라인을 만들어주세요.

다음 항목을 반드시 포함하여 JSON 형식으로 응답해주세요:

{
  "brand_mood": "전체적인 브랜드 무드 (예: 미니멀, 모던, 클래식 등)",
  "color_tone": "사진 색감/톤 설명 (색온도, 채도, 콘트라스트 등)",
  "lighting": "조명 스타일 (자연광, 스튜디오, 방향 등)",
  "composition": "구도 패턴 (프레이밍, 여백, 시선 방향 등)",
  "model_pose": "모델 포즈 특징 (자세, 시선, 손 위치, 분위기 등)",
  "background": "배경 스타일 (장소, 질감, 색상 등)",
  "styling": "스타일링 방향 (코디 스타일, 악세서리 등)",
  "overall_aesthetic": "종합적인 미학적 방향성 요약",
  "prompt_template": "이 스타일로 착용컷을 생성할 때 사용할 프롬프트 템플릿 (영어, {product_description} 플레이스홀더 포함)"
}

JSON만 응답하고, 다른 텍스트는 포함하지 마세요.`,
            },
          ],
        },
      ],
    });

    const text = response.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return Response.json(
        { error: "스타일 분석 결과를 파싱할 수 없습니다." },
        { status: 500 }
      );
    }

    const styleGuide = JSON.parse(jsonMatch[0]);
    return Response.json({ styleGuide });
  } catch (error) {
    console.error("Style analysis error:", error);
    return Response.json(
      { error: "스타일 분석 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
