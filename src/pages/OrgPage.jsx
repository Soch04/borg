import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useApp } from '../context/AppContext'
import { 
  submitOrgData, subscribeToUserOrgData, 
  createOrganization, joinOrganization, getOrgMembers, subscribeToOrganization, inviteUserToOrg
} from '../firebase/firestore'
import { DEPARTMENTS } from '../data/mockData'
import { RiBuildingLine, RiUpload2Line, RiFileTextLine, RiTimeLine, RiCheckLine, RiCloseLine, RiGroupLine, RiUserAddLine, RiShieldLine, RiInboxArchiveLine } from 'react-icons/ri'
import './OrgPage.css'

export default function OrgPage() {
  const { user, invites, USE_MOCK } = useAuth()
  const { addToast } = useApp()

  if (!user?.orgId && !USE_MOCK) {
    return <OrgOnboarding />
  }

  return <ActiveOrgDashboard />
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
      await createOrganization(user.uid, orgName.trim(), user.email)
      addToast(`Organization "${orgName}" created!`, 'success')
      // Note: AuthContext onSnapshot will catch the user.orgId update and unmount Onboarding.
    } catch (err) {
      addToast('Failed to create organization', 'error')
      setCreating(false)
    }
  }

  const handleJoin = async (orgId) => {
    try {
      await joinOrganization(orgId, user.uid, user.email)
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

function ActiveOrgDashboard() {
  const { user, isOrgAdmin, USE_MOCK } = useAuth()
  const { addToast } = useApp()

  const [org, setOrg] = useState(null)
  const [members, setMembers] = useState([])
  const [orgItems, setOrgItems] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)

  const [form, setForm] = useState({
    title:      '',
    content:    '',
    department: user?.department ?? '',
    fileType:   'text',
  })

  // Load org data + RAG docs
  useEffect(() => {
    if (USE_MOCK || !user?.orgId) return
    const unsubOrg = subscribeToOrganization(user.orgId, setOrg)
    const unsubDocs = subscribeToUserOrgData(user.uid, user.orgId, setOrgItems)
    getOrgMembers(user.orgId).then(setMembers)
    
    return () => { unsubOrg(); unsubDocs() }
  }, [user?.orgId, user?.uid, USE_MOCK])

  const handleInvite = async (e) => {
    e.preventDefault()
    if (!inviteEmail.trim()) return
    setInviting(true)
    try {
      await inviteUserToOrg(user.orgId, inviteEmail.trim())
      addToast(`Invite sent to ${inviteEmail}`, 'success')
      setInviteEmail('')
    } catch (err) {
      addToast('Failed to send invite', 'error')
    } finally {
      setInviting(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.title.trim() || !form.content.trim()) return
    setSubmitting(true)
    try {
      await submitOrgData(user.uid, user.displayName, user.orgId, form)
      addToast('Organizational data uploaded for RAG', 'success')
      setForm({ title: '', content: '', department: user?.department ?? '', fileType: 'text' })
    } catch (err) {
      addToast('Failed to submit data', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page-content">
      <div className="org-page animate-fade-in">
        <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
             <h1><RiBuildingLine style={{ verticalAlign: 'middle', marginRight: '0.5rem' }} /> {org?.name ?? 'Organization'}</h1>
             <p>Manage your Knowledge Base documents and organization members.</p>
          </div>
          <div className="profile-meta-item" style={{ background: 'var(--color-bg-elevated)', padding: '0.5rem 1rem', borderRadius: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {isOrgAdmin ? <><RiShieldLine /> Org Admin</> : <><RiGroupLine /> Org Member</>}
          </div>
        </div>

        <div className="org-grid">
          {/* Submit Data */}
          <div className="card org-form-card">
            <h3 className="card-section-title"><RiUpload2Line style={{verticalAlign:'middle'}}/> Upload Document for RAG</h3>
            <p className="card-section-desc" style={{marginBottom: '1rem'}}>
              Add knowledge to the shared Vector Database so your agent can answer questions using it as exact context.
            </p>
            <form onSubmit={handleSubmit} className="org-form" id="org-data-form">
              <div className="form-group">
                <label className="form-label">Document Title *</label>
                <input
                  className="form-input"
                  placeholder="e.g. Q2 Sales Playbook"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  required
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Department Scope</label>
                  <select
                    className="form-select"
                    value={form.department}
                    onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
                  >
                    <option value="global">Global (Full Org Access)</option>
                    {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Data Type</label>
                  <select
                    className="form-select"
                    value={form.fileType}
                    onChange={e => setForm(f => ({ ...f, fileType: e.target.value }))}
                  >
                    <option value="text">Plain Text / Policy</option>
                    <option value="faq">FAQ / Q&A</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Content *</label>
                <textarea
                  className="form-textarea"
                  placeholder="Paste the raw text of the document here..."
                  value={form.content}
                  onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                  rows={6}
                  required
                />
              </div>

              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'Indexing...' : 'Index Document'}
              </button>
            </form>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* Admin Controls */}
            {isOrgAdmin && (
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
            )}

            {/* Members List */}
            <div className="card org-submissions-card">
              <h3 className="card-section-title"><RiGroupLine style={{verticalAlign:'middle'}}/> Active Members ({members.length})</h3>
              <div className="submissions-list" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                {members.map(m => (
                  <div key={m.uid} className="submission-item" style={{ padding: '0.75rem', display: 'flex', alignItems: 'center' }}>
                    <strong>{m.displayName}</strong> <span style={{color:'var(--text-muted)', marginLeft: '0.5rem'}}>({m.email})</span>
                    {m.orgRole === 'admin' && <span className="badge badge-approved" style={{marginLeft:'auto'}}>Admin</span>}
                  </div>
                ))}
              </div>
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
  const { title, department, fileType, createdAt } = item
  const date = createdAt?.toDate?.()?.toLocaleDateString() ?? '—'
  return (
    <div className="submission-item card-hover">
      <div className="submission-icon"><RiFileTextLine /></div>
      <div className="submission-info">
        <div className="submission-title">{title}</div>
        <div className="submission-meta">
          <span>{department}</span> · <span>{fileType}</span> · <span>{date}</span>
        </div>
      </div>
      <div className="submission-status">
        <RiCheckLine style={{ color: 'var(--color-success)' }} />
        <span className="badge badge-approved">Indexed</span>
      </div>
    </div>
  )
}
