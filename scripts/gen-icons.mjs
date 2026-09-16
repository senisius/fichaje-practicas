// Genera los PNG de la PWA a partir de los SVG maestros de public/.
// Uso: npm run icons (vuelve a ejecutarlo si cambias algún SVG).
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')
const BRAND = '#0F7B4A'
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 }

const JOBS = [
  { src: 'icons/app-icon.svg', out: 'icons/icon-192.png', size: 192 },
  { src: 'icons/app-icon.svg', out: 'icons/icon-512.png', size: 512 },
  { src: 'icons/app-icon-maskable.svg', out: 'icons/maskable-192.png', size: 192, opaque: true },
  { src: 'icons/app-icon-maskable.svg', out: 'icons/maskable-512.png', size: 512, opaque: true },
  // iOS no admite transparencia y ya recorta las esquinas: fondo a sangre y opaco.
  { src: 'icons/app-icon-maskable.svg', out: 'icons/apple-touch-icon.png', size: 180, opaque: true },
  { src: 'favicon.svg', out: 'favicon-32.png', size: 32 },
]

async function render({ src, out, size, opaque = false }) {
  const svg = await readFile(path.join(PUBLIC_DIR, src))
  const { width } = await sharp(svg).metadata()
  if (!width) throw new Error(`${src}: no se pudo leer el tamaño del SVG`)

  // Rasteriza al doble del tamaño final y reduce: bordes más limpios.
  const density = Math.ceil((72 * size * 2) / width)
  let image = sharp(svg, { density }).resize(size, size, { fit: 'contain', background: TRANSPARENT })
  if (opaque) image = image.flatten({ background: BRAND }).removeAlpha()

  const target = path.join(PUBLIC_DIR, out)
  await image.png({ compressionLevel: 9 }).toFile(target)

  const meta = await sharp(target).metadata()
  const bytes = (await stat(target)).size
  if (meta.width !== size || meta.height !== size) {
    throw new Error(`${out}: mide ${meta.width}x${meta.height}, se esperaba ${size}x${size}`)
  }
  if (opaque && meta.hasAlpha) throw new Error(`${out}: debería ser opaco`)
  console.log(`${out.padEnd(28)} ${`${meta.width}x${meta.height}`.padEnd(8)} ${meta.hasAlpha ? 'RGBA' : 'RGB '} ${bytes} B`)
}

for (const job of JOBS) await render(job)
