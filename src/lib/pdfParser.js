/**
 * @module pdfParser
 * @description Client-side PDF text extraction using PDF.js (pdfjs-dist).
 *
 * Runs entirely in the browser — no server round-trip required.
 * Extracts text from all pages, filters noise (page numbers, whitespace-only lines),
 * and returns clean concatenated content ready for RAG chunking.
 *
 * Usage:
 *   import { extractTextFromPDF } from '../lib/pdfParser'
 *   const text = await extractTextFromPDF(fileObject)
 *   // Pass text to ingestDocument() or store in orgData for admin approval
 */

import * as pdfjsLib from 'pdfjs-dist'

// Point the PDF.js worker at the locally hosted bundle in /public
// This avoids dynamic import failures from CDNs in Vite environments.
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

/**
 * Extract all text from a PDF File object.
 *
 * @param {File} file - A browser File object (from <input type="file">)
 * @returns {Promise<string>} - Extracted text, pages separated by newlines
 * @throws {Error} - If the file is not a valid PDF or extraction fails
 */
export async function extractTextFromPDF(file) {
  if (!file || file.type !== 'application/pdf') {
    throw new Error('extractTextFromPDF: input must be a PDF file (application/pdf)')
  }

  // Read the file as an ArrayBuffer
  const arrayBuffer = await file.arrayBuffer()

  // Load the PDF document
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  const pageTexts = []

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page    = await pdf.getPage(pageNum)
    const content = await page.getTextContent()

    // Extract raw strings and join with spaces, preserving paragraph breaks
    const pageText = content.items
      .map(item => item.str)
      .join(' ')
      .replace(/\s{3,}/g, '\n\n')  // Collapse excessive whitespace into paragraph breaks
      .trim()

    if (pageText.length > 0) {
      pageTexts.push(`[Page ${pageNum}]\n${pageText}`)
    }
  }

  if (pageTexts.length === 0) {
    throw new Error('PDF appears to contain no extractable text (may be a scanned image PDF).')
  }

  return pageTexts.join('\n\n')
}

/**
 * Get metadata from a PDF (title, author, page count) for display purposes.
 *
 * @param {File} file
 * @returns {Promise<{ title: string, author: string, pageCount: number }>}
 */
export async function getPDFMetadata(file) {
  const arrayBuffer = await file.arrayBuffer()
  const pdf         = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const meta        = await pdf.getMetadata().catch(() => ({ info: {} }))

  return {
    title:     meta?.info?.Title  || file.name.replace(/\.pdf$/i, ''),
    author:    meta?.info?.Author || 'Unknown',
    pageCount: pdf.numPages,
  }
}
