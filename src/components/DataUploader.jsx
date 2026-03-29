import React, { useState, useRef } from 'react';
import { RiUploadCloud2Line, RiFileTextLine } from 'react-icons/ri';
import { useApp } from '../context/AppContext';
import { db } from '../firebase/config';
import { collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { ingestDocument } from '../lib/rag';
import { extractTextFromPDF } from '../lib/pdfParser';
import { extractTextFromDocx } from '../lib/docxParser';

export default function DataUploader({ title, description, orgId, ownerEmail, onSuccess, isAdmin }) {
  const { addToast } = useApp();
  const [textMode, setTextMode] = useState(false);
  const [textContent, setTextContent] = useState('');
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef();

  const handleUpload = async (e) => {
    e.preventDefault();
    if (textMode && !textContent.trim()) return;
    if (!textMode && files.length === 0) return;
    
    setUploading(true);
    try {
      if (textMode) {
        // Direct Client-Side Ingestion for Text
        await ingestDocument(orgId, {
          id: `text_${Date.now()}`,
          title: textContent.slice(0, 50) + (textContent.length > 50 ? '...' : ''),
          text: textContent,
          department: 'global',
          adminId: ownerEmail
        });
        
        addToast('Text successfully vectorized to Pinecone!', 'success');
        if (onSuccess) onSuccess('text', textContent, false);
        setTextContent('');
      } else {
        // Direct Client-Side Ingestion for Files
        for (const file of Array.from(files)) {
          let text = '';
          if (file.type === 'application/pdf') {
            text = await extractTextFromPDF(file);
          } else if (file.name.endsWith('.docx')) {
            text = await extractTextFromDocx(file);
          } else {
            text = await file.text(); // Assume plain text for other types (.txt, etc)
          }

          await ingestDocument(orgId, {
            id: `file_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            title: file.name,
            text: text,
            department: 'global',
            adminId: ownerEmail
          });
        }
        
        addToast('Documents successfully vectorized to Pinecone!', 'success');
        if (onSuccess) onSuccess('documents', Array.from(files).map(f => f.name).join(', '), false);
        setFiles([]);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    } catch (err) {
      console.error('[DataUploader] Ingestion Error:', err);
      addToast(`Upload failed: ${err.message}`, 'error');
    } finally {
      setUploading(false);
    }
  };

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
              placeholder="Paste raw text here... It will be dynamically chunked and imported via MPNet."
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
              onChange={e => setFiles(e.target.files)}
              accept=".pdf,.docx,.txt"
            />
          </div>
        )}
        <button type="submit" className="btn btn-primary" disabled={uploading || (!textMode && files.length === 0) || (textMode && !textContent)}>
          {uploading 
            ? 'Processing...' 
            : 'Import to Pinecone (Direct)'}
        </button>
      </form>
    </div>
  );
}
