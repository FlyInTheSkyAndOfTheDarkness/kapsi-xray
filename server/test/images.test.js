/* ============================================================
   Marketplace photography — what we keep and where we keep it.

   The 1688 CDN (cbu01.alicdn.com) serves a whitelist of
   referring domains and answers 403 to the rest, so a hotlinked
   photo renders nowhere in our pages. Everything below runs
   offline against a throwaway data directory.
   ============================================================ */

import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DATA_DIR = mkdtempSync(join(tmpdir(), 'kx-images-test-'))
process.env.KX_DATA_DIR = DATA_DIR

const { productImageUrl, allowedImageUrl } = await import('../taobao.js')
const { normalizeImages } = await import('../taobao-product.js')
const { readUploadedImage, UPLOAD_DIR } = await import('../uploads.js')
const { mirrorImageUrl, mirrorProductImages } = await import('../image-mirror.js')

const IBANK = 'https://cbu01.alicdn.com/img/ibank/O1CN0169Vn432Lu0yp23L8g_!!2212510089751-0-cib.jpg'

after(() => rmSync(DATA_DIR, { recursive: true, force: true }))

describe('which images belong to the product', () => {
  it('keeps the photography', () => {
    assert.equal(productImageUrl(IBANK), IBANK)
    assert.equal(productImageUrl('https://gw.alicdn.com/imgextra/i4/O1CN01_!!600-2-tps-800-800.jpg'), 'https://gw.alicdn.com/imgextra/i4/O1CN01_!!600-2-tps-800-800.jpg')
  })

  it('drops the page furniture the collector sweeps up', () => {
    // Badges and icons name their own pixel size; banners and sprites their directory.
    assert.equal(productImageUrl('https://gw.alicdn.com/imgextra/i4/O1CN012UvTmV1PtKUSpiHnx_!!6000000001898-2-tps-132-140.png'), null)
    assert.equal(productImageUrl('https://img.alicdn.com/tfs/TB19FQtP4D1gK0jSZFsXXbldVXa-26-44.png'), null)
    assert.equal(productImageUrl('https://cbu01.alicdn.com/cms/upload/2015/460/315/2513064_1964054271.png'), null)
  })

  it('drops vector art, which Kaspi reports back as having no data', () => {
    assert.equal(productImageUrl('https://cbu01.alicdn.com/img/ibank/975055165021_9.svg'), null)
    assert.equal(productImageUrl('https://gw.alicdn.com/imgextra/icon.svg?v=2'), null)
  })

  it('still refuses hosts that are not a marketplace', () => {
    assert.equal(allowedImageUrl('https://evil.example.com/steal.jpg'), null)
    assert.equal(productImageUrl('https://evil.example.com/steal.jpg'), null)
  })
})

describe('drafts saved before the checks existed', () => {
  it('drops an SVG on the way out, without needing a re-import', () => {
    // normalizeImages feeds both the Kaspi card and the price list.
    assert.deepEqual(
      normalizeImages([{ url: 'https://cbu01.alicdn.com/x/975055165021_9.svg' }, { url: IBANK }]),
      [{ url: IBANK }],
    )
  })
})

describe('re-hosting', () => {
  let mirrored

  before(() => {
    // Stand in for a completed download so the suite stays offline.
    const hash = createHash('sha1').update(IBANK).digest('hex').slice(0, 24)
    mirrored = `/uploads/mirror-${hash}.jpg`
    writeFileSync(join(UPLOAD_DIR, `mirror-${hash}.jpg`), Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00]))
  })

  it('reuses a copy it already holds instead of downloading again', async () => {
    assert.equal(await mirrorImageUrl(IBANK), mirrored)
    assert.equal(readdirSync(UPLOAD_DIR).length, 1)
  })

  it('leaves a local url alone', async () => {
    assert.equal(await mirrorImageUrl(mirrored), mirrored)
  })

  it('rewrites the draft Kaspi will receive and keeps the originals', async () => {
    const product = await mirrorProductImages({
      images: [IBANK],
      draft: { images: [{ url: IBANK }] },
    })
    assert.deepEqual(product.images, [mirrored])
    assert.deepEqual(product.draft.images, [{ url: mirrored }])
    assert.deepEqual(product.sourceImages, [IBANK])
  })

  it('reads the stored bytes back for the zip download', () => {
    const file = readUploadedImage(mirrored)
    assert.equal(file.contentType, 'image/jpeg')
    assert.ok(file.data.length)
    assert.equal(readUploadedImage('/uploads/../db.json'), null)
    assert.equal(readUploadedImage('https://cbu01.alicdn.com/x.jpg'), null)
  })
})
