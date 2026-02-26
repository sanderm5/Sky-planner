'use client';

import { useState, useEffect, useCallback } from 'react';
import { getCsrfToken } from '@/lib/csrf';

interface Subcategory {
  id: number;
  navn: string;
}

interface Group {
  id: number;
  navn: string;
  subcategories: Subcategory[];
}

interface Props {
  isAdmin: boolean;
}

export function KategorierManager({ isAdmin }: Props) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [newSubcatNames, setNewSubcatNames] = useState<Record<number, string>>({});

  function getHeaders(includeCsrf = false) {
    return {
      'Content-Type': 'application/json',
      ...(includeCsrf ? { 'X-CSRF-Token': getCsrfToken() } : {}),
    };
  }

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/app/subcategories/groups', {
        headers: getHeaders(),
        credentials: 'include',
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || data.error || 'Feil ved lasting');

      setGroups(data.data || []);
    } catch (err: any) {
      setError(err.message || 'Kunne ikke laste underkategorier.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function addGroup() {
    const navn = newGroupName.trim();
    if (!navn) return;

    try {
      const res = await fetch('/api/app/subcategories/groups', {
        method: 'POST',
        headers: getHeaders(true),
        credentials: 'include',
        body: JSON.stringify({ navn }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || data.error || 'Kunne ikke opprette gruppe');
      setNewGroupName('');
      await loadData();
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function editGroup(groupId: number, currentName: string) {
    const newName = prompt('Nytt navn for gruppen:', currentName);
    if (!newName || newName.trim() === currentName) return;

    try {
      const res = await fetch(`/api/app/subcategories/groups/${groupId}`, {
        method: 'PUT',
        headers: getHeaders(true),
        credentials: 'include',
        body: JSON.stringify({ navn: newName.trim() }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || data.error || 'Kunne ikke oppdatere gruppe');
      await loadData();
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function deleteGroup(groupId: number, navn: string) {
    if (!confirm(`Slett gruppen "${navn}"? Alle underkategorier i gruppen slettes også.`)) return;

    try {
      const res = await fetch(`/api/app/subcategories/groups/${groupId}`, {
        method: 'DELETE',
        headers: getHeaders(true),
        credentials: 'include',
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || data.error || 'Kunne ikke slette gruppe');
      await loadData();
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function addSubcat(groupId: number) {
    const navn = (newSubcatNames[groupId] || '').trim();
    if (!navn) return;

    try {
      const res = await fetch('/api/app/subcategories/items', {
        method: 'POST',
        headers: getHeaders(true),
        credentials: 'include',
        body: JSON.stringify({ group_id: groupId, navn }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || data.error || 'Kunne ikke opprette underkategori');
      setNewSubcatNames(prev => ({ ...prev, [groupId]: '' }));
      await loadData();
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function editSubcat(subcatId: number, currentName: string) {
    const newName = prompt('Nytt navn:', currentName);
    if (!newName || newName.trim() === currentName) return;

    try {
      const res = await fetch(`/api/app/subcategories/items/${subcatId}`, {
        method: 'PUT',
        headers: getHeaders(true),
        credentials: 'include',
        body: JSON.stringify({ navn: newName.trim() }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || data.error || 'Kunne ikke oppdatere underkategori');
      await loadData();
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function deleteSubcat(subcatId: number, navn: string) {
    if (!confirm(`Slett underkategorien "${navn}"?`)) return;

    try {
      const res = await fetch(`/api/app/subcategories/items/${subcatId}`, {
        method: 'DELETE',
        headers: getHeaders(true),
        credentials: 'include',
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || data.error || 'Kunne ikke slette underkategori');
      await loadData();
    } catch (err: any) {
      alert(err.message);
    }
  }

  function handleSubcatInputKeyDown(e: React.KeyboardEvent, groupId: number) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addSubcat(groupId);
    }
  }

  function handleGroupInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addGroup();
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="inline-block w-8 h-8 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin mb-3" />
        <p className="text-dark-400 text-sm">Laster underkategorier...</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="text-center py-8" role="alert" aria-live="assertive">
        <p className="text-red-400 text-sm mb-3">{error}</p>
        <button onClick={loadData} className="btn btn-secondary text-sm">Prøv igjen</button>
      </div>
    );
  }

  const subcatCount = groups.reduce((sum, g) => sum + (g.subcategories ? g.subcategories.length : 0), 0);

  return (
    <>
      {/* Empty state */}
      {groups.length === 0 && !isAdmin && (
        <div className="glass-card p-6 text-center py-12">
          <div className="w-16 h-16 rounded-full bg-dark-700/50 flex items-center justify-center mx-auto mb-4">
            <i className="fas fa-tags text-2xl text-dark-500" />
          </div>
          <h3 className="text-white font-medium mb-2">Ingen underkategori-grupper</h3>
          <p className="text-dark-400 text-sm mb-4">Opprett en gruppe for å komme i gang med underkategorier.</p>
        </div>
      )}

      {/* Main content */}
      <div className="space-y-6">
        {(groups.length > 0 || isAdmin) && (
          <div className="glass-card p-6">
            {groups.length > 0 && (
              <>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-white font-semibold">Underkategorier</h3>
                    <p className="text-dark-400 text-xs">
                      {groups.length} {groups.length === 1 ? 'gruppe' : 'grupper'}, {subcatCount} {subcatCount === 1 ? 'underkategori' : 'underkategorier'}
                    </p>
                  </div>
                </div>

                {groups.map(group => (
                  <div key={group.id} className="ml-2 mb-4 border-l-2 border-dark-600 pl-4">
                    <div className="flex items-center gap-2 mb-2">
                      <i className="fas fa-folder text-dark-500 text-xs" />
                      <span className="text-white text-sm font-medium">{group.navn}</span>
                      <span className="text-dark-500 text-xs">({group.subcategories ? group.subcategories.length : 0})</span>
                      {isAdmin && (
                        <>
                          <button
                            onClick={() => editGroup(group.id, group.navn)}
                            className="text-dark-400 hover:text-white p-1 transition-colors"
                            title="Gi nytt navn"
                          >
                            <i className="fas fa-pen text-xs" />
                          </button>
                          <button
                            onClick={() => deleteGroup(group.id, group.navn)}
                            className="text-dark-400 hover:text-red-400 p-1 transition-colors"
                            title="Slett gruppe"
                          >
                            <i className="fas fa-trash text-xs" />
                          </button>
                        </>
                      )}
                    </div>

                    {group.subcategories && group.subcategories.length > 0 ? (
                      group.subcategories.map(sub => (
                        <div key={sub.id} className="flex items-center gap-2 ml-4 py-1 group">
                          <span className="w-1.5 h-1.5 rounded-full bg-dark-500" />
                          <span className="text-dark-300 text-sm">{sub.navn}</span>
                          {isAdmin && (
                            <>
                              <button
                                onClick={() => editSubcat(sub.id, sub.navn)}
                                className="text-dark-400 hover:text-white p-1 transition-colors opacity-0 group-hover:opacity-100"
                                title="Gi nytt navn"
                              >
                                <i className="fas fa-pen text-xs" />
                              </button>
                              <button
                                onClick={() => deleteSubcat(sub.id, sub.navn)}
                                className="text-dark-400 hover:text-red-400 p-1 transition-colors opacity-0 group-hover:opacity-100"
                                title="Slett"
                              >
                                <i className="fas fa-trash text-xs" />
                              </button>
                            </>
                          )}
                        </div>
                      ))
                    ) : (
                      <p className="ml-4 text-dark-500 text-xs italic py-1">Ingen underkategorier ennå</p>
                    )}

                    {isAdmin && (
                      <div className="flex gap-2 ml-4 mt-2">
                        <input
                          type="text"
                          placeholder="Ny underkategori..."
                          className="input text-sm flex-1 py-1.5 px-3"
                          maxLength={100}
                          value={newSubcatNames[group.id] || ''}
                          onChange={e => setNewSubcatNames(prev => ({ ...prev, [group.id]: e.target.value }))}
                          onKeyDown={e => handleSubcatInputKeyDown(e, group.id)}
                        />
                        <button
                          onClick={() => addSubcat(group.id)}
                          className="btn btn-primary text-xs py-1.5 px-3"
                        >
                          <i className="fas fa-plus mr-1" /> Legg til
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}

            {/* Add new group form */}
            {isAdmin && (
              <div className={groups.length > 0 ? 'mt-2 pt-4 border-t border-dark-700/50' : ''}>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Ny gruppe..."
                    className="input text-sm flex-1 py-1.5 px-3"
                    maxLength={100}
                    value={newGroupName}
                    onChange={e => setNewGroupName(e.target.value)}
                    onKeyDown={handleGroupInputKeyDown}
                  />
                  <button onClick={addGroup} className="btn btn-secondary text-xs py-1.5 px-3">
                    <i className="fas fa-plus mr-1" /> Ny gruppe
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Info box */}
      <div className="glass-card p-6 border-l-4 border-l-blue-500/50 mt-6">
        <h3 className="text-white font-medium mb-2">
          <i className="fas fa-info-circle text-blue-400 mr-2" />Om underkategorier
        </h3>
        <ul className="text-dark-400 text-sm space-y-1.5">
          <li>Underkategorier lar deg gruppere og filtrere kunder.</li>
          <li>Eksempel: Gruppen &quot;Bygningstype&quot; med verdiene &quot;Bolig&quot;, &quot;Næring&quot;, &quot;Landbruk&quot;.</li>
          <li>Underkategorier brukes til filtrering i appen og vises i kundeskjemaet.</li>
          <li>Hver kunde kan ha en verdi per gruppe.</li>
        </ul>
      </div>
    </>
  );
}
