import { useState, useRef, useEffect } from 'react';
import { 
  RiSendPlane2Line, RiUploadCloud2Line, RiFileTextLine, 
  RiDeleteBinLine, RiCheckboxCircleLine, RiCloseCircleLine,
  RiFileList3Line, RiInputMethodLine
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
  
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

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

  const handleConfirmSend = () => {
    if (!pendingText) return;
    
    // Add to chat
    setMessages(prev => [...prev, { id: Date.now(), type: 'user', text: pendingText }]);
    
    // Add to Active Data Gallery as 'User Typed'
    const newEntry = {
      id: Date.now(),
      name: pendingText.length > 30 ? pendingText.substring(0, 30) + '...' : pendingText,
      fullText: pendingText,
      category: 'Typed',
      date: new Date().toLocaleDateString()
    };
    setActiveData(prev => [newEntry, ...prev]);
    
    setInputValue('');
    setPendingText(null);
    
    // Simulate bot response
    setTimeout(() => {
      setMessages(prev => [...prev, { 
        id: Date.now(), 
        type: 'bot', 
        text: 'I have recorded your input and added it to our active data gallery.' 
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

  const processFiles = (files) => {
    const fileArray = Array.from(files);
    const validFiles = fileArray.filter(f => 
      f.name.endsWith('.pdf') || f.name.endsWith('.docx') || 
      f.type === 'application/pdf' || 
      f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    
    if (validFiles.length > 0) {
      const newEntries = validFiles.map((file, i) => ({
        id: Date.now() + i,
        name: file.name,
        size: (file.size / 1024).toFixed(1) + ' KB',
        category: 'Uploaded',
        date: new Date().toLocaleDateString()
      }));
      
      setActiveData(prev => [...newEntries, ...prev]);
      
      // Post generic message indicating success
      setMessages(prev => [...prev, {
        id: Date.now(),
        type: 'bot',
        text: `Successfully uploaded ${validFiles.length} file(s) to the data gallery.`
      }]);
    } else {
      alert("Please only upload .pdf or .docx files.");
    }
  };

  const handleDeleteData = (id) => {
    setActiveData(prev => prev.filter(item => item.id !== id));
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
              <button 
                className="send-button"
                disabled={!inputValue.trim()}
                onClick={() => setPendingText(inputValue.trim())}
                title="Send Message"
              >
                <RiSendPlane2Line size={18} />
              </button>
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
            <h3>Active Data ({activeData.length})</h3>
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
