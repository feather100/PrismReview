import { useEffect, useRef, useState } from 'react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000/api';

export type SSEConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error' | 'completed';

export interface MeetingEventPayload {
  roleId?: string;
  roleCode?: string;
  roleName?: string;
  turnId?: string;
  delta?: string;
  content?: string;
  riskLevel?: 'high' | 'medium' | 'low' | 'info' | 'pending';
  dimension?: string;
  recommendation?: string;
  confidenceScore?: number;
  message?: string;
}

export interface MeetingEventEnvelope {
  eventId?: string;
  reviewId?: string;
  sessionId?: string;
  type?: string;
  timestamp?: string;
  sequence?: number;
  payload?: unknown;
}

export function useMeetingSSE(reviewId: string, onEvent: (type: string, data: MeetingEventPayload) => void, enabled: boolean = true) {
  const [connectionStatus, setConnectionStatus] = useState<SSEConnectionStatus>('connecting');
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!reviewId || !enabled) return;

    const url = `${API_BASE_URL}/reviews/${reviewId}/meeting/stream`;
    const es = new EventSource(url);

    es.onopen = () => setConnectionStatus('connected');
    
    es.onerror = () => {
      setConnectionStatus(prev => (prev === 'completed' ? 'completed' : 'error'));
    };

    const handleMessage = (type: string) => (e: MessageEvent) => {
      try {
        const envelope: MeetingEventEnvelope = JSON.parse(e.data);
        const resolvedType = envelope.type ?? type;
        const resolvedPayload = (envelope.payload ?? envelope) as MeetingEventPayload;
        
        onEventRef.current(resolvedType, resolvedPayload);

        if (resolvedType === 'meeting.completed') {
          es.close();
          setConnectionStatus('completed');
        }
      } catch (err) {
        // Ignore JSON parse errors (e.g. empty heartbeats)
      }
    };

    const eventTypes = [
      'meeting.started', 
      'heartbeat', 
      'agent.turn.started',
      'agent.message.delta', 
      'agent.message.completed',
      'agent.turn.completed', 
      'meeting.completed', 
      'error'
    ];

    eventTypes.forEach(t => es.addEventListener(t, handleMessage(t)));

    return () => {
      es.close();
      setConnectionStatus(prev => (prev === 'completed' ? 'completed' : 'disconnected'));
    };
  }, [reviewId, enabled]);

  return { connectionStatus };
}
