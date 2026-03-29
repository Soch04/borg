import { useState, useRef } from 'react'
import { RiUploadCloud2Line, RiFileTextLine } from 'react-icons/ri'
import { useApp } from '../context/AppContext'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/config'

/**
 * DataUploader
 * Submits text or file content to the orgData Firestore collection for admin review.
 * Admins can then approve the document, triggering RAG ingestion via lib/rag.js.
 */
export default function DataUploader({ title, description, orgId, ownerEmail, onSuccess, isAdmin }) {
  const { addToast } = useApp()
  const [textMode, setTextMode]       = useState(false)
  const [textContent, setTextContent] = useState('')
  const [fileName, setFileName]       = useState('')
  const [uploading, setUploading]     = useState(false)
  const fileInputRef = useRef()

  const handleUpload = async (e) => {
    e.preventDefault()
    if (textMode && !textContent.trim()) return
    if (!textMode && !fileName) return

    setUploading(true)
    try {
      const content = textMode
        ? textContent.trim()
        : `[File upload: ${fileName}] — content extracted at ingestion time`

      const docTitle = textMode
        ? textContent.trim().slice(0, 60) + (textContent.length > 60 ? '…' : '')
        : fileName

      // Write to Firestore orgData collection — admin approval gates RAG ingestion
      await addDoc(collection(db, 'orgData'), {
        orgId,
        title:       docTitle,
        content,
        department:  'General',
        uploadedBy:  ownerEmail,
        fileType:    textMode ? 'text' : fileName.split('.').pop().toUpperCase(),
        status:      isAdmin ? 'approved' : 'pending',
        createdAt:   serverTimestamp(),
      })

      if (isAdmin) {
        addToast('Document submitted and auto-approved. Approve in Admin Dashboard to ingest to knowledge base.', 'success')
        if (onSuccess) onSuccess(textMode ? 'text' : 'file', docTitle)
      } else {
        addToast('Document submitted for admin review.', 'info')
      }

      setTextContent('')
      setFileName('')
      if (fileInputRef.current) fileInputRef.current.value = ''

    } catch (err) {
      console.error('[Borg] DataUploader error:', err)
      addToast('Upload failed. Please try again.', 'error')
    } finally {
      setUploading(false)
    }
  }

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
              placeholder="Paste document content here. It will be chunked and embedded via Gemini text-embedding-004 upon admin approval."
              value={textContent}
              onChange={e => setTextContent(e.target.value)}
            />
          </div>
        ) : (
          <div className="form-group">
            <input
              type="file"
              multiple
              className="form-input"
              ref={fileInputRef}
              onChange={e => setFileName(e.target.files[0]?.name ?? '')}
              accept=".pdf,.docx,.txt"
            />
          </div>
        )}
        <button
          type="submit"
          className="btn btn-primary"
          disabled={uploading || (!textMode && !fileName) || (textMode && !textContent.trim())}
        >
          {uploading ? 'Submitting…' : (isAdmin ? 'Submit for Knowledge Base' : 'Submit for Admin Approval')}
        </button>
      </form>
    </div>
  )
}
