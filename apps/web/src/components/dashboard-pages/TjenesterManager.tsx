'use client';

import { useState, useEffect, useCallback } from 'react';
import { getCsrfToken } from '@/lib/csrf';

interface ServiceType {
  id: number;
  name: string;
  icon: string;
  color: string;
  default_interval_months: number;
  description?: string;
  source?: string;
}

const ICONS = [
  'fa-wrench', 'fa-bolt', 'fa-fire', 'fa-fan',
  'fa-faucet', 'fa-shield-alt', 'fa-thermometer-half', 'fa-building',
  'fa-solar-panel', 'fa-tools', 'fa-hard-hat', 'fa-plug',
  'fa-tractor', 'fa-home', 'fa-cog', 'fa-check-circle',
];

interface Props {
  isAdmin: boolean;
}

function sourceLabel(source?: string): string {
  if (source === 'template') return 'Bransjemal';
  if (source === 'tripletex') return 'Tripletex';
  return 'Manuell';
}

function intervalLabel(months: number): string {
  if (months < 12) return `${months} mnd`;
  if (months === 12) return '1 år';
  if (months % 12 === 0) return `${months / 12} år`;
  return `${months} mnd`;
}

export function TjenesterManager({ isAdmin }: Props) {
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [fieldName, setFieldName] = useState('');
  const [fieldColor, setFieldColor] = useState('#5E81AC');
  const [fieldInterval, setFieldInterval] = useState(12);
  const [fieldIcon, setFieldIcon] = useState('fa-wrench');
  const [fieldDescription, setFieldDescription] = useState('');
  const [saving, setSaving] = useState(false);

  function getHeaders(includeCsrf = false) {
    return {
      'Content-Type': 'application/json',
      ...(includeCsrf ? { 'X-CSRF-Token': getCsrfToken() } : {}),
    };
  }

  const loadServiceTypes = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/app/service-types', {
        headers: getHeaders(),
        credentials: 'include',
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || data.error || 'Feil ved lasting');

      setServiceTypes(data.data || []);
    } catch (err: any) {
      setError(err.message || 'Kunne ikke laste tjenestekategorier.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadServiceTypes();
  }, [loadServiceTypes]);

  // Escape key handler
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && showModal) closeModal();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showModal]);

  function openModal(st?: ServiceType) {
    setEditingId(st ? st.id : null);
    setFieldName(st ? st.name : '');
    setFieldColor(st ? st.color : '#5E81AC');
    setFieldInterval(st ? st.default_interval_months : 12);
    setFieldIcon(st ? st.icon : 'fa-wrench');
    setFieldDescription(st ? (st.description || '') : '');
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingId(null);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const name = fieldName.trim();
    if (!name) return;

    const body = {
      name,
      icon: fieldIcon,
      color: fieldColor,
      default_interval_months: fieldInterval,
      description: fieldDescription.trim() || undefined,
    };

    setSaving(true);
    try {
      const url = editingId
        ? `/api/app/service-types/${editingId}`
        : '/api/app/service-types';
      const method = editingId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: getHeaders(true),
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || data.error || 'Kunne ikke lagre');

      closeModal();
      await loadServiceTypes();
    } catch (err: any) {
      alert(err.message || 'Feil ved lagring');
    } finally {
      setSaving(false);
    }
  }

  async function deleteServiceType(id: number, name: string) {
    if (!confirm(`Slett "${name}"? Kategorien fjernes fra kartvisningen.`)) return;

    try {
      const res = await fetch(`/api/app/service-types/${id}`, {
        method: 'DELETE',
        headers: getHeaders(true),
        credentials: 'include',
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || data.error || 'Kunne ikke slette');
      await loadServiceTypes();
    } catch (err: any) {
      alert(err.message || 'Feil ved sletting');
    }
  }

  return (
    <>
      {/* Service Types Section */}
      <div className="glass-card p-6 mb-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-white mb-1">Tjenestekategorier</h2>
            <p className="text-dark-400 text-sm">
              Definer hvilke typer tjenester din bedrift utfører. Disse brukes for filtrering, kartmarkører og kontrollintervaller.
            </p>
          </div>
          {isAdmin && (
            <button onClick={() => openModal()} className="btn btn-primary text-sm">
              <i className="fas fa-plus mr-1.5" /> Legg til
            </button>
          )}
        </div>

        {/* Loading state */}
        {loading && (
          <div className="text-center py-12">
            <div className="inline-block w-8 h-8 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin mb-3" />
            <p className="text-dark-400 text-sm">Laster tjenestekategorier...</p>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && serviceTypes.length === 0 && (
          <div className="text-center py-12">
            <div className="w-16 h-16 rounded-full bg-dark-700/50 flex items-center justify-center mx-auto mb-4">
              <i className="fas fa-tags text-2xl text-dark-500" />
            </div>
            <h3 className="text-white font-medium mb-2">Ingen tjenestekategorier</h3>
            <p className="text-dark-400 text-sm mb-4">
              Opprett din første tjenestekategori, eller importer fra en bransjemal.
            </p>
            {isAdmin && (
              <button onClick={() => openModal()} className="btn btn-primary text-sm">
                <i className="fas fa-plus mr-1.5" /> Legg til kategori
              </button>
            )}
          </div>
        )}

        {/* Service types table */}
        {!loading && !error && serviceTypes.length > 0 && (
          <div>
            <table className="w-full">
              <thead>
                <tr className="border-b border-dark-700 text-dark-400 text-xs uppercase tracking-wider">
                  <th className="text-left pb-3 pl-2">Farge</th>
                  <th className="text-left pb-3">Navn</th>
                  <th className="text-left pb-3">Ikon</th>
                  <th className="text-left pb-3">Intervall</th>
                  <th className="text-left pb-3">Kilde</th>
                  {isAdmin && <th className="text-right pb-3 pr-2">Handlinger</th>}
                </tr>
              </thead>
              <tbody>
                {serviceTypes.map(st => (
                  <tr key={st.id} className="border-b border-dark-700/50 hover:bg-dark-700/20 transition-colors">
                    <td className="py-3 pl-2">
                      <div className="w-8 h-8 rounded-full" style={{ background: st.color }} />
                    </td>
                    <td className="py-3">
                      <span className="text-white font-medium">{st.name}</span>
                      {st.description && (
                        <span className="block text-dark-400 text-xs mt-0.5">{st.description}</span>
                      )}
                    </td>
                    <td className="py-3">
                      <i className={`fas ${st.icon} text-dark-300`} />
                    </td>
                    <td className="py-3 text-dark-300 text-sm">{intervalLabel(st.default_interval_months)}</td>
                    <td className="py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        st.source === 'tripletex' ? 'bg-blue-500/10 text-blue-400' :
                        st.source === 'template' ? 'bg-green-500/10 text-green-400' :
                        'bg-dark-600/50 text-dark-300'
                      }`}>
                        {sourceLabel(st.source)}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="py-3 pr-2 text-right">
                        <button
                          onClick={() => openModal(st)}
                          className="text-dark-400 hover:text-white p-1.5 transition-colors"
                          title="Rediger"
                        >
                          <i className="fas fa-pen text-xs" />
                        </button>
                        <button
                          onClick={() => deleteServiceType(st.id, st.name)}
                          className="text-dark-400 hover:text-red-400 p-1.5 transition-colors"
                          title="Slett"
                        >
                          <i className="fas fa-trash text-xs" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Error state */}
        {!loading && error && (
          <div className="text-center py-8" role="alert" aria-live="assertive">
            <p className="text-red-400 text-sm mb-3">{error}</p>
            <button onClick={loadServiceTypes} className="btn btn-secondary text-sm">Prøv igjen</button>
          </div>
        )}
      </div>

      {/* Info box */}
      <div className="glass-card p-6 border-l-4 border-l-blue-500/50">
        <h3 className="text-white font-medium mb-2">
          <i className="fas fa-info-circle text-blue-400 mr-2" />Om tjenestekategorier
        </h3>
        <ul className="text-dark-400 text-sm space-y-1.5">
          <li>Kategorier brukes til å filtrere kunder på kartet og i kundelisten.</li>
          <li>Hver kategori får sin egen farge på kartmarkørene.</li>
          <li>Når du synkroniserer fra Tripletex, opprettes kategorier automatisk fra kundekategoriene.</li>
          <li>Standard kontrollintervall brukes som forslag ved opprettelse av nye kunder.</li>
        </ul>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div className="bg-dark-800 border border-dark-700 rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
            <h3 id="modal-title" className="text-lg font-semibold text-white mb-6">
              {editingId ? 'Rediger tjenestekategori' : 'Ny tjenestekategori'}
            </h3>
            <form onSubmit={handleSave} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-dark-300 mb-1.5">Navn *</label>
                <input
                  type="text"
                  className="input w-full"
                  placeholder="F.eks. VVS, Ventilasjon, El-kontroll..."
                  required
                  maxLength={100}
                  value={fieldName}
                  onChange={e => setFieldName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-dark-300 mb-1.5">Farge</label>
                  <input
                    type="color"
                    className="w-full h-10 rounded-lg cursor-pointer bg-dark-700 border border-dark-600"
                    value={fieldColor}
                    onChange={e => setFieldColor(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-dark-300 mb-1.5">Intervall (mnd)</label>
                  <select
                    className="input w-full"
                    value={fieldInterval}
                    onChange={e => setFieldInterval(parseInt(e.target.value, 10))}
                  >
                    <option value={6}>6 måneder</option>
                    <option value={12}>1 år</option>
                    <option value={24}>2 år</option>
                    <option value={36}>3 år</option>
                    <option value={48}>4 år</option>
                    <option value={60}>5 år</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-dark-300 mb-1.5">Ikon</label>
                <div className="grid grid-cols-8 gap-2">
                  {ICONS.map(icon => (
                    <button
                      key={icon}
                      type="button"
                      onClick={() => setFieldIcon(icon)}
                      className={`p-2 rounded-lg bg-dark-700/50 border border-dark-600 hover:bg-dark-600/50 transition-colors ${
                        fieldIcon === icon
                          ? 'ring-2 ring-primary-500 text-white'
                          : 'text-dark-300 hover:text-white'
                      }`}
                    >
                      <i className={`fas ${icon}`} />
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-dark-300 mb-1.5">Beskrivelse (valgfritt)</label>
                <input
                  type="text"
                  className="input w-full"
                  placeholder="Kort beskrivelse av tjenesten..."
                  value={fieldDescription}
                  onChange={e => setFieldDescription(e.target.value)}
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={closeModal} className="btn btn-secondary">Avbryt</button>
                <button type="submit" disabled={saving} className="btn btn-primary">
                  {saving ? (
                    <><i className="fas fa-spinner fa-spin mr-1.5" /> Lagrer...</>
                  ) : (
                    <><i className="fas fa-save mr-1.5" /> Lagre</>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
