import React from 'react';
import DiagnosisPage from '../../../features/diagnosis/DiagnosisPage';

export default function ReviewDiagnosisRoute({ params }: { params: { reviewId: string } }) {
  return <DiagnosisPage reviewId={params.reviewId} />;
}
