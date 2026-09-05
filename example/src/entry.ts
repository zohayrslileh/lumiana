// @ts-nocheck
import sharp from "sharp"

document.body.textContent = "Generating image with Node sharp..."

try {
  const svg = `
    <svg width="800" height="500"
         xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#6828ff"/>
          <stop offset="100%" stop-color="#00d4ff"/>
        </linearGradient>
      </defs>

      <rect width="800" height="500" rx="48"
            fill="url(#background)"/>

      <circle cx="400" cy="190" r="95"
              fill="rgba(255,255,255,0.22)"/>

      <text x="400" y="215"
            text-anchor="middle"
            font-family="sans-serif"
            font-weight="bold"
            font-size="72"
            fill="white">
        Lumiana
      </text>

      <text x="400" y="350"
            text-anchor="middle"
            font-family="sans-serif"
            font-size="30"
            fill="white">
        Native Node → Browser DOM
      </text>
    </svg>
  `

  // قيمة ثنائية منشأة في المتصفح وتعبر إلى sharp على الخادم
  const input = new TextEncoder().encode(svg)

  const pipeline = sharp(input)
    .resize({
      width: 600,
      height: 375,
      fit: "cover",
    })
    .png({
      compressionLevel: 9,
    })

  // مرجع pipeline بعيد مع استدعاءات متسلسلة
  const metadata = await pipeline.metadata()

  // البيانات الثنائية تعود من Node إلى المتصفح
  const imageBytes = await pipeline.toBuffer()

  const blob = new Blob(
    [imageBytes],
    { type: "image/png" },
  )

  const imageURL = URL.createObjectURL(blob)

  const image = document.createElement("img")
  image.src = imageURL
  image.width = 600
  image.height = 375
  image.style.display = "block"
  image.style.maxWidth = "100%"
  image.style.borderRadius = "24px"

  const result = document.createElement("pre")
  result.textContent = JSON.stringify(
    {
      success: true,
      sharpMetadata: metadata,
      returnedBinary: {
        constructor: imageBytes.constructor.name,
        byteLength: imageBytes.byteLength,
        isUint8Array: imageBytes instanceof Uint8Array,
        blobType: blob.type,
        blobSize: blob.size,
      },
      renderedInDOM: true,
    },
    null,
    2,
  )

  document.body.replaceChildren(image, result)

  window.addEventListener(
    "beforeunload",
    () => URL.revokeObjectURL(imageURL),
    { once: true },
  )
} catch (error) {
  document.body.textContent = JSON.stringify(
    {
      success: false,
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
    null,
    2,
  )
}