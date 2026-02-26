'use client';

import { useState } from 'react';
import { getCsrfToken } from '@/lib/csrf';

interface User {
  id: number;
  navn: string;
  epost: string;
  telefon: string | null;
  aktiv: boolean;
  rolle: string;
}

interface Props {
  users: User[];
  currentUserId: number;
  isCurrentUserAdmin: boolean;
  maxBrukere: number;
}

export function BrukereManager({ users: initialUsers, currentUserId, isCurrentUserAdmin, maxBrukere }: Props) {
  const [users] = useState<User[]>(initialUsers);
  const activeCount = users.filter(u => u.aktiv).length;

  // Invite modal state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteNavn, setInviteNavn] = useState('');
  const [inviteEpost, setInviteEpost] = useState('');
  const [inviteTelefon, setInviteTelefon] = useState('');
  const [invitePassord, setInvitePassord] = useState('');
  const [inviteRolle, setInviteRolle] = useState('leser');
  const [inviteError, setInviteError] = useState('');

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editUserId, setEditUserId] = useState<number | null>(null);
  const [editNavn, setEditNavn] = useState('');
  const [editEpost, setEditEpost] = useState('');
  const [editTelefon, setEditTelefon] = useState('');
  const [editPassord, setEditPassord] = useState('');
  const [editRolle, setEditRolle] = useState('leser');
  const [editError, setEditError] = useState('');

  function openInviteModal() {
    setInviteNavn('');
    setInviteEpost('');
    setInviteTelefon('');
    setInvitePassord('');
    setInviteRolle('leser');
    setInviteError('');
    setShowInviteModal(true);
  }

  function closeInviteModal() {
    setShowInviteModal(false);
    setInviteError('');
  }

  function openEditModal(u: User) {
    setEditUserId(u.id);
    setEditNavn(u.navn);
    setEditEpost(u.epost);
    setEditTelefon(u.telefon || '');
    setEditPassord('');
    setEditRolle(u.rolle || 'leser');
    setEditError('');
    setShowEditModal(true);
  }

  function closeEditModal() {
    setShowEditModal(false);
    setEditError('');
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError('');

    try {
      const res = await fetch('/api/dashboard/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
        body: JSON.stringify({
          navn: inviteNavn,
          epost: inviteEpost,
          telefon: inviteTelefon || undefined,
          passord: invitePassord,
          rolle: inviteRolle,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        setInviteError(result.error || 'Noe gikk galt');
        return;
      }

      window.location.reload();
    } catch {
      setInviteError('Nettverksfeil. Prøv igjen.');
    }
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    setEditError('');

    const data: Record<string, any> = {
      navn: editNavn,
      epost: editEpost,
      telefon: editTelefon,
    };

    if (editPassord) data.passord = editPassord;
    if (isCurrentUserAdmin) data.rolle = editRolle;

    try {
      const res = await fetch(`/api/dashboard/users/${editUserId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
        body: JSON.stringify(data),
      });

      const result = await res.json();

      if (!res.ok) {
        setEditError(result.error || 'Noe gikk galt');
        return;
      }

      window.location.reload();
    } catch {
      setEditError('Nettverksfeil. Prøv igjen.');
    }
  }

  async function toggleUserStatus(userId: number, isActive: boolean) {
    const action = isActive ? 'deaktivere' : 'aktivere';
    if (!confirm(`Er du sikker på at du vil ${action} denne brukeren?`)) return;

    try {
      const res = await fetch(`/api/dashboard/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
        body: JSON.stringify({ aktiv: !isActive }),
      });

      if (!res.ok) {
        const result = await res.json();
        alert(result.error || 'Noe gikk galt');
        return;
      }

      window.location.reload();
    } catch {
      alert('Nettverksfeil. Prøv igjen.');
    }
  }

  function getInitials(name: string): string {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  }

  function rolleLabel(rolle: string): string {
    if (rolle === 'admin') return 'Admin';
    if (rolle === 'redigerer') return 'Redigerer';
    return 'Leser';
  }

  function rolleBadgeClass(rolle: string): string {
    if (rolle === 'admin') return 'bg-purple-500/10 text-purple-400';
    if (rolle === 'redigerer') return 'bg-blue-500/10 text-blue-400';
    return 'bg-dark-600/50 text-dark-400';
  }

  return (
    <>
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">Brukere</h1>
          <p className="text-dark-400">
            {activeCount} av {maxBrukere} brukerplasser i bruk
          </p>
        </div>
        {isCurrentUserAdmin && (
          <button
            onClick={openInviteModal}
            className="btn-primary"
            disabled={activeCount >= maxBrukere}
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
            Inviter bruker
          </button>
        )}
      </div>

      {/* User Limit Warning */}
      {activeCount >= maxBrukere && (
        <div className="glass-card p-4 mb-6 border-yellow-500/30 flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-yellow-500/10 flex items-center justify-center text-yellow-400 flex-shrink-0">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-white font-medium">Brukergrensen er nådd</p>
            <p className="text-sm text-dark-400">
              Oppgrader til en høyere plan for å legge til flere brukere.
            </p>
          </div>
          <a href="/dashboard/abonnement" className="btn-secondary text-sm px-4 py-2">
            Oppgrader
          </a>
        </div>
      )}

      {/* Users Table */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-dark-700/50">
                <th scope="col" className="text-left p-4 text-sm font-medium text-dark-300">Navn</th>
                <th scope="col" className="text-left p-4 text-sm font-medium text-dark-300">E-post</th>
                <th scope="col" className="text-left p-4 text-sm font-medium text-dark-300 hidden sm:table-cell">Telefon</th>
                <th scope="col" className="text-left p-4 text-sm font-medium text-dark-300">Rolle</th>
                <th scope="col" className="text-left p-4 text-sm font-medium text-dark-300">Status</th>
                <th scope="col" className="text-right p-4 text-sm font-medium text-dark-300">Handlinger</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-b border-dark-700/50 hover:bg-dark-800/30">
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-accent-purple flex items-center justify-center">
                        <span className="text-xs font-semibold text-white">
                          {getInitials(u.navn)}
                        </span>
                      </div>
                      <span className="text-white font-medium">{u.navn}</span>
                      {u.id === currentUserId && (
                        <span className="text-xs text-dark-400">(deg)</span>
                      )}
                    </div>
                  </td>
                  <td className="p-4 text-dark-300">{u.epost}</td>
                  <td className="p-4 text-dark-300 hidden sm:table-cell">{u.telefon || '-'}</td>
                  <td className="p-4">
                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${rolleBadgeClass(u.rolle)}`}>
                      {rolleLabel(u.rolle)}
                    </span>
                  </td>
                  <td className="p-4">
                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                      u.aktiv ? 'bg-green-500/10 text-green-400' : 'bg-dark-600/50 text-dark-400'
                    }`}>
                      {u.aktiv ? 'Aktiv' : 'Deaktivert'}
                    </span>
                  </td>
                  <td className="p-4 text-right">
                    {isCurrentUserAdmin && (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEditModal(u)}
                          className="p-2 text-dark-400 hover:text-white hover:bg-dark-700/50 rounded-lg transition-colors"
                          title="Rediger"
                          aria-label="Rediger"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        {u.id !== currentUserId && (
                          <button
                            onClick={() => toggleUserStatus(u.id, u.aktiv)}
                            className="p-2 text-dark-400 hover:text-yellow-400 hover:bg-dark-700/50 rounded-lg transition-colors"
                            title={u.aktiv ? 'Deaktiver' : 'Aktiver'}
                            aria-label={u.aktiv ? 'Deaktiver' : 'Aktiver'}
                          >
                            {u.aktiv ? (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                              </svg>
                            ) : (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            )}
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invite User Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="invite-modal-title">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={closeInviteModal} />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="glass-card w-full max-w-md p-6 relative">
              <button onClick={closeInviteModal} className="absolute top-4 right-4 text-dark-400 hover:text-white" aria-label="Lukk">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              <h2 id="invite-modal-title" className="text-xl font-bold text-white mb-6">Inviter ny bruker</h2>

              <form onSubmit={handleInvite} className="space-y-4">
                <div>
                  <label className="input-label" htmlFor="invite-navn">Navn *</label>
                  <input type="text" id="invite-navn" className="input" required value={inviteNavn} onChange={e => setInviteNavn(e.target.value)} />
                </div>
                <div>
                  <label className="input-label" htmlFor="invite-epost">E-post *</label>
                  <input type="email" id="invite-epost" className="input" required value={inviteEpost} onChange={e => setInviteEpost(e.target.value)} />
                </div>
                <div>
                  <label className="input-label" htmlFor="invite-telefon">Telefon</label>
                  <input type="tel" id="invite-telefon" className="input" value={inviteTelefon} onChange={e => setInviteTelefon(e.target.value)} />
                </div>
                <div>
                  <label className="input-label" htmlFor="invite-passord">Midlertidig passord *</label>
                  <input type="password" id="invite-passord" className="input" minLength={8} required value={invitePassord} onChange={e => setInvitePassord(e.target.value)} />
                  <p className="text-xs text-dark-400 mt-1">Minst 8 tegn. Brukeren kan endre dette senere.</p>
                </div>
                {isCurrentUserAdmin && (
                  <div>
                    <label className="input-label" htmlFor="invite-rolle">Rolle</label>
                    <select id="invite-rolle" className="input" value={inviteRolle} onChange={e => setInviteRolle(e.target.value)}>
                      <option value="leser">Leser</option>
                      <option value="redigerer">Redigerer</option>
                      <option value="admin">Admin</option>
                    </select>
                    <p className="text-xs text-dark-400 mt-1">Leser kan kun se data. Redigerer kan opprette og endre. Admin har full tilgang.</p>
                  </div>
                )}

                {inviteError && (
                  <div className="form-error" role="alert" aria-live="assertive">{inviteError}</div>
                )}

                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={closeInviteModal} className="btn-secondary flex-1">Avbryt</button>
                  <button type="submit" className="btn-primary flex-1">Opprett bruker</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="edit-modal-title">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={closeEditModal} />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="glass-card w-full max-w-md p-6 relative">
              <button onClick={closeEditModal} className="absolute top-4 right-4 text-dark-400 hover:text-white" aria-label="Lukk">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              <h2 id="edit-modal-title" className="text-xl font-bold text-white mb-6">Rediger bruker</h2>

              <form onSubmit={handleEdit} className="space-y-4">
                <div>
                  <label className="input-label" htmlFor="edit-navn">Navn *</label>
                  <input type="text" id="edit-navn" className="input" required value={editNavn} onChange={e => setEditNavn(e.target.value)} />
                </div>
                <div>
                  <label className="input-label" htmlFor="edit-epost">E-post *</label>
                  <input type="email" id="edit-epost" className="input" required value={editEpost} onChange={e => setEditEpost(e.target.value)} />
                </div>
                <div>
                  <label className="input-label" htmlFor="edit-telefon">Telefon</label>
                  <input type="tel" id="edit-telefon" className="input" value={editTelefon} onChange={e => setEditTelefon(e.target.value)} />
                </div>
                <div>
                  <label className="input-label" htmlFor="edit-passord">Nytt passord (valgfritt)</label>
                  <input type="password" id="edit-passord" className="input" minLength={8} value={editPassord} onChange={e => setEditPassord(e.target.value)} />
                  <p className="text-xs text-dark-400 mt-1">La feltet være tomt for å beholde eksisterende passord.</p>
                </div>
                {isCurrentUserAdmin && (
                  <div>
                    <label className="input-label" htmlFor="edit-rolle">Rolle</label>
                    <select id="edit-rolle" className="input" value={editRolle} onChange={e => setEditRolle(e.target.value)}>
                      <option value="leser">Leser</option>
                      <option value="redigerer">Redigerer</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                )}

                {editError && (
                  <div className="form-error" role="alert" aria-live="assertive">{editError}</div>
                )}

                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={closeEditModal} className="btn-secondary flex-1">Avbryt</button>
                  <button type="submit" className="btn-primary flex-1">Lagre endringer</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
