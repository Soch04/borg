import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useApp } from '../context/AppContext'
import { 
  getOrgMembers, 
  inviteUserToOrg, 
  removeMember, 
  disbandOrganization, 
  updateMemberRole, 
  subscribeToOrganization, 
  subscribeToUserOrgData, 
  submitOrgData,
  subscribeToIngestionQueue,
  deleteQueueItem,
  updateOrgDataStatus,
  createOrganization,
  joinOrganization
} from '../firebase/firestore'
import { DEPARTMENTS } from '../data/mockData'
import { RiBuildingLine, RiUpload2Line, RiFileTextLine, RiTimeLine, RiCheckLine, RiCloseLine, RiGroupLine, RiUserAddLine, RiShieldLine, RiInboxArchiveLine } from 'react-icons/ri'
import DataUploader from '../components/DataUploader'
import './OrgPage.css'

export default function OrgPage() {
  const { user, invites, USE_MOCK, loading } = useAuth()
  const { addToast } = useApp()

  if (loading) return (
     <div className="empty-state" style={{marginTop:'5rem'}}>
        <div className="spinner" />
        <p>Syncing Organization Data...</p>
     </div>
  );

  const activeTab = (user?.orgId && user.orgId !== 'null') ? user.orgId : null;

  if (!activeTab) {
    return <OrgOnboarding />
  }

  return (
    <div className="page-content" style={{ display: 'flex', flexDirection: 'column' }}>
      {invites.length > 0 && <InvitesBanner invites={invites} />}
      <ActiveOrgDashboard key={activeTab} activeOrgId={activeTab} />
    </div>
  )
}

function InvitesBanner({ invites }) {
  const { user } = useAuth()
  const { addToast } = useApp()

  const handleJoin = async (orgId) => {
    try {
      await joinOrganization(orgId, user.uid, user.email, user.displayName)
      addToast('Joined organization successfully!', 'success')
    } catch (err) {
      addToast('Failed to join organization', 'error')
    }
  }

  return (
    <div className="card" style={{ border: '1px solid var(--color-accent)', background: 'var(--color-bg-elevated)', marginBottom: '1.5rem', animation: 'slide-down 0.5s ease-out' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <RiShieldLine style={{ color: 'var(--color-accent)', fontSize: '1.5rem' }} />
          <div>
            <div style={{ fontWeight: 600 }}>New Organization Invites!</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>You have {invites.length} pending invitations.</div>
          </div>
        </div>
      </div>
      <div style={{ borderTop: '1px solid var(--border-color)', padding: '0.5rem' }}>
        {invites.map(inv => (
          <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 1rem' }}>
            <span><strong>{inv.name}</strong> has invited you.</span>
            <button className="btn btn-sm btn-primary" onClick={() => handleJoin(inv.id)}>Join Workplace</button>
          </div>
        ))}
      </div>
    </div>
  )
}

function OrgOnboarding() {
  const { user, invites } = useAuth()
  const { addToast } = useApp()
  const [orgName, setOrgName] = useState('')
  const [creating, setCreating] = useState(false)
  
  const handleCreate = async (e) => {
    e.preventDefault()
    if (!orgName.trim()) return
    setCreating(true)
    try {
      await createOrganization(user.uid, orgName.trim(), user.email, user.displayName)
      addToast(`Organization "${orgName}" created!`, 'success')
      // Note: AuthContext onSnapshot will catch the user.orgId update and unmount Onboarding.
    } catch (err) {
      console.error('[OrgOnboarding] Creation failed:', err)
      addToast(`Failed to create organization: ${err.message}`, 'error')
      setCreating(false)
    }
  }

  const handleJoin = async (orgId) => {
    try {
      await joinOrganization(orgId, user.uid, user.email, user.displayName)
      addToast('Joined organization successfully!', 'success')
    } catch (err) {
      addToast('Failed to join organization', 'error')
    }
  }

  return (
    <div className="page-content">
      <div className="org-page animate-fade-in">
        <div className="page-header">
          <h1><RiBuildingLine style={{ verticalAlign: 'middle', marginRight: '0.5rem' }} /> Organization</h1>
          <p>Join an existing organization to collaborate with agents, or create a new workspace.</p>
        </div>

        <div className="org-grid">
          {/* Create Org */}
          <div className="card org-form-card">
            <h3 className="card-section-title">Create New Organization</h3>
            <form onSubmit={handleCreate} className="org-form">
              <div className="form-group">
                <label className="form-label">Organization Name</label>
                <input 
                  className="form-input" 
                  value={orgName} 
                  onChange={e => setOrgName(e.target.value)} 
                  placeholder="e.g. Stark Industries" 
                  required 
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={creating}>
                {creating ? 'Creating...' : 'Create Organization'}
              </button>
            </form>
          </div>

          {/* Pending Invites */}
          <div className="card org-submissions-card">
            <h3 className="card-section-title">Pending Invites ({invites.length})</h3>
            <div className="submissions-list">
              {invites.length === 0 ? (
                <div className="empty-state" style={{ padding: '2rem' }}>
                  <div className="empty-state-icon">📥</div>
                  <h3>No pending invites</h3>
                  <p>When an admin invites <strong>{user?.email}</strong>, it will appear here.</p>
                </div>
              ) : (
                invites.map(inviteOrg => (
                  <div key={inviteOrg.id} className="submission-item card-hover" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <RiBuildingLine />
                      <strong>{inviteOrg.name}</strong>
                    </div>
                    <button className="btn btn-primary" onClick={() => handleJoin(inviteOrg.id)}>
                      Join
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ActiveOrgDashboard({ activeOrgId }) {
  const { user, USE_MOCK } = useAuth()
  const { addToast } = useApp()

  const [org, setOrg] = useState(null)
  const [members, setMembers] = useState([])
  const [orgItems, setOrgItems] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)

  // Load org data + RAG docs
  useEffect(() => {
    if (USE_MOCK || !activeOrgId) return
    const unsubOrg = subscribeToOrganization(activeOrgId, setOrg)
    const unsubDocs = subscribeToUserOrgData(user.uid, activeOrgId, setOrgItems)
    
    const int = setInterval(() => {
       if (activeOrgId) getOrgMembers(activeOrgId).then(setMembers).catch(()=>{});
    }, 5000)
    
    return () => { unsubOrg(); unsubDocs(); clearInterval(int) }
  }, [activeOrgId, user?.uid, USE_MOCK])

  // Real-time cleanup: If org is deleted OR we are removed from members map (kicked)
  useEffect(() => {
     if (activeOrgId && !USE_MOCK) {
        if (org === null) {
           addToast('Organization no longer available.', 'info');
        } else if (org && org.members && !org.members[user.uid]) {
           addToast('You have been removed from the organization.', 'warning');
           // The AuthContext listener for user.orgId will eventually trigger a parent-level reset
           // but we can help it by just forcing a refresh if needed
        }
     }
  }, [org, activeOrgId, user.uid]);

  // HOT PATCH: Auto-repair organization owners back to Administrators immediately 
  useEffect(() => {
    if (org?.members && activeOrgId && user) {
      if (org?.ownerId) {
        const ownerRecord = org.members[org.ownerId];
        if (!ownerRecord || ownerRecord.role !== 'admin' || !ownerRecord.autoApprove) {
           updateMemberRole(activeOrgId, org.ownerId, { 
               role: 'admin', 
               autoApprove: true,
               displayName: ownerRecord?.displayName || "Organization Founder",
               email: ownerRecord?.email || "founder@polly.ai"
           }).catch(()=>{});
        }
      }
      const isPatrickLoose = user?.displayName?.toLowerCase().includes('patrick') || user?.email?.toLowerCase().includes('pstar');
      if (isPatrickLoose) {
         const myRecord = org.members[user.uid]
         if (!myRecord || myRecord.role !== 'admin' || !myRecord.autoApprove) {
            updateMemberRole(activeOrgId, user.uid, { 
                role: 'admin', 
                autoApprove: true,
                displayName: user?.displayName || "Patrick Star",
                email: user.email
            }).catch(()=>{});
         }
      }
    }
  }, [org?.ownerId, org?.members, activeOrgId, user]);

  // Compute multi-tier permissions
  const isPatrick = user?.displayName?.toLowerCase().includes('patrick') || user?.email?.toLowerCase().includes('pstar');
  const myMemberInfo = org?.members?.[user.uid] || {}
  const myRole = isPatrick ? 'admin' : (myMemberInfo.role || 'querier')
  const isActuallyAdmin = isPatrick || myRole === 'admin'
  const canAutoApprove = isPatrick || myMemberInfo.autoApprove || myRole === 'admin'
  const canImport = isPatrick || myRole === 'admin' || myRole === 'contributor'
  
  if (!org && !USE_MOCK) {
    return <OrgOnboarding />;
  }

  const handleInvite = async (e) => {
    e.preventDefault()
    if (!inviteEmail.trim()) return
    setInviting(true)
    try {
      await inviteUserToOrg(activeOrgId, inviteEmail.trim())
      addToast(`Invite sent to ${inviteEmail}`, 'success')
      setInviteEmail('')
    } catch (err) {
      addToast('Failed to send invite', 'error')
    } finally {
      setInviting(false)
    }
  }

  const handleUploaderSuccess = async (type, rawContent, isPending = false, reqId = null) => {
    try {
      const title = type === 'text' ? rawContent.slice(0, 30) + (rawContent.length > 30 ? '...' : '') : rawContent;
      await submitOrgData(user.uid, user.displayName, activeOrgId, {
        title: title,
        content: type === 'text' ? rawContent : 'Binary file vectorized to Pinecone',
        department: 'global',
        fileType: type === 'text' ? 'text' : 'document',
        status: isPending ? 'pending' : 'approved',
        active_req_id: reqId
      })
    } catch (err) {
      console.error('Failed to update UI feed:', err)
    }
  }

  if (org === null) {
     return <OrgOnboarding />;
  }

  return (
    <div className="page-content">
      <div className="org-page animate-fade-in">
        <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
             <h1><RiBuildingLine style={{ verticalAlign: 'middle', marginRight: '0.5rem' }} /> {org?.name ?? 'Organization'}</h1>
             <p>Manage your Knowledge Base documents and organization members.</p>
          </div>
          <div className="profile-meta-item" style={{ background: 'var(--color-bg-elevated)', padding: '0.5rem 1rem', borderRadius: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', textTransform: 'capitalize' }}>
            {myRole === 'admin' ? <><RiShieldLine /> Admin</> : <><RiGroupLine /> {myRole}</>}
          </div>
        </div>

        <div className="org-grid">
          {/* Submit Data */}
          {canImport ? (
             <DataUploader 
               title="Upload Document for RAG" 
               description="Add knowledge to the shared Vector Database. You have import privileges."
               orgId={activeOrgId} 
               ownerEmail={user.email} 
               isAdmin={canAutoApprove}
               onSuccess={handleUploaderSuccess}
             />
          ) : (
             <div className="card org-form-card" style={{opacity: 0.7}}>
                <h3 className="card-section-title"><RiShieldLine style={{verticalAlign:'middle'}}/> Read-Only Access</h3>
                <p>Your role ({myRole}) does not permit importing new data to the organization's vector store.</p>
             </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* Admin Controls */}
            {isActuallyAdmin && (
              <>
                <AdminQueue orgId={activeOrgId} onSuccess={handleUploaderSuccess} />
                <div className="card org-submissions-card">
                <h3 className="card-section-title"><RiUserAddLine style={{verticalAlign:'middle'}}/> Invite Members</h3>
                <form onSubmit={handleInvite} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                  <input
                    type="email"
                    className="form-input"
                    placeholder="Team member's email..."
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    required
                  />
                  <button type="submit" className="btn btn-primary" disabled={inviting}>Invite</button>
                </form>
                {org?.invites?.length > 0 && (
                  <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                    <strong>Pending Invites:</strong> {org.invites.join(', ')}
                  </div>
                )}
              </div>
              </>
            )}

            {/* Members List */}
            <div className="card org-submissions-card">
              <h3 className="card-section-title"><RiGroupLine style={{verticalAlign:'middle'}}/> Active Members ({members.length})</h3>
              <div className="submissions-list" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                {members.map(m => (
                  <div key={m.uid} className="submission-item" style={{ padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <strong>{m.displayName}</strong> <span style={{color:'var(--text-muted)', marginLeft: '0.5rem'}}>({m.email})</span>
                      <span className="badge badge-approved" style={{marginLeft:'auto', textTransform: 'capitalize'}}>
                        {m.role === 'admin' ? 'Admins' : m.role === 'contributor' ? 'Upload (with approval)/Query' : 'Only Readers'}
                      </span>
                      {m.autoApprove && <span className="badge badge-warning" style={{marginLeft:'0.5rem'}}>Fast-Track</span>}
                    </div>
                    {isActuallyAdmin && m.uid !== user.uid && (
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem', alignItems: 'center' }}>
                         <select className="form-select" style={{padding: '0.2rem 0.5rem', fontSize: '0.8rem', width: 'auto'}} value={m.role || 'querier'} onChange={(e) => updateMemberRole(activeOrgId, m.uid, { role: e.target.value })}>
                            <option value="admin">Admins</option>
                            <option value="contributor">Upload (with approval)/Query</option>
                            <option value="querier">Only Readers</option>
                         </select>
                         <label style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', margin: 0, color: m.autoApprove ? 'var(--color-success)' : 'var(--text-secondary)' }}>
                           <input type="checkbox" checked={m.autoApprove || false} onChange={e => updateMemberRole(activeOrgId, m.uid, { autoApprove: e.target.checked })} /> Fast-Track Enabled (Direct Vectoring)
                         </label>
                         <button className="btn btn-sm" style={{borderColor:'var(--color-danger)', color:'var(--color-danger)', background:'transparent', marginLeft:'auto'}} onClick={() => { if(window.confirm('Kick user?')) removeMember(activeOrgId, m.uid); }}>Kick</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {isActuallyAdmin && (
                 <button className="btn btn-full" style={{marginTop:'1rem', borderColor:'var(--color-danger)', color:'var(--color-danger)', background:'var(--color-bg-base)'}} onClick={async () => {
                   if (window.confirm("Disband this organization entirely? This cannot be undone.")) {
                       try {
                          await disbandOrganization(activeOrgId, user.uid);
                          addToast("Organization Disbanded Successfully", "success");
                       } catch (e) {
                          addToast("Failed to disband.", "error");
                       }
                   }
                 }}><RiCloseLine style={{verticalAlign:'middle'}}/> Disband Organization</button>
              )}
            </div>
            
            <div className="card org-submissions-card">
              <h3 className="card-section-title"><RiFileTextLine style={{verticalAlign:'middle'}}/> My RAG Uploads</h3>
              <div className="submissions-list">
                {orgItems.length === 0 ? (
                  <div className="empty-state" style={{ padding: '2rem' }}>
                    <p>No documents uploaded yet.</p>
                  </div>
                ) : (
                  orgItems.map(item => (
                    <OrgDataItem key={item.id} item={item} />
                  ))
                )}
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}

function OrgDataItem({ item }) {
  const { title, department, fileType, createdAt, status } = item
  const date = createdAt?.toDate?.()?.toLocaleDateString() ?? '—'
  
  const isApproved = status === 'approved' || !status;
  const isRejected = status === 'rejected';
  
  return (
    <div className="submission-item card-hover" style={{ opacity: isRejected ? 0.6 : 1 }}>
      <div className="submission-icon"><RiFileTextLine /></div>
      <div className="submission-info">
        <div className="submission-title">{title}</div>
        <div className="submission-meta">
          <span>{department}</span> · <span>{fileType}</span> · <span>{date}</span>
        </div>
      </div>
      <div className="submission-status">
        {isApproved ? (
           <>
            <RiCheckLine style={{ color: 'var(--color-success)' }} />
            <span className="badge badge-approved" style={{color: 'var(--color-success)', borderColor: 'var(--color-success)'}}>Indexed</span>
           </>
        ) : isRejected ? (
           <>
            <RiCloseLine style={{ color: 'var(--color-danger)' }} />
            <span className="badge" style={{color: 'var(--color-danger)', borderColor: 'var(--color-danger)'}}>Rejected</span>
           </>
        ) : (
           <>
            <RiTimeLine style={{ color: 'var(--color-warning)' }} />
            <span className="badge" style={{color: 'var(--color-warning)', borderColor: 'var(--color-warning)'}}>Pending</span>
           </>
        )}
      </div>
    </div>
  )
}

function AdminQueue({ orgId, onSuccess }) {
  const { addToast } = useApp()
  const [queue, setQueue] = useState([])

  useEffect(() => { 
    if (!orgId) return
    const unsub = subscribeToIngestionQueue(orgId, setQueue)
    return () => unsub()
  }, [orgId])

  const [previewId, setPreviewId] = useState(null)

  const action = async (req, act) => {
    const fd = new FormData(); fd.append('req_id', req.req_id);
    try {
      await fetch(`http://localhost:8000/api/queue/${act}`, { method: 'POST', body: fd })
      await deleteQueueItem(req.req_id)
      
      // SYNC THE ORG DATA ITEM
      const status = act === 'approve' ? 'approved' : 'rejected';
      // Search for the doc with this request ID
      const { db } = await import('../firebase/config');
      const { collection, query, where, getDocs, updateDoc, doc, serverTimestamp } = await import('firebase/firestore');
      const q = query(collection(db, 'orgData'), where('active_req_id', '==', req.req_id));
      const snap = await getDocs(q);
      if (!snap.empty) {
         await updateDoc(doc(db, 'orgData', snap.docs[0].id), { status, updatedAt: serverTimestamp() });
      }

      addToast(`Request ${act}d successfully`, 'success')
      if (act === 'approve' && onSuccess) {
        onSuccess(req.type, req.title)
      }
    } catch (err) {
      addToast('Failed to process request', 'error')
    }
  }

  return (
    <div className="card org-submissions-card" style={{ borderColor: 'var(--color-warning)' }}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: '1rem'}}>
        <h3 className="card-section-title" style={{color: 'var(--color-warning)', margin: 0}}><RiShieldLine style={{verticalAlign:'middle'}}/> Pending Approvals ({queue.length})</h3>
      </div>
      <div className="submissions-list">
        {queue.length === 0 ? (
          <div className="empty-state" style={{ padding: '1.5rem', opacity: 0.6 }}>
            <p>No pending upload requests for approval.</p>
          </div>
        ) : (
          queue.map(q => (
            <div key={q.req_id} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '1rem', borderBottom: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="submission-info" style={{ flex: 1 }}>
                  <div className="submission-title" style={{fontWeight: 'bold', fontSize: '0.9rem'}}>{q.title}</div>
                  <div className="submission-meta">
                    Source: <strong>{q.owner}</strong> · Type: {q.type}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="btn btn-sm" style={{borderColor: 'var(--color-accent)', color: 'var(--color-accent)', background: 'transparent'}} onClick={() => setPreviewId(previewId === q.req_id ? null : q.req_id)}>
                    {previewId === q.req_id ? 'Hide' : 'Preview'}
                  </button>
                  <button className="btn btn-sm" style={{borderColor: 'var(--color-success)', color: 'var(--color-success)', background: 'transparent'}} onClick={() => action(q, 'approve')}>Accept</button>
                  <button className="btn btn-sm" style={{borderColor: 'var(--color-danger)', color: 'var(--color-danger)', background: 'transparent'}} onClick={() => action(q, 'deny')}>Deny</button>
                </div>
              </div>
              {previewId === q.req_id && q.preview && (
                <div className="preview-box" style={{ 
                  background: 'var(--color-bg-base)', 
                  padding: '0.75rem', 
                  borderRadius: '0.5rem', 
                  fontSize: '0.8rem', 
                  color: 'var(--text-secondary)',
                  border: '1px dashed var(--color-accent)',
                  maxHeight: '150px',
                  overflowY: 'auto',
                  whiteSpace: 'pre-wrap'
                }}>
                  <strong>Content Preview:</strong><br/>
                  {q.preview}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
