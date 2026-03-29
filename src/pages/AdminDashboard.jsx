import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import {
  DEPARTMENTS
} from '../data/mockData'
import {
  updateOrgDataStatus, getOrgMembers, subscribeToAllOrgInteractions,
  subscribeToBotLogs, runSystemSanitization, updateOrgDepartments,
  subscribeToOrganization, subscribeToOrgData
} from '../firebase/firestore'
import { ingestDocument } from '../lib/rag'
import { db } from '../firebase/config'
import { getDoc, doc } from 'firebase/firestore'
import {
  RiShieldLine, RiArrowLeftRightLine, RiDatabase2Line,
  RiRobot2Line, RiCheckLine, RiCloseLine,
  RiFilterLine, RiGroupLine, RiPulseLine, RiBuildingLine
} from 'react-icons/ri'
import './AdminDashboard.css'

const TABS = [
  { id: 'overview',   label: 'Overview',        icon: RiShieldLine        },
  { id: 'dept-logs',  label: 'Dept Monitor',    icon: RiArrowLeftRightLine },
  { id: 'knowledge',  label: 'Knowledge Base',  icon: RiDatabase2Line     },
  { id: 'agents',     label: 'Agent Network',   icon: RiRobot2Line        },
]

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState('overview')
  const [deptFilter, setDeptFilter] = useState('all')
  const [orgData, setOrgData]       = useState([])
  const [currentOrg, setCurrentOrg]   = useState(null)
  const [members, setMembers]         = useState([])
  const { user, isOrgAdmin } = useAuth()
  const { addToast } = useApp()

  // Real-time Organization fetch
  useEffect(() => {
    if (!user?.orgId) return
    const unsub = subscribeToOrganization(user.orgId, setCurrentOrg)
    return () => unsub()
  }, [user?.orgId])

  // Real-time Organization Knowledge Base fetch
  useEffect(() => {
    if (!user?.orgId) return
    const unsub = subscribeToOrgData(user.orgId, setOrgData)
    return () => unsub()
  }, [user?.orgId])

  // Org members for accurate agent count
  useEffect(() => {
    if (!user?.orgId) return
    getOrgMembers(user.orgId).then(setMembers)
  }, [user?.orgId])

  const handleApproveDoc = async (id) => {
    try {
      // 1. Get the document content from Firestore
      const docSnap = await getDoc(doc(db, 'orgData', id));
      if (!docSnap.exists()) throw new Error('Document not found');
      const docData = docSnap.data();

      // 2. Perform RAG Ingestion with mandatory metadata
      await ingestDocument(user.orgId, {
        id,
        title:      docData.title,
        text:       docData.content || '',
        department: docData.department,
        adminId:    user.uid // "admin_ID tag" as requested
      });

      // 3. Mark as approved in Firestore
      await updateOrgDataStatus(id, 'approved')
      addToast('Document approved & ingested into Org Knowledge Base', 'success')
    } catch (err) {
      console.error('Ingestion error:', err);
      addToast('RAG Ingestion failed: ' + err.message, 'error')
    }
  }

  const handleOrgDataStatus = async (id, status) => {
    try {
      await updateOrgDataStatus(id, status)
      addToast(`Document ${status}`, 'success')
    } catch (err) {
      addToast('Failed to update status', 'error')
    }
  }

  return (
    <div className="page-content">
      <div className="admin-page animate-fade-in">
        {/* Header */}
        <div className="admin-header">
          <div className="admin-badge-wrap">
            <div className="admin-header-icon">
              <RiShieldLine />
            </div>
            <div>
              <h1>Admin Dashboard</h1>
              <p>
                {isOrgAdmin ? 'Global Network Monitor' : `Organization Monitor: ${currentOrg?.name ?? '...'}`}
              </p>
            </div>
          </div>
          <span className="badge badge-approved">
            <span className="badge-dot" />
            Admin Access
          </span>
        </div>

        {/* Tab navigation */}
        <div className="tab-bar admin-tabs" role="tablist">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              id={`admin-tab-${id}`}
              role="tab"
              aria-selected={activeTab === id}
              className={`tab-item ${activeTab === id ? 'active' : ''}`}
              onClick={() => setActiveTab(id)}
            >
              <Icon style={{ marginRight: '0.375rem', verticalAlign: 'middle' }} />
              {label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'overview' && <OverviewTab currentOrg={currentOrg} orgData={orgData} members={members} />}
        {activeTab === 'dept-logs' && (
          <DeptMonitorTab 
            deptFilter={deptFilter} 
            setDeptFilter={setDeptFilter} 
            availableDepts={currentOrg?.departments ?? []}
          />
        )}
        {activeTab === 'knowledge' && (
          <KnowledgeBaseTab 
            orgData={orgData} 
            onApprove={handleApproveDoc} 
            onUpdateStatus={handleOrgDataStatus}
          />
        )}
        {activeTab === 'agents' && <AgentNetworkTab availableDepts={currentOrg?.departments ?? []} />}
      </div>
    </div>
  )
}

/* ── Overview Tab ── */
function OverviewTab({ currentOrg, orgData, members }) {
  const { addToast } = useApp()
  const [newDept, setNewDept] = useState('')

  // ── Real statistics derived from live Firestore data ──
  const totalAgents    = members.length
  const activeAgents   = members.filter(m => m.status === 'active').length
  const pendingDocs    = orgData.filter(d => d.status === 'pending').length
  const approvedDocs   = orgData.filter(d => d.status === 'approved').length
  const deptCount      = (currentOrg?.departments || []).length

  const handleAddDept = async () => {
    if (!newDept.trim() || !currentOrg) return
    const updated = [...(currentOrg.departments || []), newDept.trim()]
    try {
      await updateOrgDepartments(currentOrg.id, updated)
      setNewDept('')
      addToast(`Department '${newDept}' added`, 'success')
    } catch (err) {
      addToast('Failed to add department', 'error')
    }
  }

  const handleRemoveDept = async (dept) => {
    if (!currentOrg) return
    const updated = (currentOrg.departments || []).filter(d => d !== dept)
    try {
      await updateOrgDepartments(currentOrg.id, updated)
      addToast(`Department '${dept}' removed`, 'success')
    } catch (err) {
      addToast('Failed to remove department', 'error')
    }
  }

  return (
    <div className="overview-grid animate-fade-in">
      {[
        { label: 'Total Members',    value: totalAgents,   icon: '🤖', color: 'var(--color-accent)' },
        { label: 'Active Members',   value: activeAgents,  icon: '✅', color: 'var(--color-success)' },
        { label: 'Docs Approved',    value: approvedDocs,  icon: '📚', color: 'var(--color-accent-2)' },
        { label: 'Pending Review',   value: pendingDocs,   icon: '⏳', color: 'var(--color-warning)' },
        { label: 'Departments',      value: deptCount,     icon: '🏢', color: 'var(--color-bot)' },
      ].map(({ label, value, icon, color }) => (
        <div key={label} className="stat-card card card-hover">
          <div className="stat-card-icon" style={{ '--stat-color': color }}>
            {icon}
          </div>
          <div className="stat-card-value">{value.toLocaleString()}</div>
          <div className="stat-card-label">{label}</div>
        </div>
      ))}

      {/* Department Management */}
      <div className="card dept-mgmt-card animate-fade-in">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '1rem' }}>
          <RiBuildingLine style={{ fontSize: '1.25rem', color: 'var(--color-accent)' }} />
          <h3>Department Tags</h3>
        </div>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
          Manage functional groups for your organization. Users select these in their profile.
        </p>

        <div className="dept-tag-manage-ui">
          <div className="dept-tag-list">
            {(currentOrg?.departments || []).length === 0 ? (
              <div className="empty-tag-state">No departments defined.</div>
            ) : (
              currentOrg.departments.map(d => (
                <div key={d} className="dept-tag-item">
                  <span>{d}</span>
                  <button className="tag-remove-btn" onClick={() => handleRemoveDept(d)}>
                    <RiCloseLine />
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="divider" style={{ margin: '1.25rem 0' }} />
          <div className="add-tag-group">
            <input
              className="form-input"
              placeholder="e.g. Engineering"
              value={newDept}
              onChange={e => setNewDept(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddDept()}
            />
            <button className="btn btn-secondary" onClick={handleAddDept}>Add Tag</button>
          </div>
        </div>
      </div>

      {/* Database Sanitization Tool */}
      <div className="card sanitize-card animate-fade-in" style={{ gridColumn: 'span 2' }}>
        <h3>🚀 Database Sanitization</h3>
        <p>Prune all unauthorized user accounts and purge message history. <strong>Irreversible action.</strong></p>
        <button 
          className="btn btn-lg btn-danger" 
          style={{ marginTop: '1.5rem' }}
          onClick={async () => {
             if (window.confirm("CRITICAL: This will delete ALL users (except authorized admins) and purge ALL conversation history. Proceed?")) {
               try {
                 await runSystemSanitization();
                 alert("Sanitization Complete!");
                 window.location.reload();
               } catch (e) {
                 alert("Sanitization failed: " + e.message);
               }
             }
          }}
        >
          Run System Sanitization
        </button>
      </div>
    </div>
  )
}

/* ── Dept Monitor Tab ── */
function DeptMonitorTab({ deptFilter, setDeptFilter, availableDepts }) {
  const [logs, setLogs] = useState([])

  useEffect(() => {
    const unsub = subscribeToBotLogs(deptFilter, setLogs)
    return () => unsub()
  }, [deptFilter])

  return (
    <div className="dept-monitor animate-fade-in">
      <div className="dept-filter-bar">
        <RiFilterLine className="filter-icon" />
        <span className="filter-label">Filter by department:</span>
        <div className="dept-chips">
          <button
            className={`dept-chip ${deptFilter === 'all' ? 'active' : ''}`}
            onClick={() => setDeptFilter('all')}
          >All</button>
          {(availableDepts || DEPARTMENTS).map(dept => (
            <button
              key={dept}
              className={`dept-chip ${deptFilter === dept ? 'active' : ''}`}
              onClick={() => setDeptFilter(dept)}
            >{dept}</button>
          ))}
        </div>
      </div>

      <div className="dept-logs-list">
        {logs.length === 0 ? (
          <div className="empty-state">
            <p>No activity detected.</p>
          </div>
        ) : (
          logs.map((log, i) => (
            <div key={log.id ?? i} className="dept-log-item card">
              <div className="log-item-header">
                <div>{log.senderName} ➔ {log.recipientName}</div>
                <div>{log.department}</div>
              </div>
              <pre className="log-content">{log.content}</pre>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

/* ── Knowledge Base Manager Tab ── */
function KnowledgeBaseTab({ orgData, onApprove, onUpdateStatus }) {
  const [interactions, setInteractions] = useState([])
  const { user } = useAuth()
  const { addToast } = useApp()

  useEffect(() => {
    if (!user?.orgId) return
    const unsub = subscribeToAllOrgInteractions(setInteractions)
    return () => unsub()
  }, [user?.orgId])

  const pending = orgData.filter(d => d.status === 'pending')
  const approved = orgData.filter(d => d.status === 'approved')

  return (
    <div className="kb-tab animate-fade-in">
      <div className="kb-actions-header" style={{ marginBottom: '2rem' }}>
        <button className="btn btn-primary" onClick={() => addToast('Uploader triggered.', 'info')}>
          <RiDatabase2Line style={{ marginRight: '0.5rem' }} /> Universal Upload
        </button>
      </div>

      <h4 className="kb-section-label"><RiPulseLine /> Dynamic RAG Activity feed</h4>
      <div className="kb-interaction-feed">
        {interactions.slice(0, 5).map(item => (
          <div key={item.id} className="interaction-feed-item card">
            <div><strong>{item.sender_name}</strong> requested knowledge</div>
            <div className="interaction-content">"{item.content}"</div>
          </div>
        ))}
      </div>

      <div className="divider" style={{ margin: '2rem 0' }} />

      <h4 className="kb-section-label">⏳ Documents Under Review</h4>
      {pending.length === 0 ? <p>No documents pending review.</p> : pending.map(item => (
        <KBItem key={item.id} item={item} onApprove={onApprove} onReject={() => onUpdateStatus(item.id, 'rejected')} showActions />
      ))}

      <h4 className="kb-section-label">✅ Live Knowledge Base Documents</h4>
      {approved.map(item => (
        <KBItem key={item.id} item={item} />
      ))}
    </div>
  )
}

function KBItem({ item, onApprove, onReject, showActions }) {
  return (
    <div className="kb-item card card-hover" style={{ marginBottom: '1rem' }}>
      <div className="kb-item-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="kb-item-title" style={{ fontWeight: 600 }}>{item.title}</div>
          <div className="kb-item-meta" style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            {item.department} · {item.fileType} · by {item.uploaderName}
          </div>
        </div>
        <div className="kb-item-actions" style={{ display: 'flex', gap: '0.5rem' }}>
          <span className={`badge badge-${item.status}`}>{item.status}</span>
          {showActions && (
            <>
              <button className="btn btn-sm" onClick={() => onApprove(item.id)}><RiCheckLine /> Approve</button>
              <button className="btn btn-sm btn-danger" onClick={onReject}><RiCloseLine /> Reject</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Agent Network Tab ── */
function AgentNetworkTab({ availableDepts }) {
  const { user } = useAuth()
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user?.orgId) return
    getOrgMembers(user.orgId).then(members => {
      setAgents(members)
      setLoading(false)
    })
  }, [user?.orgId])

  return (
    <div className="agent-network animate-fade-in">
      <div className="agent-network-grid">
        {loading ? <div className="spinner" /> : agents.map(agent => (
          <div key={agent.uid} className="agent-network-card card">
             <RiRobot2Line className="agent-network-avatar" />
             <div>{agent.displayName}'s Agent</div>
             <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{agent.department}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
