export default function SettingsLoading() {
  return (
    <div className="animate-pulse">
      {/* Header skeleton */}
      <div className="mb-8">
        <div className="h-7 w-40 bg-dark-700 rounded mb-2" />
        <div className="h-4 w-72 bg-dark-700/50 rounded" />
      </div>

      {/* Tab navigation skeleton */}
      <div className="mb-8 flex flex-wrap gap-2">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <div key={i} className="h-9 w-24 bg-dark-800/50 border border-dark-700 rounded-xl" />
        ))}
      </div>

      {/* Content skeleton */}
      <div className="glass-card p-6 space-y-6">
        {[1, 2, 3].map((i) => (
          <div key={i}>
            <div className="h-4 w-32 bg-dark-700/50 rounded mb-2" />
            <div className="h-10 w-full bg-dark-700 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
