'use client';

import { useState, type FormEvent } from 'react';

export default function ContactForm() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formMessage, setFormMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);
    setFormMessage(null);

    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData);

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (response.ok) {
        setFormMessage({ type: 'success', text: 'Takk for din henvendelse! Vi tar kontakt snart.' });
        (e.target as HTMLFormElement).reset();
      } else {
        throw new Error(result.error || 'Noe gikk galt');
      }
    } catch (error) {
      setFormMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Noe gikk galt',
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid sm:grid-cols-2 gap-6">
        <div>
          <label htmlFor="navn" className="input-label">Navn *</label>
          <input
            type="text"
            id="navn"
            name="navn"
            required
            className="input"
            placeholder="Ditt navn"
          />
        </div>
        <div>
          <label htmlFor="epost" className="input-label">E-post *</label>
          <input
            type="email"
            id="epost"
            name="epost"
            required
            className="input"
            placeholder="din@epost.no"
          />
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-6">
        <div>
          <label htmlFor="telefon" className="input-label">Telefon</label>
          <input
            type="tel"
            id="telefon"
            name="telefon"
            className="input"
            placeholder="+47 xxx xx xxx"
          />
        </div>
        <div>
          <label htmlFor="bedrift" className="input-label">Bedrift</label>
          <input
            type="text"
            id="bedrift"
            name="bedrift"
            className="input"
            placeholder="Bedriftsnavn"
          />
        </div>
      </div>

      <div>
        <label htmlFor="emne" className="input-label">Hva gjelder henvendelsen? *</label>
        <select id="emne" name="emne" required className="input">
          <option value="">Velg emne...</option>
          <option value="salg">Sporsmal om priser/salg</option>
          <option value="demo">Onsker demo</option>
          <option value="support">Teknisk support</option>
          <option value="annet">Annet</option>
        </select>
      </div>

      <div>
        <label htmlFor="melding" className="input-label">Melding *</label>
        <textarea
          id="melding"
          name="melding"
          required
          rows={5}
          className="input resize-none"
          placeholder="Skriv din melding her..."
        />
      </div>

      {formMessage && (
        <div
          className={formMessage.type === 'success' ? 'form-success' : 'form-error'}
          role="status"
          aria-live="polite"
        >
          {formMessage.text}
        </div>
      )}

      <button type="submit" className="btn-primary w-full sm:w-auto" disabled={isSubmitting}>
        {isSubmitting ? 'Sender...' : 'Send melding'}
      </button>
    </form>
  );
}
