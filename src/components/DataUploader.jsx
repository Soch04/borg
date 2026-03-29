/**
 * DataUploader
 *
 * Handles document submission to the orgData Firestore collection for admin review.
 * On approval, AdminDashboard.handleApproveDoc() calls ingestDocument() from lib/rag.js,
 * which chunks the text, embeds it via Gemini text-embedding-004, and upserts to Pinecone.
 *
 * Supported content types:
 *  - Text import (paste): raw text, any length — chunked at ingestion time (1000 tokens / 200 overlap)
 *  - File upload (.txt): read client-side via FileReader
 *  - File upload (.pdf): text extracted client-side via PDF.js (pdfjs-dist) — no server required
 *
 * Note: .docx support requires server-side XML parsing and is not implemented in this
 * client-only build. Convert .docx to .pdf or paste the text content instead.
 */

import { useState, useRef } from 'react'
import { RiUploadCloud2Line, RiFileTextLine, RiFilePdf2Line } from 'react-icons/ri'
import { useApp } from '../context/AppContext'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { extractTextFromPDF, getPDFMetadata } from '../lib/pdfParser'

export default function DataUploader({ title, description, orgId, ownerEmail, onSuccess, isAdmin }) {
  const { addToast } = useApp()
  const [textMode, setTextMode]       = useState(false)
  const [textContent, setTextContent] = useState('')
  const [fileName, setFileName]       = useState('')
  const [fileContent, setFileContent] = useState('')
  const [fileType, setFileType]       = useState('')
  const [pdfMeta, setPdfMeta]         = useState(null)
  const [extracting, setExtracting]   = useState(false)
  const [uploading, setUploading]     = useState(false)
  const fileInputRef = useRef()

  /** Handle file selection — extract text from .txt or .pdf client-side */
  const handleFileChange = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    setFileName(file.name)
    setFileType(file.type)
    setExtracting(true)

    try {
      if (file.type === 'application/pdf') {
        // PDF: extract text via PDF.js (client-side, no server)
        const [text, meta] = await Promise.all([
          extractTextFromPDF(file),
          getPDFMetadata(file),
        ])
        setFileContent(text)
        setPdfMeta(meta)
        addToast(`PDF parsed: ${meta.pageCount} pages, ${text.length.toLocaleString()} characters extracted`, 'success')
      } else if (file.type === 'text/plain') {
        // .txt: read via FileReader
        const text = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload  = e => resolve(e.target.result ?? '')
          reader.onerror = () => reject(new Error('Failed to read file'))
          reader.readAsText(file)
        })
        setFileContent(text)
        setPdfMeta(null)
      }
    } catch (err) {
      console.error('[Borg] File extraction error:', err)
      addToast(`Failed to extract text: ${err.message}`, 'error')
      setFileContent('')
    } finally {
      setExtracting(false)
    }
  }

  const handleUpload = async (e) => {
    e.preventDefault()
    const content = textMode ? textContent.trim() : fileContent.trim()
    if (!content) return

    setUploading(true)
    try {
      // Use PDF title metadata if available, otherwise derive from content
      const docTitle = textMode
        ? content.slice(0, 60) + (content.length > 60 ? '…' : '')
        : (pdfMeta?.title || fileName)

      const resolvedFileType = textMode ? 'TEXT'
        : fileType === 'application/pdf' ? 'PDF'
        : 'TXT'

      await addDoc(collection(db, 'orgData'), {
        orgId,
        title:       docTitle,
        content,                          // Full extracted text — used by ingestDocument() at approval
        department:  'General',
        uploadedBy:  ownerEmail,
        fileType:    resolvedFileType,
        pageCount:   pdfMeta?.pageCount ?? null,
        charCount:   content.length,
        status:      isAdmin ? 'approved' : 'pending',
        createdAt:   serverTimestamp(),
      })

      if (isAdmin) {
        addToast('Document submitted. Approve in the Knowledge Base tab to ingest to Pinecone.', 'success')
        if (onSuccess) onSuccess(resolvedFileType, docTitle)
      } else {
        addToast('Document submitted for admin review.', 'info')
      }

      // Reset form
      setTextContent('')
      setFileName('')
      setFileContent('')
      setFileType('')
      setPdfMeta(null)
      if (fileInputRef.current) fileInputRef.current.value = ''

    } catch (err) {
      console.error('[Borg] DataUploader error:', err)
      addToast('Upload failed. Please try again.', 'error')
    } finally {
      setUploading(false)
    }
  }

  const isReady = textMode
    ? textContent.trim().length > 0
    : fileContent.trim().length > 0

  return (
    <div className="card bot-data-uploader">
      <h3 className="card-section-title">{title}</h3>
      <p className="card-section-desc">{description}</p>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <button
          type="button"
          className={`btn btn-sm ${!textMode ? 'btn-primary' : ''}`}
          onClick={() => setTextMode(false)}
        >
          <RiUploadCloud2Line style={{ marginRight: '0.25rem' }} /> File Upload
        </button>
        <button
          type="button"
          className={`btn btn-sm ${textMode ? 'btn-primary' : ''}`}
          onClick={() => setTextMode(true)}
        >
          <RiFileTextLine style={{ marginRight: '0.25rem' }} /> Text Import
        </button>
      </div>

      <form onSubmit={handleUpload}>
        {textMode ? (
          <div className="form-group">
            <textarea
              className="form-textarea"
              rows={5}
              placeholder="Paste document content here. It will be chunked (1000 chars / 200 overlap) and embedded via Gemini text-embedding-004 upon admin approval."
              value={textContent}
              onChange={e => setTextContent(e.target.value)}
            />
          </div>
        ) : (
          <div className="form-group">
            <input
              type="file"
              className="form-input"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".pdf,.txt,application/pdf,text/plain"
              disabled={extracting}
            />
            {extracting && (
              <p style={{ fontSize: '0.8rem', color: 'var(--color-accent)', marginTop: '0.5rem' }}>
                Extracting text from PDF…
              </p>
            )}
            {fileName && fileContent && !extracting && (
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginTop: '0.5rem' }}>
                {fileType === 'application/pdf' && (
                  <span style={{ color: 'var(--color-accent)', marginRight: '0.5rem' }}>
                    <RiFilePdf2Line style={{ verticalAlign: 'middle' }} /> PDF
                  </span>
                )}
                {fileName} — {fileContent.length.toLocaleString()} characters
                {pdfMeta && ` · ${pdfMeta.pageCount} pages`}
              </div>
            )}
          </div>
        )}
        <button
          type="submit"
          className="btn btn-primary"
          disabled={uploading || extracting || !isReady}
        >
          {uploading ? 'Submitting…' : extracting ? 'Reading file…' : (isAdmin ? 'Submit for Knowledge Base' : 'Submit for Admin Approval')}
        </button>
      </form>
    </div>
  )
}
