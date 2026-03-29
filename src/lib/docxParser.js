/**
 * @module docxParser
 * @description Client-side .docx text extraction using mammoth.js.
 *
 * Closes the last major ingestion gap in the plan: .pdf and .txt are already
 * supported; .docx now joins via mammoth's browser-compatible ArrayBuffer API.
 *
 * LIBRARY: mammoth (https://github.com/mwilliamson/mammoth.js)
 * Mammoth converts .docx files (Office Open XML) to plain text by walking the
 * XML structure of the document body, extracting paragraph runs, and stripping
 * all formatting markup. It does NOT require unzipping — the library handles
 * the ZIP-based OOXML container internally.
 *
 * WHAT MAMMOTH EXTRACTS:
 *   ✅ Body text (paragraphs, headings, lists)
 *   ✅ Table cell content (rows joined with tab separators)
 *   ❌ Headers / footers (outside the main document body)
 *   ❌ Text boxes and drawing objects
 *   ❌ Embedded images (image ALT text is preserved if set)
 *
 * WHY NOT CLIENT-SIDE HTML CONVERSION:
 *   mammoth.extractRawText() is used instead of convertToHtml() because we want
 *   clean plain text for Gemini embedding — HTML tags would add noise to the vector
 *   representation without contributing semantic information.
 *
 * SCANNED DOCUMENTS:
 *   Like PDF, if a .docx contains only images with no text layer, extraction will
 *   return an empty string. This is detected and surfaced with a clear error.
 *
 * @exports extractTextFromDocx
 * @exports getDocxMetadata
 */

import mammoth from 'mammoth'

/**
 * Extract plain text from a .docx File object.
 *
 * @param {File} file - A browser File object (from <input type="file">)
 * @returns {Promise<string>} - Extracted plain text, ready for RAG chunking
 * @throws {Error} - If the file is not a valid .docx or extraction produces no text
 */
export async function extractTextFromDocx(file) {
  if (!file) throw new Error('extractTextFromDocx: file is required')

  const isDocx = file.name.endsWith('.docx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

  if (!isDocx) {
    throw new Error('extractTextFromDocx: input must be a .docx file')
  }

  // Read the file as an ArrayBuffer — mammoth's browser API requires this
  const arrayBuffer = await file.arrayBuffer()

  // Extract raw text (not HTML) — cleaner for embedding
  const result = await mammoth.extractRawText({ arrayBuffer })

  // Log any warnings (e.g., unsupported elements) to console for debugging
  if (result.messages && result.messages.length > 0) {
    result.messages.forEach(msg => {
      if (msg.type === 'warning') {
        console.warn(`[Borg docxParser] ${msg.message}`)
      }
    })
  }

  const text = result.value?.trim()

  if (!text || text.length < 10) {
    throw new Error(
      'No text could be extracted from this .docx file. ' +
      'The document may contain only images or embedded objects. ' +
      'Try exporting to .pdf or pasting the text directly.'
    )
  }

  return text
}

/**
 * Extract basic metadata from a .docx filename.
 * Mammoth does not expose core properties (author, created date) in browser mode —
 * this returns what we can derive from the file object itself.
 *
 * @param {File} file
 * @returns {{ title: string, estimatedWordCount: number }}
 */
export function getDocxMetadata(file) {
  // Derive a clean title from the filename (strip extension)
  const title = file.name
    .replace(/\.docx$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim()

  return {
    title,
    sizeKb: Math.round(file.size / 1024),
  }
}
