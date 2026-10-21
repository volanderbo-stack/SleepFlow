import { useEffect, useRef } from 'react';
import { useApp } from '../app/store';
import { uk } from '../i18n/uk';

export function Toast() {
  const toast = useApp((s) => s.toast);
  if (!toast) return null;
  return (
    <div className="toast" role="status" key={toast.id}>
      {toast.text}
    </div>
  );
}

export function ConfirmDialog() {
  const confirm = useApp((s) => s.confirm);
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!confirm) return;
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') confirm.resolve(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirm]);
  if (!confirm) return null;
  return (
    <div className="dialog-backdrop" onClick={() => confirm.resolve(false)}>
      <div className="dialog" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <p>{confirm.text}</p>
        <div className="dialog__actions">
          <button className="btn btn--ghost" onClick={() => confirm.resolve(false)}>
            {uk.common.cancel}
          </button>
          <button ref={okRef} className={`btn ${confirm.danger ? 'btn--danger' : 'btn--primary'}`} onClick={() => confirm.resolve(true)}>
            {confirm.danger ? uk.common.delete : uk.common.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
