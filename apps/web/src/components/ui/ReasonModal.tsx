import { useEffect, useState } from 'react';
import { reasonSchema } from '@lims/shared';
import { errorMessage } from '@/lib/utils';
import { Button } from './Button';
import { TextAreaField } from './Field';
import { Alert } from './feedback';
import { Modal } from './Modal';

interface Props {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  danger?: boolean;
  placeholder?: string;
  onClose: () => void;
  /** Doit lever une erreur en cas d'échec : elle est affichée dans la fenêtre. */
  onConfirm: (reason: string) => Promise<unknown>;
}

/** Confirmation d'une action sensible avec motif obligatoire (consigné dans la piste d'audit). */
export function ReasonModal({ open, title, description, confirmLabel, danger, placeholder, onClose, onConfirm }: Props) {
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setReason('');
      setFieldError(undefined);
      setFormError(null);
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = reasonSchema.safeParse(reason);
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message);
      return;
    }
    setPending(true);
    setFormError(null);
    try {
      await onConfirm(parsed.data);
      onClose();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" form="reason-form" variant={danger ? 'danger' : 'primary'} loading={pending}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form id="reason-form" onSubmit={submit} noValidate className="space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}
        <TextAreaField
          label="Motif (consigné dans la piste d’audit)"
          required
          value={reason}
          placeholder={placeholder}
          error={fieldError}
          onChange={(e) => {
            setReason(e.target.value);
            setFieldError(undefined);
          }}
        />
      </form>
    </Modal>
  );
}
