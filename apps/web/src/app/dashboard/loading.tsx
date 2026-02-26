export default function DashboardLoading() {
  return (
    <div className="animate-pulse">
      {/* Banner skeleton */}
      <div className="mb-8 glass-card p-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-dark-700" />
          <div className="flex-1">
            <div className="h-5 w-48 bg-dark-700 rounded mb-2" />
            <div className="h-4 w-72 bg-dark-700/50 rounded" />
          </div>
        </div>
      </div>

      {/* Header skeleton */}
      <div className="mb-8">
        <div className="h-7 w-56 bg-dark-700 rounded mb-2" />
        <div className="h-4 w-80 bg-dark-700/50 rounded" />
      </div>

      {/* Stats grid skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="glass-card p-6">
            <div className="h-4 w-20 bg-dark-700/50 rounded mb-3" />
            <div className="h-8 w-24 bg-dark-700 rounded mb-2" />
            <div className="h-3 w-28 bg-dark-700/50 rounded" />
          </div>
        ))}
      </div>

      {/* Quick actions skeleton */}
      <div className="mb-8">
        <div className="h-5 w-40 bg-dark-700 rounded mb-4" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="glass-card p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-dark-700" />
              <div>
                <div className="h-4 w-28 bg-dark-700 rounded mb-1" />
                <div className="h-3 w-36 bg-dark-700/50 rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
