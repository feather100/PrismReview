import React, { useState } from 'react';
import { Modal, Input } from 'antd';

const { TextArea } = Input;

interface Props {
  open: boolean;
  onConfirm: (condition: string) => void;
  onCancel: () => void;
}

export default function InterventionModal({ open, onConfirm, onCancel }: Props) {
  const [text, setText] = useState('');

  return (
    <Modal
      title="Inject Condition / Intervene"
      open={open}
      onOk={() => {
        onConfirm(text);
        setText('');
      }}
      onCancel={onCancel}
      okText="Inject"
    >
      <div style={{ marginBottom: 16 }}>
        Provide additional context, corrections, or conditions for the AI Committee to consider in their subsequent turns.
      </div>
      <TextArea 
        rows={4} 
        value={text} 
        onChange={e => setText(e.target.value)} 
        placeholder="e.g. Please consider the budget limit of $50,000 for this architecture."
      />
    </Modal>
  );
}
