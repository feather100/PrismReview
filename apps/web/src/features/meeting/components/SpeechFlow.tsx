import React, { useRef, useEffect } from 'react';
import SpeechCard, { SpeechCardData } from './SpeechCard';

interface Props {
  cards: SpeechCardData[];
}

export default function SpeechFlow({ cards }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-scroll to bottom on new message
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [cards]);

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '0 16px' }}>
      {cards.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#999', marginTop: 40 }}>
          等待智能体发言...
        </div>
      ) : (
        cards.map(card => <SpeechCard key={card.id} data={card} />)
      )}
      <div ref={bottomRef} />
    </div>
  );
}
