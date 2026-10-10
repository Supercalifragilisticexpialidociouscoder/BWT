import { Directory } from './Directory';

export function DiscoverPage() {
  return (
    <main id="main" className="pb-10">
      <div className="mx-auto max-w-[1400px] px-[var(--gutter)] pt-12">
        <p className="kicker mb-3 text-paper-3">Discover</p>
        <h1 className="display-lg">All events</h1>
      </div>
      <Directory stickyTop={56} heading={false} />
    </main>
  );
}
