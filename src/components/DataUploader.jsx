import React, { useState, useRef } from 'react';
import { RiUploadCloud2Line, RiFileTextLine } from 'react-icons/ri';
import { useApp } from '../context/AppContext';
import { db } from '../firebase/config';
import { collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';

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
        const formData = new FormData();
        formData.append('text', textContent);
        formData.append('org_id', orgId);
        formData.append('owner', ownerEmail);
        formData.append('is_admin', isAdmin ? 'true' : 'false');
        
        const res = await fetch('http://localhost:8000/api/text', {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        
        if (data.queued) {
          // SYNC WITH FIRESTORE
          await setDoc(doc(db, 'ingestion_queue', data.req_id), {
             req_id: data.req_id,
             org_id: orgId,
             owner: ownerEmail,
             title: data.title,
             type: data.type,
             preview: data.preview,
             timestamp: serverTimestamp()
          });
          addToast('Upload queued for Admin approval.', 'info');
          if (onSuccess) onSuccess('text', textContent, true, data.req_id);
        } else {
          addToast('Text successfully vectorized!', 'success');
          if (onSuccess) onSuccess('text', textContent, false);
        }
        setTextContent('');
      } else {
        const formData = new FormData();
        Array.from(files).forEach(file => formData.append('files', file));
        formData.append('org_id', orgId);
        formData.append('owner', ownerEmail);
        formData.append('is_admin', isAdmin ? 'true' : 'false');
        
        const res = await fetch('http://localhost:8000/api/upload', {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        
        if (data.queued) {
          // SYNC WITH FIRESTORE
          await setDoc(doc(db, 'ingestion_queue', data.req_id), {
             req_id: data.req_id,
             org_id: orgId,
             owner: ownerEmail,
             title: data.title,
             type: data.type,
             preview: data.preview,
             timestamp: serverTimestamp()
          });
          addToast('Files queued for Admin approval.', 'info');
          if (onSuccess) onSuccess('documents', Array.from(files).map(f => f.name).join(', '), true, data.req_id);
        } else {
          addToast('Documents successfully vectorized!', 'success');
          if (onSuccess) onSuccess('documents', Array.from(files).map(f => f.name).join(', '), false);
        }
        setFiles([]);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    } catch (err) {
      addToast('Upload failed. Is the Python engine running?', 'error');
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
            : (isAdmin ? 'Import to Pinecone (Fast-Track)' : 'Submit for Admin Approval')}
        </button>
      </form>
    </div>
  );
}
