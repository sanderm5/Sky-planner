export default function FakturaerLoading() {
  return (
    <div className="animate-pulse">
      <div className="mb-8">
        <div className="h-7 w-32 bg-dark-700 rounded mb-2" />
        <div className="h-4 w-56 bg-dark-700/50 rounded" />
      </div>

      <div className="glass-card overflow-hidden">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center justify-between p-4 border-b border-dark-700/50">
            <div className="flex-1">
              <div className="h-4 w-32 bg-dark-700 rounded mb-1" />
              <div className="h-3 w-24 bg-dark-700/50 rounded" />
            </div>
            <div className="h-4 w-20 bg-dark-700/50 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
