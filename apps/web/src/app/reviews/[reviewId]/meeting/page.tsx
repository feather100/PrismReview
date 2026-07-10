import React from 'react';
import MeetingPage from '../../../../features/meeting/MeetingPage';

export default function MeetingRoute({ params }: { params: { reviewId: string } }) {
  return <MeetingPage reviewId={params.reviewId} />;
}
