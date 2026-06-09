const path = require('path')
const fs = require('fs-extra')
const axios = require('axios')
const cloudinary = require('cloudinary').v2
const { execFile } = require('child_process')
const { promisify } = require('util')
const os = require('os')
const PptCache = require('../../models/Courses/PptCacheModel')

const execFileAsync = promisify(execFile)

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

const SOFFICE = 'C:/Program Files/LibreOffice/program/soffice.exe'

async function convertPptToImages(req, res) {
  // Accept either an uploaded file or a URL (URL used only if server can reach it)
  const hasUploadedFile = req.files && req.files.file
  const pptUrl = req.body?.pptUrl

  if (!hasUploadedFile && !pptUrl) {
    return res.status(400).json({ success: false, error: 'Either upload a file or provide pptUrl' })
  }

  // Check DB cache first — only possible when a URL is known
  const cacheKey = pptUrl || null
  if (cacheKey) {
    const cached = await PptCache.findOne({ pptUrl: cacheKey })
    if (cached && cached.slideImages.length > 0) {
      console.log('✅ Cache hit — returning stored slides')
      return res.json({ success: true, slideImages: cached.slideImages, totalSlides: cached.totalSlides, fromCache: true })
    }
  }

  const tempDir = path.join(os.tmpdir(), `ppt_${Date.now()}`)

  try {
    await fs.ensureDir(tempDir)

    // Detect the actual file extension so LibreOffice opens it correctly
    let ext = 'pptx'
    if (hasUploadedFile && req.files.file.name) {
      const m = req.files.file.name.match(/\.([a-zA-Z0-9]+)$/)
      if (m) ext = m[1].toLowerCase()
    } else if (pptUrl) {
      const m = pptUrl.split('?')[0].match(/\.([a-zA-Z0-9]+)$/)
      if (m) ext = m[1].toLowerCase()
    }

    const inputPath = path.join(tempDir, `presentation.${ext}`)

    if (hasUploadedFile) {
      // File sent directly from browser — no external download needed
      console.log(`📁 Using uploaded file (${ext})...`)
      await fs.writeFile(inputPath, req.files.file.data)
    } else {
      // Fallback: download from URL
      console.log(`⬇️  Downloading file (${ext})...`)
      const response = await axios.get(pptUrl, { responseType: 'arraybuffer', timeout: 30000 })
      await fs.writeFile(inputPath, Buffer.from(response.data))
    }

    // 2. Document → PDF via LibreOffice (works for pptx, docx, doc, ppt, odp, odt, etc.)
    console.log('📄 Converting to PDF via LibreOffice...')
    await execFileAsync(
      SOFFICE,
      ['--headless', '--convert-to', 'pdf', '--outdir', tempDir, inputPath],
      { timeout: 120000 }
    )

    // LibreOffice names the PDF after the input file stem (presentation.{ext} → presentation.pdf)
    const pdfPath = path.join(tempDir, 'presentation.pdf')
    if (!await fs.pathExists(pdfPath)) {
      throw new Error('LibreOffice PDF conversion failed')
    }

    // 3. PDF pages → PNG images via pdf-to-img
    console.log('🖼️  Rendering slides...')
    const { pdf } = await import('pdf-to-img')
    const pdfBuffer = await fs.readFile(pdfPath)
    const imagePaths = []
    let slideNum = 1

    for await (const pageBuffer of await pdf(pdfBuffer, { scale: 2 })) {
      const imgPath = path.join(tempDir, `slide_${slideNum}.png`)
      await fs.writeFile(imgPath, pageBuffer)
      imagePaths.push(imgPath)
      slideNum++
    }

    if (imagePaths.length === 0) throw new Error('No slides rendered')

    // 4. Upload to Cloudinary
    console.log(`☁️  Uploading ${imagePaths.length} slides...`)
    const stamp = Date.now()
    const uploads = await Promise.all(
      imagePaths.map((imgPath, idx) =>
        cloudinary.uploader.upload(imgPath, {
          folder: 'ppt-slides',
          public_id: `slide_${idx + 1}_${stamp}`,
          resource_type: 'image',
          format: 'jpg',
          transformation: [{ quality: 'auto:good' }],
        })
      )
    )

    const slideImages = uploads.map(r => r.secure_url)
    console.log(`✅ ${slideImages.length} slides ready`)

    // Persist to DB cache so future requests skip conversion entirely
    if (cacheKey) {
      PptCache.findOneAndUpdate(
        { pptUrl: cacheKey },
        { pptUrl: cacheKey, slideImages, totalSlides: slideImages.length },
        { upsert: true, new: true }
      ).catch(err => console.warn('Cache save failed:', err.message))
    }

    res.json({ success: true, slideImages, totalSlides: slideImages.length })

  } catch (err) {
    console.error('❌ PPT conversion error:', err.message)
    res.status(500).json({ success: false, error: err.message })
  } finally {
    await fs.remove(tempDir).catch(() => {})
  }
}

module.exports = { convertPptToImages }
