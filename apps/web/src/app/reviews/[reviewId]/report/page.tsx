import ReportPage from '../../../../features/report/ReportPage';

export default function Page({ params }: { params: { reviewId: string } }) {
  return <ReportPage reviewId={params.reviewId} />;
}
