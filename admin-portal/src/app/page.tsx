import { redirect } from 'next/navigation';

/** The portal has no landing page of its own; staff start at the dashboard. */
export default function HomePage() {
  redirect('/dashboard');
}
