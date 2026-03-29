import { useState, useRef, useEffect } from 'react';
import { 
  RiSendPlane2Line, RiUploadCloud2Line, RiFileTextLine, 
  RiDeleteBinLine, RiCheckboxCircleLine, RiCloseCircleLine,
  RiFileList3Line, RiInputMethodLine, RiNotification3Line, RiGroupLine
} from 'react-icons/ri';
import './UserInputPage.css';

export default function UserInputPage() {
  const [messages, setMessages] = useState([
    { id: 1, type: 'bot', text: 'Hello! You can type here or upload your PDF/DOCX files. What would you like to provide?' }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [pendingText, setPendingText] = useState(null);

  // Data Gallery State
  const [activeData, setActiveData] = useState([]);
  const [filter, setFilter] = useState('All'); // All, Typed, Uploaded
  const [isDragging, setIsDragging] = useState(false);
  const [isShared, setIsShared] = useState(false);

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  // Live Alerts WebSocket
  useEffect(() => {
    // Connect to FastAPI websocket
    const ws = new WebSocket('ws://localhost:8000/ws/alerts/user123');
    ws.onmessage = (event) => {
      // Add a high priority alert to chat
      setMessages(prev => [...prev, {
        id: Date.now(), type: 'bot', text: `🚨 LIVE ALERT: ${event.data}`
      }]);
    };
    return () => ws.close();
  }, []);

  const simulateAlert = async () => {
    await fetch('http://localhost:8000/api/chat_simulate', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ target_user: 'user123', sender: 'Brahian' })
    });
  }

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pendingText]);

  const handleInputChange = (e) => {
    setInputValue(e.target.value);
    // If they start typing again, hide confirmation
    if (pendingText !== null) {
      setPendingText(null);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (inputValue.trim()) {
        setPendingText(inputValue.trim());
      }
    }
  };

  const handleConfirmSend = async () => {
    if (!pendingText) return;

    // Add to chat
    setMessages(prev => [...prev, { id: Date.now(), type: 'user', text: pendingText }]);

    await textInput(pendingText);

    setInputValue('');
    setPendingText(null);

    // Simulate bot response
    setTimeout(() => {
      setMessages(prev => [...prev, {
        id: Date.now(),
        type: 'bot',
        text: 'I have recorded your input and automatically vectorized it into Pinecone.'
      }]);
    }, 600);
  };

  const handleCancelSend = () => {
    setPendingText(null);
  };

  const handleFileUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  const textInput = async (text) => {
    const formData = new FormData();
    formData.append('text', text);
    formData.append('shared_org', isShared ? 'Org_123' : 'none');
    const response = await fetch('http://localhost:8000/api/text', {
      method: 'POST',
      body: formData,
    });
    if (response.ok) {
      const newEntry = {
        id: Date.now(),
        name: text.length > 30 ? text.substring(0, 30) + '...' : text,
        fullText: text,
        category: 'Typed',
        date: new Date().toLocaleDateString()
      };
      setActiveData(prev => [newEntry, ...prev]);
    }
  };

  const processFiles = async (files) => {
    const fileArray = Array.from(files);
    const validFiles = fileArray.filter(f =>
      f.name.endsWith('.pdf') || f.name.endsWith('.docx') ||
      f.type === 'application/pdf' ||
      f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );

    if (validFiles.length > 0) {
      const formData = new FormData();
      validFiles.forEach(file => { formData.append('files', file); });
      formData.append('shared_org', isShared ? 'Org_123' : 'none');

      setMessages(prev => [...prev, {
        id: Date.now(), type: 'bot', text: `Uploading ${validFiles.length} file(s) to the data engine...`
      }]);

      try {
        const response = await fetch('http://localhost:8000/api/upload', {
          method: 'POST', body: formData,
        });

        if (response.ok) {
          const newEntries = validFiles.map((file, i) => ({
            id: Date.now() + i, name: file.name, size: (file.size / 1024).toFixed(1) + ' KB',
            category: 'Uploaded', date: new Date().toLocaleDateString()
          }));
          setActiveData(prev => [...newEntries, ...prev]);
          setMessages(prev => [...prev, {
            id: Date.now() + 1, type: 'bot', text: `Files successfully received by backend! Beginning text extraction and Pinecone vectorization.`
          }]);
        } else { throw new Error("Server rejected upload."); }
      } catch (e) {
        setMessages(prev => [...prev, {
          id: Date.now() + 1, type: 'bot', error: true, text: `Error: Is your python backend running on port 8000? (${e.message})`
        }]);
      }
    } else {
      alert("Please only upload .pdf or .docx files.");
    }
  };

  const handleDeleteData = async (id) => {
    const item = activeData.find(i => i.id === id);
    if (!item) return;
    try {
      if (item.category === 'Uploaded' || item.category === 'Typed') {
        await fetch(`http://localhost:8000/api/delete?source=${encodeURIComponent(item.name)}`, { method: 'DELETE' });
      }
      setActiveData(prev => prev.filter(i => i.id !== id));
    } catch (e) { console.error(e); }
  };

  const filteredData = activeData.filter(item => {
    if (filter === 'All') return true;
    return item.category === filter;
  });

  return (
    <div className="user-input-page fade-in">
      {/* LEFT: Chat Interface */}
      <section className="chat-section">
        <header className="chat-header">
          <RiInputMethodLine size={24} />
          <h2>Send Input</h2>
        </header>

        <div className="chat-messages">
          {messages.map(msg => (
            <div key={msg.id} className={`chat-message ${msg.type}`}>
              <div className="message-avatar">
                {msg.type === 'bot' ? 'B' : 'U'}
              </div>
              <div className="message-bubble">
                {msg.text}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="chat-input-area">
          <div className="chat-input-wrapper">

            {pendingText && (
              <div className="confirmation-prompt">
                <span><strong>Are you sure?</strong> Do you want to submit this input?</span>
                <div className="confirm-actions">
                  <button className="btn-confirm" onClick={handleConfirmSend}>I am sure</button>
                  <button className="btn-cancel" onClick={handleCancelSend}>Cancel</button>
                </div>
              </div>
            )}

            <textarea
              className="chat-input"
              placeholder="Type your message... (Press Enter to send)"
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              rows={1}
            />

            {!pendingText && (
              <div style={{display: 'flex', gap: '8px', alignItems: 'center'}}>
                <label style={{display:'flex', alignItems:'center', gap:'4px', color:'var(--text-secondary)', fontSize:'12px', cursor:'pointer', whiteSpace:'nowrap'}}>
                  <input type="checkbox" checked={isShared} onChange={e => setIsShared(e.target.checked)} />
                  <RiGroupLine/> Share with Org
                </label>
                <button
                  className="send-button"
                  disabled={!inputValue.trim()}
                  onClick={() => setPendingText(inputValue.trim())}
                  title="Send Message"
                >
                  <RiSendPlane2Line size={18} />
                </button>
              </div>
            )}

          </div>
        </div>
      </section>

      {/* RIGHT: File Management & Gallery */}
      <section className="file-management-section">

        {/* Upload Area */}
        <div
          className={`upload-area ${isDragging ? 'drag-over' : ''}`}
          onClick={handleFileUploadClick}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            className="hidden-file-input"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            multiple
          />
          <RiUploadCloud2Line className="upload-icon" />
          <div className="upload-text">Click to Upload or Drag and Drop</div>
          <div className="upload-subtext">Supports PDF and DOCX only</div>
        </div>

        {/* Data Gallery */}
        <div className="data-gallery">
          <header className="gallery-header">
            <div style={{display:'flex', gap:'8px', alignItems:'center'}}>
              <h3>Active Data ({activeData.length})</h3>
              <button 
                onClick={simulateAlert} 
                className="filter-btn active" 
                style={{backgroundColor: '#e74c3c', color: 'white', border: 'none'}}
              >
                <RiNotification3Line size={14}/> Test Live Alert
              </button>
            </div>
            <div className="gallery-filters">
              {['All', 'Typed', 'Uploaded'].map(f => (
                <button
                  key={f}
                  className={`filter-btn ${filter === f ? 'active' : ''}`}
                  onClick={() => setFilter(f)}
                >
                  {f}
                </button>
              ))}
            </div>
          </header>

          <div className="gallery-list">
            {filteredData.length === 0 ? (
              <div className="empty-state">No active data items yet.</div>
            ) : (
              filteredData.map(item => (
                <div key={item.id} className="data-item">
                  <div className="data-item-info">
                    <div className="data-item-icon">
                      {item.category === 'Typed' ? <RiFileList3Line /> : <RiFileTextLine />}
                    </div>
                    <div className="data-item-details">
                      <span className="data-item-name" title={item.fullText || item.name}>{item.name}</span>
                      <span className="data-item-meta">
                        <span className={`badge badge-${item.category.toLowerCase()}`}>
                          {item.category === 'Typed' ? 'User Typed' : 'Uploaded'}
                        </span>
                        <span>{item.date} {item.size ? `· ${item.size}` : ''}</span>
                      </span>
                    </div>
                  </div>
                  <button
                    className="btn-delete"
                    onClick={() => handleDeleteData(item.id)}
                    title="Delete entry"
                  >
                    <RiDeleteBinLine size={18} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
