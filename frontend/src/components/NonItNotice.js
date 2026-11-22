import React from 'react';
import { Phone, HeartHandshake, Siren, ShieldAlert, Info } from 'lucide-react';
import { Modal } from './common';

const ICONS = {
  mental_health_crisis: HeartHandshake,
  medical_emergency: Siren,
  fire: Siren,
  electrical_emergency: Siren,
  security: ShieldAlert,
  pest_animal: ShieldAlert,
  other_non_it: Info
};

const telHref = number => 'tel:' + number.replace(/[^\d+]/g, '');

export function ContactList({ contacts }) {
  return (
    <ul className="contact-list">
      {contacts.map(c => (
        <li key={c.label + c.number}>
          <span><b>{c.label}</b>{c.note && <small>{c.note}</small>}</span>
          <a className="contact-call" href={telHref(c.number)}><Phone size={15} /> {c.number}</a>
        </li>
      ))}
    </ul>
  );
}

// Popup shown when a report is not an IT/facilities issue (medical, mental health, fire, security…).
export default function NonItNotice({ scope, onClose, onContinue }) {
  const Icon = ICONS[scope.kind] || Info;
  return (
    <Modal title={scope.title} onClose={onClose}>
      <div className={`non-it ${scope.emergency ? 'emergency' : ''}`} role="alertdialog" aria-describedby="non-it-message">
        <div className="non-it-head">
          <Icon size={28} aria-hidden="true" />
          <p id="non-it-message">{scope.message}</p>
        </div>
        <ContactList contacts={scope.contacts || []} />
        <div className="modal-actions">
          {onContinue && (
            <button type="button" className="secondary" onClick={onContinue}>
              It is an IT / facilities issue — continue
            </button>
          )}
          <button type="button" className="primary" onClick={onClose} autoFocus>OK</button>
        </div>
        <small className="muted">BITS reports is for IT and room-repair issues only, and is not monitored for emergencies.</small>
      </div>
    </Modal>
  );
}

// Small inline warning that appears while typing, before anything is submitted.
export function EmergencyBanner({ scope, onOpen }) {
  return (
    <div className="callout danger" role="alert">
      <Siren size={18} />
      <div>
        <b>{scope.title}.</b> This is not something the IT help desk can handle.{' '}
        <button type="button" className="link-btn" onClick={onOpen}>Show who to call</button>
        <div className="banner-contacts">
          {(scope.contacts || []).slice(0, 2).map(c => (
            <a key={c.number} href={telHref(c.number)}><Phone size={13} /> {c.label}: {c.number}</a>
          ))}
        </div>
      </div>
    </div>
  );
}
