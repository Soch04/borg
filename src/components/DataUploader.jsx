/**
 * DataUploader
 *
 * Handles document submission to the orgData Firestore collection for admin review.
 * On approval, AdminDashboard.handleApproveDoc() calls ingestDocument() from lib/rag.js,
 * which chunks the text, embeds it via Gemini text-embedding-004, and upserts to Pinecone.
 *
 * Supported content types:
 *  - Text import (paste): raw text, any length — chunked at ingestion time
 *  - File upload (.txt):  read client-side via FileReader
 *  - File upload (.pdf):  text extracted via pdfjs-dist (client-side, no server)
 *  - File upload (.docx): text extracted via mammoth.js (client-side, no server)
 *    Extracts body paragraphs, headings, lists, and table cells as plain text.
 */

import { useState, useRef } from 'react'
import { RiUploadCloud2Line, RiFileTextLine, RiFilePdf2Line, RiFileWord2Line } from 'react-icons/ri'
import { useApp } from '../context/AppContext'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { extractTextFromPDF, getPDFMetadata } from '../lib/pdfParser'
import { extractTextFromDocx, getDocxMetadata } from '../lib/docxParser'

export default function DataUploader({ title, description, orgId, ownerEmail, onSuccess, isAdmin }) {
  const { addToast } = useApp()
  const [textMode, setTextMode]       = useState(false)
  const [textContent, setTextContent] = useState('')
  const [fileName, setFileName]       = useState('')
  const [fileContent, setFileContent] = useState('')
  const [fileType, setFileType]       = useState('')
  const [fileMeta, setFileMeta]       = useState(null)
  const [extracting, setExtracting]   = useState(false)
  const [uploading, setUploading]     = useState(false)
  const fileInputRef = useRef()

  const detectFormat = (file) => {
    if (file.type === 'application/pdf') return 'PDF'
    if (file.name.endsWith('.docx') ||
        file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'DOCX'
    return 'TXT'
  }

  /** Handle file selection — extract text client-side based on format */
  const handleFileChange = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    const format = detectFormat(file)
    setFileName(file.name)
    setFileType(format)
    setExtracting(true)
    setFileMeta(null)

    try {
      if (format === 'PDF') {
        const [text, meta] = await Promise.all([
          extractTextFromPDF(file),
          getPDFMetadata(file),
        ])
        setFileContent(text)
        setFileMeta({ ...meta, format: 'PDF' })
        addToast(`PDF parsed: ${meta.pageCount} pages, ${text.length.toLocaleString()} characters`, 'success')

      } else if (format === 'DOCX') {
        const [text, meta] = await Promise.all([
          extractTextFromDocx(file),
          Promise.resolve(getDocxMetadata(file)),
        ])
        setFileContent(text)
        setFileMeta({ ...meta, format: 'DOCX' })
        addToast(`Word document parsed: ${text.length.toLocaleString()} characters extracted`, 'success')

      } else {
        // .txt — FileReader
        const text = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload  = e => resolve(e.target.result ?? '')
          reader.onerror = () => reject(new Error('Failed to read file'))
          reader.readAsText(file)
        })
        setFileContent(text)
        setFileMeta({ title: file.name.replace(/\.txt$/i, ''), format: 'TXT' })
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
      const docTitle = textMode
        ? content.slice(0, 60) + (content.length > 60 ? '…' : '')
        : (fileMeta?.title || fileName)

      await addDoc(collection(db, 'orgData'), {
        orgId,
        title:     docTitle,
        content,
        department: 'General',
        uploadedBy: ownerEmail,
        fileType:   textMode ? 'TEXT' : fileType,
        pageCount:  fileMeta?.pageCount ?? null,
        charCount:  content.length,
        sizeKb:     fileMeta?.sizeKb ?? null,
        status:     isAdmin ? 'approved' : 'pending',
        createdAt:  serverTimestamp(),
      })

      addToast(
        isAdmin
          ? 'Document submitted. Approve in the Knowledge Base tab to ingest to Pinecone.'
          : 'Document submitted for admin review.',
        'success'
      )
      if (onSuccess) onSuccess(textMode ? 'TEXT' : fileType, docTitle)

      // Reset form
      setTextContent('')
      setFileName('')
      setFileContent('')
      setFileType('')
      setFileMeta(null)
      if (fileInputRef.current) fileInputRef.current.value = ''

    } catch (err) {
      console.error('[Borg] DataUploader error:', err)
      addToast('Upload failed. Please try again.', 'error')
    } finally {
      setUploading(false)
    }
  }

  const isReady = textMode ? textContent.trim().length > 0 : fileContent.trim().length > 0

  const FileIcon = () => {
    if (!fileMeta) return null
    if (fileMeta.format === 'PDF')  return <RiFilePdf2Line style={{ color: '#e53e3e', marginRight: '0.35rem' }} />
    if (fileMeta.format === 'DOCX') return <RiFileWord2Line style={{ color: '#3182ce', marginRight: '0.35rem' }} />
    return <RiFileTextLine style={{ marginRight: '0.35rem' }} />
  }

  return (
    <div className="card bot-data-uploader">
      <h3 className="card-section-title">{title}</h3>
      <p className="card-section-desc">{description}</p>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <button type="button" className={`btn btn-sm ${!textMode ? 'btn-primary' : ''}`} onClick={() => setTextMode(false)}>
          <RiUploadCloud2Line style={{ marginRight: '0.25rem' }} /> File Upload
        </button>
        <button type="button" className={`btn btn-sm ${textMode ? 'btn-primary' : ''}`} onClick={() => setTextMode(true)}>
          <RiFileTextLine style={{ marginRight: '0.25rem' }} /> Text Import
        </button>
      </div>

      <form onSubmit={handleUpload}>
        {textMode ? (
          <div className="form-group">
            <textarea
              className="form-textarea"
              rows={5}
              placeholder="Paste document content here. It will be chunked and embedded via Gemini text-embedding-004 upon admin approval."
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
              accept=".pdf,.txt,.docx,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              disabled={extracting}
            />
            <p style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: '0.4rem' }}>
              Supported: .pdf · .docx · .txt
            </p>
            {extracting && (
              <p style={{ fontSize: '0.8rem', color: 'var(--color-accent)', marginTop: '0.5rem' }}>
                Extracting text…
              </p>
            )}
            {fileName && fileContent && !extracting && (
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginTop: '0.5rem', display: 'flex', alignItems: 'center' }}>
                <FileIcon />
                {fileName} — {fileContent.length.toLocaleString()} characters
                {fileMeta?.pageCount && ` · ${fileMeta.pageCount} pages`}
              </div>
            )}
          </div>
        )}
        <button type="submit" className="btn btn-primary" disabled={uploading || extracting || !isReady}>
          {uploading ? 'Submitting…' : extracting ? 'Reading file…' : (isAdmin ? 'Submit for Knowledge Base' : 'Submit for Approval')}
        </button>
      </form>
    </div>
  )
}
