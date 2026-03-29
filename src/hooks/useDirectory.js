/**
 * useDirectory.js
 * Fetches + caches the org member directory from Firestore.
 * Only loads once per session — no reads on every keystroke.
 */
import { useState, useEffect, useRef } from 'react'
import { getOrgDirectory } from '../firebase/firestore'
import { USE_MOCK } from '../context/AppConfig'
import { MOCK_ALL_AGENTS } from '../data/mockData'

// Module-level cache so it survives component re-mounts within a session
let _cache = null
let _cacheOrgId = null // track the orgId cached

export function useDirectory(orgId) {
  const [members, setMembers] = useState((_cacheOrgId === orgId && _cache) ? _cache : [])
  const [loading, setLoading] = useState(true)
  const fetched = useRef(!!_cache)

  useEffect(() => {
    if (fetched.current) return   // already loaded this session
    fetched.current = true

    if (USE_MOCK) {
      const mockDir = (MOCK_ALL_AGENTS ?? []).map((a, i) => ({
        uid:         `mock-${i}`,
        displayName: a.displayName?.replace(/'s Agent$/, '') ?? `User ${i}`,
        email:       `user${i}@borg.org`,
        department:  a.department ?? '',
        avatar:      a.displayName?.[0]?.toUpperCase() ?? '?',
      }))
      _cache = mockDir
      _cacheOrgId = orgId
      setMembers(mockDir)
      setLoading(false)
      return
    }

    if (!orgId) {
       setMembers([])
       setLoading(false)
       return
    }

    getOrgDirectory(orgId)
      .then(docs => {
        const dir = docs.map(d => ({
          uid:         d.uid,
          displayName: d.displayName ?? d.email,
          email:       d.email,
          department:  d.department ?? '',
          avatar:      (d.displayName ?? d.email)?.[0]?.toUpperCase() ?? '?',
        }))
        _cacheOrgId = orgId
        setMembers(dir)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [orgId])

  /** Filter members by a partial name/email query (case-insensitive) */
  const search = (query) => {
    if (!query) return members
    const q = query.toLowerCase()
    return members.filter(m =>
      m.displayName.toLowerCase().includes(q) ||
      m.email.toLowerCase().includes(q)
    )
  }

  return { members, loading, search }
}
