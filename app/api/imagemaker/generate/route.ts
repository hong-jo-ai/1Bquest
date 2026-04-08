import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const productImage = formData.get("productImage") as File | null;
    const styleGuide = formData.get("styleGuide") as string | null;
    const productDescription =
      (formData.get("productDescription") as string) || "";

    if (!productImage || !styleGuide) {
      return Response.json(
        { error: "제품 이미지와 스타일 가이드가 필요합니다." },
        { status: 400 }
      );
    }

    const parsedStyle = JSON.parse(styleGuide);
    const bytes = await productImage.arrayBuffer();
    const productBase64 = Buffer.from(bytes).toString("base64");

    // Step 1: Gemini 2.5 Pro analyzes the product image and creates detailed prompts
    const detailedDescription = await describeProduct(
      productBase64,
      productImage.type,
      productDescription
    );

    // Step 2: Build 3 variation prompts using style guide + product description
    const variations = [
      {
        shot: "upper body close-up editorial shot, product clearly visible, confident gaze toward camera",
        label: "클로즈업 상반신 착용컷",
      },
      {
        shot: "full body walking shot, natural stride on clean backdrop, relaxed yet polished posture",
        label: "전신 워킹 착용컷",
      },
      {
        shot: "lifestyle environmental shot, candid moment in urban setting, natural daylight",
        label: "라이프스타일 착용컷",
      },
    ];

    // Step 3: Generate 3 images with Imagen 4
    const results: { image: string; description: string }[] = [];

    for (const variation of variations) {
      const prompt = buildImagenPrompt(
        parsedStyle,
        detailedDescription,
        variation.shot
      );

      try {
        const response = await ai.models.generateImages({
          model: "imagen-4.0-generate-001",
          prompt,
          config: {
            numberOfImages: 1,
            aspectRatio: "3:4",
          },
        });

        const generated = response.generatedImages;
        if (generated && generated.length > 0 && generated[0].image?.imageBytes) {
          results.push({
            image: generated[0].image.imageBytes,
            description: variation.label,
          });
        }
      } catch (imgErr) {
        console.error(`Imagen generation failed for ${variation.label}:`, imgErr);
      }
    }

    if (results.length === 0) {
      return Response.json(
        { error: "이미지 생성에 실패했습니다. 다시 시도해주세요." },
        { status: 500 }
      );
    }

    return Response.json({ images: results });
  } catch (error) {
    console.error("Image generation error:", error);
    const message =
      error instanceof Error
        ? error.message
        : "이미지 생성 중 오류가 발생했습니다.";
    return Response.json({ error: message }, { status: 500 });
  }
}

async function describeProduct(
  base64: string,
  mimeType: string,
  userDescription: string
): Promise<string> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-pro-preview-05-06",
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: mimeType as "image/png" | "image/jpeg" | "image/webp",
              data: base64,
            },
          },
          {
            text: `You are an expert fashion product analyst. Describe this product in precise detail for an image generation model. Include:
- Product type and category
- Material, texture, finish
- Color(s) and patterns
- Key design details (hardware, stitching, logos, etc.)
- Size/proportions relative to the body

${userDescription ? `Additional context from the user: ${userDescription}` : ""}

Respond with a single detailed English paragraph, no markdown.`,
          },
        ],
      },
    ],
  });

  return response.text ?? userDescription ?? "fashion accessory product";
}

function buildImagenPrompt(
  style: Record<string, string>,
  productDescription: string,
  shotType: string
): string {
  const template = style.prompt_template
    ? style.prompt_template.replace(
        "{product_description}",
        productDescription
      )
    : "";

  return `Professional fashion editorial photograph for Korean menswear brand PAULVICE.

A stylish Korean male model in his late 20s wearing ${productDescription}.

Shot type: ${shotType}

Photography style:
- Mood: ${style.brand_mood}
- Color grading: ${style.color_tone}
- Lighting: ${style.lighting}
- Composition: ${style.composition}
- Pose direction: ${style.model_pose}
- Background: ${style.background}
- Styling: ${style.styling}
- Aesthetic: ${style.overall_aesthetic}

${template}

Photorealistic, high-resolution, editorial quality, fashion magazine cover grade. No text, no watermarks, no logos overlaid.`;
}
