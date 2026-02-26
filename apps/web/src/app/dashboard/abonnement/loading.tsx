export default function AbonnementLoading() {
  return (
    <div className="animate-pulse">
      <div className="mb-8">
        <div className="h-7 w-36 bg-dark-700 rounded mb-2" />
        <div className="h-4 w-72 bg-dark-700/50 rounded" />
      </div>

      {/* Current plan skeleton */}
      <div className="glass-card p-6 mb-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="h-6 w-24 bg-dark-700 rounded" />
              <div className="h-5 w-16 bg-dark-700/50 rounded-full" />
            </div>
            <div className="h-9 w-32 bg-dark-700 rounded mb-4" />
            <div className="h-4 w-48 bg-dark-700/50 rounded" />
          </div>
          <div className="h-10 w-56 bg-dark-700 rounded-xl" />
        </div>
      </div>

      {/* Plans skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {[1, 2].map((i) => (
          <div key={i} className="glass-card p-6">
            <div className="h-6 w-24 bg-dark-700 rounded mb-2" />
            <div className="h-9 w-28 bg-dark-700 rounded mb-4" />
            <div className="space-y-2 mb-6">
              {[1, 2, 3, 4].map((j) => (
                <div key={j} className="h-4 w-full bg-dark-700/50 rounded" />
              ))}
            </div>
            <div className="h-10 w-full bg-dark-700 rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
}
