// Coherencia de los colores del tema entre la app, index.html, la página sin conexión y el service worker.
import { beforeAll, describe, expect, it } from 'vitest'

/** Lee un fichero del proyecto (en vitest, `?raw` devuelve vacío para los .css). */
async function readProjectFile(rel: string): Promise<string> {
  // Import dinámico: los tipos de Node no forman parte del proyecto de la app
  const fsModule = 'node:fs/promises'
  const fs = (await import(/* @vite-ignore */ fsModule)) as {
    readFile: (path: URL, encoding: 'utf8') => Promise<string>
  }
  return fs.readFile(new URL(`../${rel}`, import.meta.url), 'utf8')
}

/** Valor de una variable CSS dentro de un bloque. */
function cssVar(block: string, name: string): string | null {
  return new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block)?.[1]?.toLowerCase() ?? null
}

function themeColor(html: string, scheme: 'light' | 'dark'): string | null {
  const re = new RegExp(
    `<meta name="theme-color" content="(#[0-9a-fA-F]{6})" media="\\(prefers-color-scheme: ${scheme}\\)"`,
  )
  return re.exec(html)?.[1]?.toLowerCase() ?? null
}

const darkBlockOf = (text: string) => /@media \(prefers-color-scheme: dark\) \{[\s\S]*?\}\s*\}/.exec(text)?.[0] ?? ''

let indexCss = ''
let indexHtml = ''
let offlineHtml = ''
let swJs = ''

beforeAll(async () => {
  ;[indexCss, indexHtml, offlineHtml, swJs] = await Promise.all(
    ['src/index.css', 'index.html', 'public/offline.html', 'public/sw.js'].map(readProjectFile),
  )
})

describe('colores del tema', () => {
  it('el theme-color oscuro coincide con el fondo oscuro de la app', () => {
    const bg = cssVar(darkBlockOf(indexCss), '--bg')
    expect(bg).toBe('#0d1310')
    expect(themeColor(indexHtml, 'dark')).toBe(bg)
    expect(themeColor(offlineHtml, 'dark')).toBe(bg)
  })

  it('el theme-color claro es el verde de la marca en las dos páginas', () => {
    const brand = cssVar(indexCss, '--brand')
    expect(brand).toBe('#0f7b4a')
    expect(themeColor(indexHtml, 'light')).toBe(brand)
    expect(themeColor(offlineHtml, 'light')).toBe(brand)
  })

  it('la página sin conexión usa el mismo fondo oscuro que la app', () => {
    const appDark = darkBlockOf(indexCss)
    const offlineDark = darkBlockOf(offlineHtml)
    expect(cssVar(offlineDark, '--bg')).toBe(cssVar(appDark, '--bg'))
    expect(cssVar(offlineDark, '--card')).toBe(cssVar(appDark, '--surface'))
  })

  it('el service worker tiene una versión de caché nueva (offline.html ha cambiado)', () => {
    expect(swJs).toMatch(/const VERSION = 'v2'/)
  })
})
