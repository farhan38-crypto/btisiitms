import React, { useState } from 'react';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import api, { errMsg } from '../api';
import { Modal } from './common';
import { ALL_SKILLS } from './campus';

// Admin edits a user's profile; technicians also get skills and capacity.
export default function EditUserModal({ user, onClose, onSaved }) {
  const isTech = user.role === 'technician';
  const [f, setF] = useState({
    name: user.name || '', phone: user.phone || '', skills: user.skills || [], max_concurrent: user.max_concurrent || 5
  });
  const [busy, setBusy] = useState(false);
  const skillOptions = Array.from(new Set([...ALL_SKILLS, ...(user.skills || [])]));
  const toggle = s => setF(prev => ({ ...prev, skills: prev.skills.includes(s) ? prev.skills.filter(x => x !== s) : [...prev.skills, s] }));

  const submit = async e => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { name: f.name.trim(), phone: f.phone.trim() };
      if (isTech) Object.assign(body, { skills: f.skills, max_concurrent: +f.max_concurrent });
      await api.patch(`/admin/users/${user.id}`, body);
      toast.success(`${body.name} updated`);
      onSaved();
    } catch (err) {
      toast.error(errMsg(err) || 'Could not update the account');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Edit ${user.name}`} onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <label>Name<input required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
        <label>Phone<input type="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></label>
        {isTech && (
          <>
            <div>
              <span className="field-label">Skills / domains</span>
              <div className="chip-row" style={{ marginTop: 8 }}>
                {skillOptions.map(s => (
                  <button key={s} type="button" className={f.skills.includes(s) ? 'primary small' : 'secondary small'} onClick={() => toggle(s)}>
                    {f.skills.includes(s) && <Check size={12} />} {s}
                  </button>
                ))}
              </div>
            </div>
            <label>Max concurrent incidents
              <input type="number" min="1" max="50" required value={f.max_concurrent} onChange={e => setF({ ...f, max_concurrent: e.target.value })} />
            </label>
          </>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </form>
    </Modal>
  );
}
